import { ExecutorCallback, ExecutorConfig, ExecutorResults } from './api-types';
import { ExecutorError } from './executor-error';
import { ExecutorPromise } from './executor-promise';

export { ExecutorPromise, ExecutorError, ExecutorConfig, ExecutorResults, ExecutorCallback };

interface ExecutorOptions<K, V> extends ExecutorConfig {
  iterable: Iterable<K>;
  callback: ExecutorCallback<K, V>;
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

class ParallelExecutor<K, V> {
  private options: ExecutorOptions<K, V>;
  private results: ExecutorResults<V> = {
    results: [],
    errors: [],
    fulfilled: 0,
  };
  private running = 0;
  private iterator: Iterator<K>;

  public constructor(options: ExecutorOptions<K, V>) {
    this.options = options;
    this.iterator = options.iterable[Symbol.iterator]();

    if (!this.options.resolve) {
      throw new Error('resolve must be in options');
    }
  }

  public abort(): void {
    this.results.aborted = true;
  }

  public begin(): void {
    if (this.options.init) {
      this.options
        .init()
        .catch(err => {
          this.options.continueOnError = false;
          this.results.errors.push(err);
        })
        .finally(() => this.fill());
    } else {
      this.fill();
    }
  }

  private fill(): void {
    const parallel = this.options.parallel || DEFAULT_CONFIG.parallel;
    const continueOnError = conf(DEFAULT_CONFIG.continueOnError, this.options.continueOnError);
    const shouldContinue =
      (continueOnError || this.results.errors.length === 0) && !this.results.aborted;

    if (shouldContinue) {
      while (this.running < parallel) {
        const iteratorValue = this.iterator.next();
        if (iteratorValue.done) {
          break;
        }
        this.wrap(this.start(iteratorValue.value));
      }
    }

    if (this.running === 0) {
      const throwOnError = conf(DEFAULT_CONFIG.throwOnError, this.options.throwOnError);

      if (throwOnError && this.results.errors.length > 0 && this.options.reject) {
        this.options.reject(new ExecutorError(this.results));
      } else {
        this.options.resolve(this.results);
      }
    }
  }

  private start(value: K): Promise<V> {
    try {
      return this.options.callback(value);
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
        this.results.errors.push(error);
      })
      .finally(() => {
        this.running--;
        this.fill();
      });
  }
}

export function execute<K, V = void>(
  iterable: Iterable<K>,
  callback: ExecutorCallback<K, V>,
  options: ExecutorConfig = {},
): ExecutorPromise<ExecutorResults<V>> {
  const promise: ExecutorPromise<ExecutorResults<V>> = new ExecutorPromise<ExecutorResults<V>>(
    (resolve, reject) => {
      const executor = new ParallelExecutor({
        resolve,
        reject,
        iterable,
        callback,
        ...options,
      });
      executor.begin();
      return () => executor.abort();
    },
  );

  return promise;
}
