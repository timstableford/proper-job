import { EventEmitter } from 'events';
import { beforeEach, describe, it } from 'mocha';
import { expect } from 'chai';

import { PollingAsyncBuffer, PollingConnectionPoolRunner } from '../';

describe('Polling Async Buffer tests', () => {
  const valueEmitter = new EventEmitter();
  let runnerData: Array<string | undefined> = [];
  let created = 0;
  let destroyed = 0;
  let buffer: PollingAsyncBuffer<string>;
  let fetchError: Error | undefined;

  valueEmitter.setMaxListeners(100);

  class Runner implements PollingConnectionPoolRunner<string> {
    public constructor() {
      created = created + 1;
    }
    public quit(): Promise<void> {
      destroyed = destroyed + 1;
      return Promise.resolve();
    }

    public async fetch(): Promise<undefined | string[]> {
      // eslint-disable-next-line no-unmodified-loop-condition
      while (runnerData.length === 0 && !fetchError) {
        await new Promise(resolve => valueEmitter.once('value', resolve));
      }
      if (fetchError) {
        const err = fetchError;
        fetchError = undefined;
        throw err;
      }
      const element = runnerData.shift();
      return element !== undefined ? [element] : undefined;
    }
  }

  it('Creating runner throws an error handled', async () => {
    buffer = new PollingAsyncBuffer(
      () => {
        throw new Error('Test Error');
      },
      {
        minInstances: 1,
        maxInstances: 4,
      },
    );
    const err: Error = await new Promise(resolve => buffer.once('error', resolve));
    expect(err.message).to.equal('Test Error');

    await buffer.quit();
  });

  describe('Standard Instance', () => {
    beforeEach(() => {
      created = 0;
      destroyed = 0;

      runnerData = [];

      buffer = new PollingAsyncBuffer(() => new Runner(), {
        minInstances: 1,
        maxInstances: 4,
      });
    });

    afterEach(async () => {
      const quit = buffer.quit();
      // Need to now wait for all runners to return.
      // Simulate them all timing out by broadcasting undefined.
      for (let i = 0; i < 4; i++) {
        runnerData.push(undefined);
        valueEmitter.emit('value');
      }

      // Consume any leftover data (shouldnt be undefined)
      while (buffer.length > 0) {
        expect(await buffer.pop()).to.be.a('string');
      }

      await quit;
    });

    it('Startup and shutdown', async () => {
      const resPromise = buffer.pop();
      runnerData.push('bob');
      valueEmitter.emit('value');
      expect(await resPromise).to.equal('bob');
    });

    it('Fetch error handled and emitted', async () => {
      // Wait for the initial instance
      // eslint-disable-next-line no-unmodified-loop-condition
      while (created === 0) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      const errorPromise: Promise<Error> = new Promise(resolve => buffer.once('error', resolve));
      fetchError = new Error('Test Error');
      valueEmitter.emit('value');

      const error = await errorPromise;
      expect(error.message).to.equal('Test Error');
    });

    it('Scale up', async () => {
      // Wait for the initial instance
      // eslint-disable-next-line no-unmodified-loop-condition
      while (created === 0) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      for (let i = 0; i < 3; i++) {
        runnerData.push(String(i));
        valueEmitter.emit('value');

        await buffer.pop();
      }

      expect(created).to.be.above(1);
    });

    it('Iterate a load of values', async () => {
      for (let i = 0; i < 1000; i++) {
        runnerData.push(String(i));
        valueEmitter.emit('value');
      }

      let received = 0;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _res of buffer) {
        received = received + 1;
        if (received === 300) {
          expect(buffer.getInstanceCount()).to.equal(4);
        }
        if (received >= 1000) {
          break;
        }
      }
      expect(received).to.equal(1000);
    });

    it('Scale down', async () => {
      // Need to scale up first.
      for (let i = 0; i < 1000; i++) {
        runnerData.push(String(i));
        valueEmitter.emit('value');
      }

      for (let i = 0; i < 1000; i++) {
        await buffer.pop();
      }

      expect(buffer.getInstanceCount()).to.equal(4);

      // Emitting undefined counts as a poll timeout so it should then destroy an instance.
      runnerData.push(undefined);
      valueEmitter.emit('value');

      await new Promise(resolve => buffer.once('scale', resolve));
      expect(buffer.getInstanceCount()).to.equal(3);

      // If it then emits a value the next one shouldn't shut down.
      runnerData.push('bob');
      valueEmitter.emit('value');

      // Wait a couple of ticks to be sure.
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(buffer.getInstanceCount()).to.equal(3);

      // Scale down again
      runnerData.push(undefined);
      valueEmitter.emit('value');

      await new Promise(resolve => buffer.once('scale', resolve));
      expect(buffer.getInstanceCount()).to.equal(2);
    });

    it('Recive data, idle and then receive more data', async () => {
      {
        const resPromise = buffer.pop();
        runnerData.push('bob');
        valueEmitter.emit('value');
        expect(await resPromise).to.equal('bob');
      }

      // Simulate timeout for a while
      for (let i = 0; i < 10; i++) {
        runnerData.push(undefined);
        valueEmitter.emit('value');
      }

      // Receive further data
      {
        const resPromise = buffer.pop();
        runnerData.push('jeff');
        valueEmitter.emit('value');
        expect(await resPromise).to.equal('jeff');
      }
    });

    it('Idle and then receive data', async () => {
      // Simulate timeout for a while
      for (let i = 0; i < 1000; i++) {
        runnerData.push(undefined);
        valueEmitter.emit('value');
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      // Receive further data
      {
        const resPromise = buffer.pop();
        runnerData.push('jeff');
        valueEmitter.emit('value');
        expect(await resPromise).to.equal('jeff');
      }
    });
  });
});
