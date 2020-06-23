import { ExecutorAbortError, execute } from '../';
import { MockAsyncIterable } from './mock-async-iterable';
import { describe, it } from 'mocha';
import { expect } from 'chai';

describe('Tests', () => {
  it('Start with empty iterator', async () => {
    const result = await execute([], () => Promise.resolve());
    expect(result.fulfilled).to.equal(0);
  });

  describe('Fixed sequences', () => {
    const expected = [
      { parallel: 1, min: 545, max: 560 },
      { parallel: 2, min: 290, max: 310 },
      { parallel: 4, min: 175, max: 190 },
    ];

    for (const value of expected) {
      it(`Time matches expected with parallel ${value.parallel}`, async () => {
        const startTime = Date.now();
        const result = await execute(
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
          val => {
            return new Promise(resolve => setTimeout(() => resolve(val), val * 10));
          },
          { parallel: value.parallel },
        );
        const runTime = Date.now() - startTime;

        expect(result.fulfilled).to.equal(10);
        expect(runTime).to.be.above(value.min);
        expect(runTime).to.be.below(value.max);
      });
    }
  });

  it('Abort', async () => {
    const startTime = Date.now();
    const resultPromise = execute(
      [1, 2, 3, 4, 5, 6],
      () => new Promise(resolve => setTimeout(resolve, 50)),
    );
    await new Promise(resolve => setTimeout(resolve, 100));
    resultPromise.abort();

    const result = await resultPromise;
    const runTime = Date.now() - startTime;
    expect(result.fulfilled).to.be.above(0);
    expect(result.fulfilled).to.be.below(4);
    // Should run between 1 and 3 of the results. Plus some jitter.
    expect(runTime).to.be.above(49);
    expect(runTime).to.be.below(155);
  });

  it('continueOnError true', async () => {
    const result = await execute(
      [1, 2, 3, 4, 5, 6],
      val => {
        if (val === 3) {
          return Promise.reject(new Error('3 failed'));
        }
        return new Promise(resolve => setTimeout(resolve, 10));
      },
      { throwOnError: false, continueOnError: true },
    );

    expect(result.fulfilled).to.equal(5);
    // Because they return undefined.
    expect(result.results.length).to.equal(0);
    expect(result.errors.length).to.equal(1);
    const errorThree = result.errors[0];
    expect(errorThree).to.be.an('error');
    expect(errorThree.message).to.equal('3 failed');
  });

  it('continueOnError false', async () => {
    const result = await execute(
      [1, 2, 3, 4, 5, 6],
      val => {
        if (val === 3) {
          return Promise.reject(new Error('3 failed'));
        }
        return new Promise(resolve => setTimeout(resolve, 10));
      },
      { throwOnError: false, continueOnError: false },
    );

    expect(result.fulfilled).to.equal(2);
    // Because they return undefined.
    expect(result.results.length).to.equal(0);
    expect(result.errors.length).to.equal(1);
    const errorThree = result.errors[0];
    expect(errorThree).to.be.an('error');
    expect(errorThree.message).to.equal('3 failed');
  });

  it('throwOnError true', async () => {
    const resultPromise = execute([1], () => Promise.reject(new Error('failed')), {
      throwOnError: true,
      continueOnError: true,
    });
    await new Promise((resolve, reject) => {
      resultPromise
        .then(() => {
          reject(new Error('Did not throw'));
        })
        .catch(error => {
          try {
            expect(error).to.be.an('error');
            const result = error.result;
            expect(result.fulfilled).to.equal(0);
            // Because they return undefined.
            expect(result.results.length).to.equal(0);
            expect(result.errors.length).to.equal(1);
            const errorThree = result.errors[0];
            expect(errorThree).to.be.an('error');
            expect(errorThree.message).to.equal('failed');
            resolve();
          } catch (err) {
            reject(err);
          }
        });
    });
  });

  it('throwOnError false', async () => {
    const result = await execute([1], () => Promise.reject(new Error('failed')), {
      throwOnError: false,
      continueOnError: true,
    });

    expect(result.fulfilled).to.equal(0);
    expect(result.results.length).to.equal(0);
    expect(result.errors.length).to.equal(1);
    const errorThree = result.errors[0];
    expect(errorThree).to.be.an('error');
    expect(errorThree.message).to.equal('failed');
  });

  it('storeOutput true', async () => {
    const input = [1, 2, 3, 4, 5, 6];
    const result = await execute(
      input,
      val => {
        return Promise.resolve({ input: val, output: val * 2 });
      },
      { storeOutput: true },
    );

    expect(result.fulfilled).to.equal(6);
    expect(result.results.length).to.equal(6);
    expect(result.errors.length).to.equal(0);

    for (const value of input) {
      expect(result.results.find(res => res.input === value)).to.be.an('object');
    }
  });

  it('storeOutput false', async () => {
    const result = await execute(
      [1, 2, 3, 4, 5, 6],
      val => {
        return Promise.resolve(val * 2);
      },
      { storeOutput: false },
    );

    expect(result.fulfilled).to.equal(6);
    expect(result.results.length).to.equal(0);
    expect(result.errors.length).to.equal(0);
  });

  it('Run on Map', async () => {
    const map = new Map<string, number>();
    map.set('hello', 10);
    map.set('world', 30);

    const result = await execute(map, ([key, value]) => {
      switch (key) {
        case 'hello':
          if (value !== 10) {
            throw new Error('Invalid value for hello');
          }
          break;
        case 'world':
          if (value !== 30) {
            throw new Error('Invalid value for hello');
          }
          break;
        default:
          throw new Error(`Unexpected key: ${key}`);
      }
      return Promise.resolve({ key, value: value / 2 });
    });

    expect(result.fulfilled).to.equal(2);
    expect(result.results.length).to.equal(2);
    const a = result.results.find(el => el.key === 'hello');
    expect(a).to.be.an('object');
    expect(a!.value).to.equal(5);

    const b = result.results.find(el => el.key === 'world');
    expect(b).to.be.an('object');
    expect(b!.value).to.equal(15);
  });

  it('Handle unpromised error', async () => {
    const result = await execute(
      [1],
      () => {
        throw new Error('failed');
      },
      { throwOnError: false },
    );

    expect(result.fulfilled).to.equal(0);
    expect(result.errors.length).to.equal(1);
  });

  it('iterable promise (callback)', async () => {
    let initCalled = false;
    await execute(
      () => {
        initCalled = true;
        return Promise.resolve([1]);
      },
      () => {
        expect(initCalled).to.equal(true);
        return Promise.resolve();
      },
    );

    expect(initCalled).to.equal(true);
  });

  it('iterable promise throws error (callback)', async () => {
    let initCalled = false;
    const result = await execute(
      () => {
        initCalled = true;
        throw new Error();
      },
      () => {
        return Promise.reject(new Error('Should not be called since init failed'));
      },
      {
        throwOnError: false,
      },
    );

    expect(initCalled).to.equal(true);
    expect(result.errors.length).to.equal(1);
  });

  it('iterable promise rejects (callback)', async () => {
    let initCalled = false;
    const result = await execute(
      () => {
        initCalled = true;
        return Promise.reject(new Error());
      },
      () => {
        return Promise.reject(new Error('Should not be called since init failed'));
      },
      {
        throwOnError: false,
      },
    );

    expect(initCalled).to.equal(true);
    expect(result.errors.length).to.equal(1);
  });

  it('iterable promise', async () => {
    const promiseIterator = Promise.resolve([1]);

    const result = await execute(promiseIterator, () => {
      return Promise.resolve();
    });

    expect(result.fulfilled).to.equal(1);
  });

  it('iterable promise rejection', async () => {
    const promiseIterator = Promise.reject(new Error());

    const result = await execute(
      promiseIterator,
      () => {
        return Promise.resolve();
      },
      { throwOnError: false },
    );

    expect(result.fulfilled).to.equal(0);
    expect(result.errors.length).to.equal(1);
  });

  it('iterable promise (callback) with init and sleep', async () => {
    const result = await execute(
      async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return {
          init: 'some arbitrary data',
          iterable: [1],
        };
      },
      async (value, init) => {
        await new Promise(resolve => setTimeout(resolve, 5));
        expect(value).to.equal(1);
        expect(init).to.equal('some arbitrary data');
      },
    );

    expect(result.fulfilled).to.equal(1);
  });

  it('calls teardown', async () => {
    let teardownCalled = false;
    const result = await execute(
      [],
      () => Promise.resolve(),
      {},
      () => {
        teardownCalled = true;
        return Promise.resolve();
      },
    );

    expect(teardownCalled).to.equal(true);
    expect(result.fulfilled).to.equal(0);
  });

  it('teardown called only when done', async () => {
    const numbers: number[] = [];
    for (let i = 0; i < 100; i++) {
      numbers.push(i);
    }

    let teardownCalled = false;
    const result = await execute(
      numbers,
      async () => {
        expect(teardownCalled).to.equal(false);
        await new Promise(resolve => setTimeout(resolve, 3));
      },
      { parallel: 4 },
      () => {
        teardownCalled = true;
        return Promise.resolve();
      },
    );

    expect(teardownCalled).to.equal(true);
    expect(result.fulfilled).to.equal(100);
  });

  it('teardown has init value', async () => {
    let teardownCalled = false;
    const result = await execute(
      Promise.resolve({ iterable: [], init: 'VALUEY' }),
      () => Promise.resolve(),
      {},
      init => {
        teardownCalled = true;
        expect(init).to.equal('VALUEY');
        return Promise.resolve();
      },
    );

    expect(teardownCalled).to.equal(true);
    expect(result.fulfilled).to.equal(0);
  });

  it('teardown reject', async () => {
    let teardownCalled = false;
    const result = await execute(
      [],
      () => Promise.resolve(),
      { throwOnError: false },
      () => {
        teardownCalled = true;
        return Promise.reject(new Error());
      },
    );

    expect(teardownCalled).to.equal(true);
    expect(result.fulfilled).to.equal(0);
    expect(result.errors.length).to.equal(1);
  });

  it('teardown throws non-promise error', async () => {
    let teardownCalled = false;
    const result = await execute(
      [],
      () => Promise.resolve(),
      { throwOnError: false },
      () => {
        teardownCalled = true;
        throw new Error();
      },
    );

    expect(teardownCalled).to.equal(true);
    expect(result.fulfilled).to.equal(0);
    expect(result.errors.length).to.equal(1);
  });

  it('async iterator support', async () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const valuesAsync = new MockAsyncIterable(values);

    interface ProcessOutput {
      input: number;
      output: number;
    }

    const result = await execute<number, ProcessOutput>(
      valuesAsync,
      async value => {
        await new Promise(resolve => setTimeout(resolve, 1));
        return {
          input: value,
          output: value * 10,
        };
      },
      { parallel: 4 },
    );

    expect(result.fulfilled).to.equal(10);
    expect(result.errors.length).to.equal(0);
    expect(result.results.length).to.equal(10);

    for (const res of result.results) {
      expect(res.output).to.equal(res.input * 10);
    }
  });

  it('async iterator where parallel greater than job count and all fail', async () => {
    const values = [1, 2, 3, 4, 5, 6, 7];
    const valuesAsync = new MockAsyncIterable(values);

    const result = await execute<number, void>(
      valuesAsync,
      () => {
        throw new Error('Failed');
      },
      { parallel: 16, throwOnError: false },
    );

    expect(result.errors.length).to.equal(7);
  });

  it('throw ExecutorAbortError to finish early', async () => {
    const values = [1, 2, 3, 4, 5, 6, 7];

    const result = await execute<number, void>(
      values,
      i => {
        if (i === 4) {
          throw new ExecutorAbortError();
        }
        return Promise.resolve();
      },
      { parallel: 1, continueOnError: true, throwOnError: false },
    );

    expect(result.errors.length).to.equal(0);
    expect(result.fulfilled).to.equal(3);
    expect(result.aborted).to.equal(true);
  });
});
