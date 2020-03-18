export interface ExecutorConfig {
  parallel?: number;
  continueOnError?: boolean;
  storeOutput?: boolean;
  throwOnError?: boolean;
}

export interface ExecutorResults<K, V> {
  results: Map<K, V>;
  errors: Map<K, Error>;
  fulfilled: number;
}

export type ExecutorCallback<K, V> = (value: K) => Promise<V>;

interface ExecutorOptions<K, V> extends ExecutorConfig {
  iterable: Iterable<K>;
  callback: ExecutorCallback<K, V>;
  resolve: (results: ExecutorResults<K, V>) => void;
  reject?: (results: ExecutorResults<K, V>) => void;
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
  private results: ExecutorResults<K, V> = {
    results: new Map(),
    errors: new Map(),
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

  public fill(): void {
    const parallel = this.options.parallel || DEFAULT_CONFIG.parallel;
    const continueOnError = conf(DEFAULT_CONFIG.continueOnError, this.options.continueOnError);
    const shouldContinue = continueOnError || this.results.errors.size === 0;

    if (shouldContinue) {
      while (this.running < parallel) {
        const iteratorValue = this.iterator.next();
        if (iteratorValue.done) {
          break;
        }
        this.wrap(iteratorValue.value, this.start(iteratorValue.value));
      }
    }

    if (this.running === 0) {
      const throwOnError = conf(DEFAULT_CONFIG.throwOnError, this.options.throwOnError);

      if (throwOnError && this.results.errors.size > 0 && this.options.reject) {
        this.options.reject(this.results);
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

  private wrap(key: K, promise: Promise<V>): void {
    const store = conf(DEFAULT_CONFIG.storeOutput, this.options.storeOutput);
    promise
      .then(result => {
        if (store && result !== undefined) {
          this.results.results.set(key, result);
        }
        this.results.fulfilled++;
      })
      .catch(error => {
        this.results.errors.set(key, error);
      })
      .finally(() => {
        this.running--;
        this.fill();
      });
  }
}

export async function execute<K, V = void>(
  iterable: Iterable<K>,
  callback: ExecutorCallback<K, V>,
  options: ExecutorConfig = {},
): Promise<ExecutorResults<K, V>> {
  return new Promise<ExecutorResults<K, V>>((resolve, reject) => {
    const executor = new ParallelExecutor({
      resolve,
      reject,
      iterable,
      callback,
      ...options,
    });
    executor.fill();
  });
}
