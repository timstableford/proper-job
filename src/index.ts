import { ExecutorAbortError } from './executor-abort';
import {
  ExecutorCallback,
  ExecutorConfig,
  ExecutorInit,
  ExecutorIterable,
  ExecutorResults,
} from './api-types';
import { ExecutorError } from './executor-error';
import { ExecutorPromise } from './executor-promise';

export {
  ExecutorPromise,
  ExecutorError,
  ExecutorConfig,
  ExecutorResults,
  ExecutorCallback,
  ExecutorIterable,
  ExecutorInit,
  ExecutorAbortError,
};

export type ExecutorTeardown<T> = (init?: T) => Promise<void> | void;

interface ExecutorOptions<K, V, T> extends ExecutorConfig {
  iterable: ExecutorIterable<K, T>;
  callback: ExecutorCallback<K, V, T>;
  teardown?: ExecutorTeardown<T>;
  resolve: (results: ExecutorResults<V>) => void;
  reject?: (error: ExecutorError<V>) => void;
}

const DEFAULT_CONFIG = {
  parallel: 1,
  continueOnError: true,
  storeOutput: true,
  throwOnError: true,
};

function conf<T>(defaultValue: T, value?: T): T {
  if (value !== undefined) {
    return value;
  }
  return defaultValue;
}

class ParallelExecutor<K, V, T> {
  private options: ExecutorOptions<K, V, T>;
  private results: ExecutorResults<V> = {
    results: [],
    errors: [],
    fulfilled: 0,
  };
  private running = 0;
  private iterator?: Iterator<K> | AsyncIterator<K>;
  private init?: T;
  private filling = false;

  public constructor(options: ExecutorOptions<K, V, T>) {
    this.options = options;

    if (!this.options.resolve) {
      throw new Error('resolve must be in options');
    }
  }

  public abort(): void {
    this.results.aborted = true;
  }

  public begin(): void {
    if (!this.options.iterable) {
      this.options.continueOnError = false;
      this.results.errors.push(new Error('Iterable not set'));
      return;
    }

    if (typeof this.options.iterable === 'function') {
      try {
        this.options.iterable = this.options.iterable();
      } catch (err) {
        this.options.iterable = Promise.reject(err);
      }
    } else {
      this.options.iterable = Promise.resolve(this.options.iterable);
    }

    this.options.iterable
      .then(iterable => {
        if (iterable) {
          this.createIterator(iterable);
        } else {
          this.options.continueOnError = false;
          this.results.errors.push(new Error('Iterator returned void'));
        }
      })
      .catch(err => {
        this.options.continueOnError = false;
        this.results.errors.push(err);
      })
      .finally(() => this.fill());
  }

  private createIterator(iterable: ExecutorIterable<K, T>): void {
    if ((iterable as AsyncIterable<K>)[Symbol.asyncIterator]) {
      this.iterator = (iterable as AsyncIterable<K>)[Symbol.asyncIterator]();
    } else if ((iterable as Iterable<K>)[Symbol.iterator]) {
      this.iterator = (iterable as Iterable<K>)[Symbol.iterator]();
    } else {
      this.createIterator((iterable as ExecutorInit<K, T>).iterable);
      this.init = (iterable as ExecutorInit<K, T>).init;
    }
  }

  private fill(): void {
    if (this.filling) {
      return;
    }
    this.filling = true;

    this.fillPromise()
      .then(() => (this.filling = false))
      .catch(err => {
        this.results.errors.push(err);
        this.options.continueOnError = false;
        this.filling = false;
        this.fill();
      });
  }

  private async fillPromise(): Promise<void> {
    const parallel = this.options.parallel || DEFAULT_CONFIG.parallel;
    const continueOnError = conf(DEFAULT_CONFIG.continueOnError, this.options.continueOnError);
    const shouldContinue =
      (continueOnError || this.results.errors.length === 0) && !this.results.aborted;

    if (shouldContinue) {
      while (this.running < parallel && this.iterator) {
        const iteratorValue = await Promise.resolve(this.iterator.next());
        if (iteratorValue.done) {
          // If done clear the iterator so it won't keep filling when there's a race condition.
          this.iterator = undefined;
          break;
        }
        this.wrap(this.start(iteratorValue.value));
      }
    }

    if (this.running === 0) {
      if (this.options.teardown) {
        try {
          await this.options.teardown(this.init);
        } catch (err) {
          this.results.errors.push(err);
        } finally {
          this.finish();
        }
      } else {
        this.finish();
      }
    }
  }

  private finish(): void {
    const throwOnError = conf(DEFAULT_CONFIG.throwOnError, this.options.throwOnError);
    if (throwOnError && this.results.errors.length > 0 && this.options.reject) {
      this.options.reject(new ExecutorError(this.results));
    } else {
      this.options.resolve(this.results);
    }
  }

  private start(value: K): Promise<V> {
    try {
      return this.options.callback(value, this.init);
    } catch (err) {
      return Promise.reject(err);
    } finally {
      this.running++;
    }
  }

  private wrap(promise: Promise<V>): void {
    const store = conf(DEFAULT_CONFIG.storeOutput, this.options.storeOutput);
    promise
      .then(result => {
        if (store && result !== undefined) {
          this.results.results.push(result);
        }
        this.results.fulfilled++;
      })
      .catch(error => {
        if (error instanceof ExecutorAbortError) {
          this.results.aborted = true;
        } else {
          this.results.errors.push(error);
        }
      })
      .finally(() => {
        this.running--;
        this.fill();
      });
  }
}

export function execute<K, V = void, T = void>(
  iterable: ExecutorIterable<K, T>,
  callback: ExecutorCallback<K, V, T>,
  options: ExecutorConfig = {},
  teardown?: ExecutorTeardown<T>,
): ExecutorPromise<ExecutorResults<V>> {
  const promise: ExecutorPromise<ExecutorResults<V>> = new ExecutorPromise<ExecutorResults<V>>(
    (resolve, reject) => {
      const executor = new ParallelExecutor({
        resolve,
        reject,
        iterable,
        callback,
        teardown,
        ...options,
      });
      executor.begin();
      return () => executor.abort();
    },
  );

  return promise;
}
