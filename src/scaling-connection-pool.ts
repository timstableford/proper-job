import { ConnectionPoolRunner } from './connection-pool-runner';
import { EventEmitter } from 'events';

export type CreateRunnerCallback<T extends ConnectionPoolRunner> = () => Promise<T> | T;
export type ClaimCallback<T extends ConnectionPoolRunner, V = void> = (
  instance: T,
) => Promise<V> | V;

interface ConnectionPoolOptionsInternal {
  // Minimum number of instances, created on start.
  minInstances: number;
  // Maximum number of instances allowed.
  maxInstances: number;
  // Scale down when load is above this level.
  scaleDownAt: number;
  // Scale up when load is above this level.
  scaleUpAt: number;
  // Period to check usage and scale either direction by 1.
  scaleInterval: number;
  // True to allow scaling instantly when no instances are available
  // rather than if the average usage is exceeded.
  responsiveScale: boolean;
}

export type ConnectionPoolOptions = Partial<ConnectionPoolOptionsInternal>;

const DEFAULT_OPTIONS: ConnectionPoolOptionsInternal = {
  minInstances: 1,
  maxInstances: 16,
  scaleDownAt: 0.4,
  scaleUpAt: 0.8,
  scaleInterval: 1000,
  responsiveScale: true,
};

interface InstanceWrapper<T extends ConnectionPoolRunner> {
  claimed?: number;
  instance?: T;
}

export class ScalingConnectionPool<T extends ConnectionPoolRunner> extends EventEmitter {
  private createCallback: CreateRunnerCallback<T>;
  private options: ConnectionPoolOptionsInternal;
  private instanceList: Array<InstanceWrapper<T>> = [];
  private quitting = false;
  private runTime = 0;
  private scaleInterval?: NodeJS.Timer;
  private scaling = false;

  public constructor(createCallback: CreateRunnerCallback<T>, options?: ConnectionPoolOptions) {
    super();

    this.createCallback = createCallback;

    this.options = {
      ...DEFAULT_OPTIONS,
      ...(options || {}),
    };

    // All them once's everywhere can add up to more than the default 10.
    this.setMaxListeners(this.options.maxInstances * 4);

    this.scaleInterval = setInterval(() => this.scaleTick(), this.options.scaleInterval);
    // Start a scale immediately.
    this.scaleTick();
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
        this.emit('available');
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
    while (this.getClaimedCount() > 0) {
      await new Promise(resolve => this.once('released', resolve));
    }

    // Then shutdown each of the connections.
    for (const instanceWrapper of this.instanceList) {
      if (instanceWrapper.instance) {
        await instanceWrapper.instance.quit();
      } else {
        console.warn('Pool connection may have tried to shutdown while starting up');
      }
    }

    // Reset this so that the created instances show as 0 after.
    this.instanceList = [];

    this.removeAllListeners();
  }

  public getClaimedCount(): number {
    return this.instanceList.filter(instance => instance.claimed !== undefined).length;
  }

  public getInstanceCount(): number {
    return this.instanceList.length;
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
        this.scaleUp().catch(err => {
          this.emit('error', err);
        });
        // If the usage is less than the threshold and there's more than the minimum runners.
      } else if (
        usage < this.options.scaleDownAt &&
        this.instanceList.length > this.options.minInstances
      ) {
        const unused = this.instanceList.find(
          instance => instance.claimed === undefined && instance.instance,
        );
        if (unused) {
          const index = this.instanceList.findIndex(instanceWrapper => instanceWrapper === unused);
          if (index >= 0) {
            this.instanceList.splice(index, 1);
          }
          if (unused.instance) {
            unused.instance.quit().catch(err => {
              this.emit('error', err);
            });
          } else {
            this.emit('error', new Error('Attempt to scale down uninstantiated instance'));
          }
          this.emit('scale', this.instanceList.length);
        }
      }
    }

    this.emit('usage', usage);
  }

  private async scaleUp(): Promise<void> {
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
      const instance = await Promise.resolve(this.createCallback());
      this.instanceList.push({
        instance,
      });
      this.emit('available');
      // While there's less than the minimum number of instance, keep scaling.
      if (this.instanceList.length < this.options.minInstances && !this.quitting) {
        this.scaleTick();
      }
    } catch (err) {
      this.emit('error', err);
    } finally {
      this.emit('scale', this.instanceList.length);
      this.scaling = false;
    }
  }

  private async waitForClaim(): Promise<T> {
    let instanceWrapper: InstanceWrapper<T> | undefined = undefined;
    do {
      // Try to find an instance that has not been claimed.
      instanceWrapper = this.instanceList.find(
        instance => instance.claimed === undefined && instance.instance,
      );
      if (instanceWrapper) {
        if (!instanceWrapper.instance) {
          throw new Error('Managed to claim an uninstantiated instance');
        }
        instanceWrapper.claimed = Date.now();
        return instanceWrapper.instance;
      } else if (
        this.instanceList.length < this.options.maxInstances &&
        this.options.responsiveScale
      ) {
        // If it's possible to scale up now, then do so and then repeat the loop
        // without waiting for one to be available.
        await this.scaleUp();
        continue;
      }

      // So when an instance is created or when one's released.
      await new Promise(resolve => this.once('available', resolve));
    } while (instanceWrapper === undefined);

    throw new Error('Returning from claiming without an instance');
  }
}
