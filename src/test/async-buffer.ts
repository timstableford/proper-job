import { describe, it } from 'mocha';
import { expect } from 'chai';

import { AsyncBuffer } from '../async-buffer';
import { execute } from '../';

describe('Async Buffer Tests', () => {
  it('Basic push pop single item and quit on drain', async () => {
    const buffer = new AsyncBuffer<string>();

    let popped: string | undefined = undefined;
    const popper = buffer.pop().then(value => {
      popped = value;
    });

    expect(popped).to.equal(undefined);
    await buffer.push('jeff');
    await popper;
    expect(popped).to.equal('jeff');

    const quitPopper = buffer.pop();
    await buffer.quit();
    await quitPopper;
  });

  it('Iterate pushed values and quit', async () => {
    const buffer = new AsyncBuffer<number>();

    let iteratorComplete = false;
    const valueCounter = (async (): Promise<number> => {
      let valueCount = 0;
      for await (const value of buffer) {
        valueCount = valueCount + value;
      }
      iteratorComplete = true;
      return valueCount;
    })();

    expect(iteratorComplete, 'Shouldnt be complete before values are pushed').to.equal(false);

    for (let i = 0; i < 10; i++) {
      await buffer.push(i);
    }

    expect(iteratorComplete, 'Shouldnt be complete before quit').to.equal(false);

    await buffer.quit();
    expect(await valueCounter, 'All values added').to.equal(45);
    expect(iteratorComplete, 'Should be complete').to.equal(true);
  });

  it('Iterate using executor ans quit', async () => {
    const buffer = new AsyncBuffer<number>();

    let valueCount = 0;
    let completed = false;

    const resPromise = execute(
      buffer,
      val => {
        valueCount = valueCount + val;
        return new Promise(resolve => setTimeout(resolve, 50));
      },
      { parallel: 10 },
    ).then(res => {
      completed = true;
      return res;
    });

    expect(completed, 'Shouldnt be complete before values pushed').to.equal(false);

    const startTime = Date.now();

    for (let i = 0; i < 10; i++) {
      await buffer.push(i);
    }

    expect(completed).to.equal(false, 'Shouldnt be complete before quit');
    const endTime = Date.now();
    await buffer.quit();

    const res = await resPromise;
    expect(res.fulfilled).to.equal(10);

    expect(completed).to.equal(true, 'Should be complete after quit resolved');
    expect(valueCount).to.equal(45);

    // If it's done in parallel at allt hen this should be true.
    expect(endTime - startTime).to.be.below(250);
  });
});
