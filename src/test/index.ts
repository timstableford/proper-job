import { describe, it } from 'mocha';
import { execute } from '../';
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
});
