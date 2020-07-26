import { AsyncBuffer } from './async-buffer';
import { CreatePollingRunnerCallback, PollingAsyncBufferOptions } from './api-types';
import { PollingConnectionPoolRunner } from './polling-connection-pool-runner';
import { ScalingConnectionPool } from './scaling-connection-pool';

export class PollingAsyncBuffer<T> extends AsyncBuffer<T> {
  public readonly pool: ScalingConnectionPool<PollingConnectionPoolRunner<T>>;
  private resultCount = 0;
  private pollingRunning = true;
  private runningCount = 0;

  public constructor(
    createCallback: CreatePollingRunnerCallback<T>,
    options?: PollingAsyncBufferOptions,
  ) {
    super(options);

    this.pool = new ScalingConnectionPool<PollingConnectionPoolRunner<T>>(createCallback, {
      ...(options || {}),
      autoScale: false,
      responsiveScale: false,
    });

    // Listeners removed when pool quit is called.
    this.pool.on('available', () => {
      if (this.pollingRunning) {
        this.runningCount = this.runningCount + 1;
        this.poll()
          .catch(err => {
            this.pool.emit('error', err);
          })
          .finally(() => {
            this.runningCount = this.runningCount - 1;
          });
      }
    });

    this.pool.on('scale', () => this.emit('scale'));
    this.pool.on('error', err => this.emit('error', err));
  }

  public getRunningCount(): number {
    return this.runningCount;
  }

  public getInstanceCount(): number {
    return this.pool.getInstanceCount();
  }

  public async quit(): Promise<void> {
    // Need to stop doing new polls
    this.pollingRunning = false;

    // Begin spinning down the pool, stopping it from doing new
    // polls and starting to shutdown.
    const poolQuitPromise = this.pool.quit();

    // Wait for the buffer to drain.
    // This guarantees all ongoing polls that return dats succeed.
    while (this.buffer.length > 0) {
      await this.waitForPop();
    }

    // Wait for all the polling to stop, should be done since the buffers empty.
    await poolQuitPromise;

    // Finally shut ourselves down.
    await super.quit();
  }

  private async poll(): Promise<void> {
    // Block until there's space in the buffer before
    // doing any polling. Without this you'd get a memory leak
    // of data being dumped constantly into here while the queue's full.
    while (this.buffer.length >= this.maxSize) {
      await this.waitForPop();
    }

    // Obtain an instance and use it to get a result.
    // Why not just push inside the callback below you may think, well
    // push is a blocking call which will mean the pool thinks it's fully utilised
    // waiting for the buffer to empty.
    let killedInstance: PollingConnectionPoolRunner<T> | undefined = undefined;
    const res = await this.pool.run(async instance => {
      const internalRes = await instance.fetch();
      // If we need to scale down then mark this specific instance as quitting so when
      // it's released it's not made available.
      if (internalRes === undefined || (internalRes.length === 0 && !this.pool.isScaling())) {
        // Only returns an instance of the running count > the minimum.
        killedInstance = this.pool.killRunner(instance);
      }
      return internalRes;
    });

    if (res !== undefined && !Array.isArray(res)) {
      this.emit('error', new Error(`Popped non-array element: ${res}`));
      return;
    }

    // At this point available has been emitted but it has been ignored.
    // That means scaling down should work fine.
    if (res === undefined || res.length === 0) {
      if (killedInstance) {
        // Reset counter for scaling up.
        this.resultCount = 0;
        // Won't do anything if already at the minimum. Blocks until instance is released.
        await this.pool.scaleDown(killedInstance);
      }
    } else {
      // Used for scaling up.
      this.resultCount = this.resultCount + 1;
      // Afterwards (so as not to keep the polling instance longer than necessary...)
      // push it into the queue.
      for (const element of res) {
        await this.push(element);
      }
    }

    // If twice as many callbacks as the number of instances has returned a non-undefined
    // result (ex not timed out) then scale up.
    if (this.resultCount > this.pool.getInstanceCount() * 2) {
      this.resultCount = 0;
      await this.pool.scaleUp();
    }
  }
}
