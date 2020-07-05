import { AsyncBufferIterator } from './async-buffer-iterator';
import { AsyncBufferOptions } from './api-types';
import { EventEmitter } from 'events';

const DEFAULT_BUFFER_SIZE = 100;

export class AsyncBuffer<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private maxSize: number;
  private internalEvents = new EventEmitter();
  private running = true;

  public constructor(options?: AsyncBufferOptions) {
    this.maxSize = options && options.maxSize ? options.maxSize : DEFAULT_BUFFER_SIZE;
  }

  public async push(element: T): Promise<void> {
    if (this.running === false) {
      throw new Error('Cannot push. Shutting down');
    }

    while (this.buffer.length >= this.maxSize) {
      await this.waitForPop();
    }
    this.buffer.push(element);
    this.internalEvents.emit('push');
  }

  public async pop(): Promise<T | undefined> {
    while (this.buffer.length === 0 && this.running) {
      await this.waitForPush();
    }

    // Only exit when the buffers empty.
    if (!this.running && this.buffer.length === 0) {
      return undefined;
    }

    if (this.buffer.length === 0) {
      throw new Error('Running but buffer length is 0. This shouldnt be possible');
    }

    const element = this.buffer.shift();
    this.internalEvents.emit('pop');
    return element;
  }

  public async quit(): Promise<void> {
    this.running = false;
    while (this.buffer.length > 0) {
      await this.waitForPop();
    }
    // So that if there's no items it cancels waiting for a push.
    this.internalEvents.emit('push');
  }

  public [Symbol.asyncIterator](): AsyncIterator<T> {
    return new AsyncBufferIterator<T>(() => this.pop());
  }

  private waitForPop(): Promise<void> {
    return new Promise(resolve => {
      this.internalEvents.once('pop', () => resolve());
    });
  }

  private waitForPush(): Promise<void> {
    return new Promise(resolve => {
      this.internalEvents.once('push', () => resolve());
    });
  }
}
