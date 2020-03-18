const DEFAULTS = {
  parallel: 1,
};

// export interface ExecutorOptions {
//   parallel: number;
//   iterable: Iterable;
//   callback: value => Promise<>
//   resolve: results => void
//   reject?: results => void

class ParallelExecutor {
  constructor(options) {
    this.results = [];
    this.running = 0;
    this.errors = 0;

    this.iterator = options.iterable[Symbol.iterator]();

    this.options = Object.assign({}, DEFAULTS);
    if (options) {
      Object.assign(this.options, options);
    }

    if (!this.options.resolve) {
      throw new Error('resolve must be in options');
    }
  }

  start(value) {
    try {
      return this.options.callback(this.iterator.value);
    } catch (err) {
      return Promise.reject(err);
    } finally {
      this.running++;
    }
  }

  wrap(promise) {
    promise
      .then(result => {
        this.results.push({ result });
      })
      .catch(error => {
        this.results.push({ error });
        this.errors++;
      })
      .finally(() => {
        this.running--;
        this.fill();
      });
  }

  fill() {
    while (this.running < this.options.parallel) {
      const iteratorValue = this.iterator.next();
      if (iteratorValue.done) {
        break;
      }
      this.wrap(this.start(iteratorValue.value));
    }

    if (this.running === 0) {
      if (this.errors > 0 && this.options.reject) {
        this.options.reject(this.results);
      } else {
        this.options.resolve(this.results);
      }
    }
  }
}

async function execute(iterable, callback, options = {}) {
  return new Promise((resolve, reject) => {
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

async function main() {
  console.time('execute');
  await execute(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    val => {
      return new Promise(resolve => setTimeout(resolve, 1000));
    },
    { parallel: 2 },
  );
  console.timeEnd('execute');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
