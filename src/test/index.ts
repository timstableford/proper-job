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
});
