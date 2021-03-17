import { EventEmitter } from 'events';
import { expect } from 'chai';
import { it } from 'mocha';

import { PollingAsyncBuffer, PollingConnectionPoolRunner, execute } from '../';

it('Test using library components as a pipeline component', async () => {
  const valueEmitter = new EventEmitter();
  const runnerData: Array<number | undefined | null> = [];

  class Runner implements PollingConnectionPoolRunner<number> {
    public quit(): Promise<void> {
      return Promise.resolve();
    }

    public async fetch(): Promise<undefined | number[]> {
      await new Promise(resolve => setTimeout(resolve, 5));
      while (runnerData.length === 0) {
        await new Promise(resolve => valueEmitter.once('value', resolve));
      }
      const element = runnerData.shift();
      if (element === null) {
        return [];
      }
      return element !== undefined ? [element] : undefined;
    }
  }

  const buffer = new PollingAsyncBuffer(() => new Runner(), {
    minInstances: 1,
    maxInstances: 16,
  });

  let total = 0;
  let complete = 0;
  const executorPromise = execute(
    buffer,
    async element => {
      complete = complete + 1;
      total = total + element;
      await new Promise(resolve => setTimeout(resolve, 5));
    },
    { parallel: 16 },
  );

  for (let i = 0; i < 100; i++) {
    runnerData.push(i);
    valueEmitter.emit('value');
    runnerData.push(null);
    valueEmitter.emit('value');
  }

  await new Promise(resolve => buffer.once('scale', resolve));

  // Not all of them may have been polled yet. While the system
  // should guarantee that messages within it make it through it stops
  // listening too early if we're not careful.
  // eslint-disable-next-line no-unmodified-loop-condition
  while (complete < 100) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }

  const quitPromise = buffer.quit();
  for (let i = 0; i < 16; i++) {
    runnerData.push(undefined);
    valueEmitter.emit('value');
  }
  await quitPromise;

  await executorPromise;

  expect(total).to.equal(4950);
});
