import {
  ClaimCallback,
  ConnectionPoolOptions,
  ConnectionPoolOptionsInternal,
  CreateRunnerCallback,
} from './api-types';
import { ConnectionPoolRunner } from './connection-pool-runner';
import { EventEmitter } from 'events';

const DEFAULT_OPTIONS: ConnectionPoolOptionsInternal = {
  minInstances: 1,
  maxInstances: 16,
  scaleDownAt: 0.4,
  scaleUpAt: 0.8,
  scaleInterval: 1000,
  responsiveScale: true,
  autoScale: true,
};

interface InstanceWrapper<T extends ConnectionPoolRunner> {
  claimed?: number;
  instance?: T;
  quitting?: boolean;
}

interface PendingClaim<T extends ConnectionPoolRunner> {
  resolve: (instanceWrapper: InstanceWrapper<T>) => void;
}

interface QueueItem<T> {
  next?: QueueItem<T>;
  data: T;
}

export class ScalingConnectionPool<T extends ConnectionPoolRunner> extends EventEmitter {
  protected quitting = false;

  private createCallback: CreateRunnerCallback<T>;
  private options: ConnectionPoolOptionsInternal;
  private instanceList: Array<InstanceWrapper<T>> = [];
  private runTime = 0;
  private scaleInterval?: NodeJS.Timer;
  private scaling = false;
  private pendingClaimFirst?: QueueItem<PendingClaim<T>>;
  private pendingClaimLast?: QueueItem<PendingClaim<T>>;
  private pendingClaimCount = 0;

  public constructor(createCallback: CreateRunnerCallback<T>, options?: ConnectionPoolOptions) {
    super();

    this.createCallback = createCallback;

    this.options = {
      ...DEFAULT_OPTIONS,
      ...(options || {}),
    };

    if (this.options.autoScale) {
      this.scaleInterval = setInterval(() => this.scaleTick(), this.options.scaleInterval);
    }

    // Start a scale on the next loop. This allows subscribing to the initial available event.
    setTimeout(() => this.scaleTick(), 0);

    this.on('available', (instanceWrapper: InstanceWrapper<T>) => {
      if (this.pendingClaimFirst) {
        try {
          this.pendingClaimFirst.data.resolve(instanceWrapper);
        } catch (err) {
          this.emit('error', err);
        }
        if (this.pendingClaimFirst === this.pendingClaimLast) {
          this.pendingClaimLast = undefined;
        }
        this.pendingClaimFirst = this.pendingClaimFirst.next;
        this.pendingClaimCount--;
      }
    });
  }

  public async run<V = void>(callback: ClaimCallback<T, V>): Promise<V> {
    const claimed = await this.claim();
    try {
      // The await is necessary otherwise it will be released right away.
      return await Promise.resolve(callback(claimed));
    } finally {
      this.release(claimed);
    }
  }

  public getPendingClaimCount(): number {
    // Recover from errors if necessary.
    if (this.pendingClaimCount < 0) {
      this.pendingClaimCount = 0;
      this.emit('error', new Error('Pending claim count went below 0'));
    }
    return this.pendingClaimCount;
  }

  public claim(): Promise<T> {
    if (this.quitting) {
      throw new Error('Cannot claim an instance while shutdown');
    }
    return this.waitForClaim();
  }

  public release(instance: T): void {
    for (const instanceWrapper of this.instanceList) {
      if (instanceWrapper.instance === instance) {
        if (instanceWrapper.claimed === undefined) {
          this.emit('error', new Error('Attempt to release already released instance'));
          return;
        }
        this.runTime = this.runTime + (Date.now() - instanceWrapper.claimed);
        instanceWrapper.claimed = undefined;
        // Released and available because available is also happens
        // when a new instace is created.
        this.emit('released');
        if (!this.quitting && !instanceWrapper.quitting) {
          this.emit('available', instanceWrapper);
        }
        return;
      }
    }
    throw new Error('Unable to match instance to release it');
  }

  public async quit(): Promise<void> {
    // Stop any new claims
    this.quitting = true;

    // Stop any future scaling
    if (this.scaleInterval) {
      clearInterval(this.scaleInterval);
    }

    // Wait for any current scaling to complete
    while (this.scaling) {
      await new Promise(resolve => this.once('scale', resolve));
    }

    // Wait for any claims to complete.
    while (this.instanceList.length > 0) {
      const unusedIndex = this.instanceList.findIndex(
        instance => instance.claimed === undefined && instance.instance,
      );

      if (unusedIndex >= 0) {
        const unused = this.instanceList[unusedIndex];
        this.instanceList.splice(unusedIndex, 1);
        if (unused && unused.instance) {
          await unused.instance.quit();
        } else {
          console.warn('Pool connection may have tried to shutdown while starting up');
        }
      } else {
        await new Promise(resolve => this.once('released', resolve));
      }
    }

    this.removeAllListeners();
  }

  public getClaimedCount(): number {
    return this.instanceList.filter(instance => instance.claimed !== undefined).length;
  }

  public getInstanceCount(): number {
    return this.instanceList.length;
  }

  public isScaling(): boolean {
    return this.scaling;
  }

  public getMinInstances(): number {
    return this.options.minInstances;
  }

  public getMaxInstances(): number {
    return this.options.maxInstances;
  }

  public killRunner(inputInstance?: T): T | undefined {
    const runningInstances = this.instanceList.filter(instance => !instance.quitting);
    if (runningInstances.length <= this.options.minInstances) {
      return undefined;
    }

    const unused =
      this.instanceList.find(wrapper => {
        return inputInstance !== undefined
          ? inputInstance === wrapper.instance
          : wrapper.claimed === undefined && wrapper.instance;
      }) || runningInstances[0];

    unused.quitting = true;

    return unused.instance;
  }

  public async scaleDown(instance?: T): Promise<void> {
    while (this.scaling && !this.quitting) {
      await new Promise(resolve => this.once('scale', resolve));
    }
    if (this.quitting) {
      return;
    }

    this.scaling = true;

    try {
      const unusedInstance = instance || this.killRunner();
      if (!unusedInstance) {
        return;
      }
      const unused = this.instanceList.find(wrapper => wrapper.instance === unusedInstance);
      if (!unused) {
        throw new Error('Could not find given instance in list');
        return;
      }

      while (unused.claimed !== undefined) {
        await new Promise(resolve => this.once('released', resolve));
      }

      const index = this.instanceList.findIndex(instanceWrapper => instanceWrapper === unused);
      if (index >= 0) {
        this.instanceList.splice(index, 1);
      }
      if (!unused.instance) {
        throw new Error('Attempt to scale down uninstantiated instance');
      }

      await unused.instance.quit();
    } finally {
      this.scaling = false;
      this.emit('scale', this.instanceList.length);
    }
  }

  public async scaleUp(): Promise<void> {
    while (this.scaling && !this.quitting) {
      await new Promise(resolve => this.once('scale', resolve));
    }
    if (this.quitting) {
      return;
    }

    if (this.instanceList.length >= this.options.maxInstances) {
      return;
    }

    this.scaling = true;
    try {
      const instance = await this.createInstance();
      const wrapper = {
        instance,
      };
      this.instanceList.push(wrapper);
      this.emit('available', wrapper);
    } catch (err) {
      this.emit('error', err);
    } finally {
      this.scaling = false;
      this.emit('scale', this.instanceList.length);
    }
  }

  private createInstance(): Promise<T> {
    try {
      return Promise.resolve(this.createCallback());
    } catch (err) {
      return Promise.reject(err);
    }
  }

  private scaleTick(): void {
    const instanceCount = this.instanceList.length;
    const totalPossibleUsageTime = this.options.scaleInterval * instanceCount;

    // Add any that are still running
    for (const instanceWrapper of this.instanceList) {
      if (instanceWrapper.claimed !== undefined) {
        this.runTime = this.runTime + (Date.now() - instanceWrapper.claimed);
        instanceWrapper.claimed = Date.now();
      }
    }

    const usage = instanceCount === 0 ? 0 : this.runTime / totalPossibleUsageTime;
    this.runTime = 0;

    if (!this.scaling) {
      // Scale up if the usage is above the threshold and we can create more,
      // or if there's less than the minimum.
      if (usage > this.options.scaleUpAt || this.instanceList.length < this.options.minInstances) {
        this.scaleUp()
          .then(() => {
            // While there's less than the minimum number of instance, keep scaling.
            if (this.instanceList.length < this.options.minInstances && !this.quitting) {
              this.scaleTick();
            }
          })
          .catch(err => {
            this.emit('error', err);
          });
        // If the usage is less than the threshold and there's more than the minimum runners.
      } else if (
        usage < this.options.scaleDownAt &&
        this.instanceList.length > this.options.minInstances
      ) {
        this.scaleDown().catch(err => {
          this.emit('error', err);
        });
      }
    }

    this.emit('usage', usage);
  }

  private async waitForClaim(): Promise<T> {
    // Try to find an instance that has not been claimed.
    const instanceWrapper = this.instanceList.find(
      instance => instance.claimed === undefined && instance.instance,
    );

    if (instanceWrapper) {
      if (!instanceWrapper.instance) {
        throw new Error('Managed to claim an uninstantiated instance');
      }
      instanceWrapper.claimed = Date.now();
      return instanceWrapper.instance;
    }

    // When an instance is created or when one's released.
    const pendingClaimPromise = new Promise<InstanceWrapper<T>>(resolve => {
      const item = { data: { resolve } };
      if (this.pendingClaimLast) {
        this.pendingClaimLast.next = item;
        this.pendingClaimLast = item;
      } else {
        this.pendingClaimFirst = item;
        this.pendingClaimLast = item;
      }
      this.pendingClaimCount++;
    });

    if (
      !instanceWrapper &&
      this.instanceList.length < this.options.maxInstances &&
      this.options.responsiveScale &&
      this.options.autoScale
    ) {
      // If it's possible to scale up now, then do so and then repeat the loop
      // without waiting for one to be available.
      await this.scaleUp();
    }

    return pendingClaimPromise.then(claimedInstanceWrapper => {
      if (!claimedInstanceWrapper.instance) {
        throw new Error('Managed to claim an uninstantiated instance');
      }
      claimedInstanceWrapper.claimed = Date.now();
      return claimedInstanceWrapper.instance;
    });
  }
}
