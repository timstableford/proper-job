import { AsyncBufferIterator } from './async-buffer-iterator';
import { AsyncBufferOptions } from './api-types';
import { EventEmitter } from 'events';

const DEFAULT_BUFFER_SIZE = 100;

export class AsyncBuffer<T> extends EventEmitter implements AsyncIterable<T> {
  protected buffer: T[] = [];
  protected maxSize: number;
  protected running = true;

  public constructor(options?: AsyncBufferOptions) {
    super();
    this.maxSize = options && options.maxSize ? options.maxSize : DEFAULT_BUFFER_SIZE;
    this.setMaxListeners(this.maxSize * 4);
  }

  public get length(): number {
    return this.buffer.length;
  }

  public async push(element: T): Promise<void> {
    if (this.running === false) {
      throw new Error('Cannot push. Shutting down');
    }

    while (this.buffer.length >= this.maxSize) {
      await this.waitForPop();
    }
    this.buffer.push(element);
    this.emit('push');
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
    this.emit('pop');
    return element;
  }

  public async quit(): Promise<void> {
    this.running = false;
    while (this.buffer.length > 0) {
      await this.waitForPop();
    }
    // So that if there's no items it cancels waiting for a push.
    this.emit('push');
  }

  public [Symbol.asyncIterator](): AsyncIterator<T> {
    return new AsyncBufferIterator<T>(() => this.pop());
  }

  protected waitForPop(): Promise<void> {
    return new Promise(resolve => {
      this.once('pop', () => resolve());
    });
  }

  private waitForPush(): Promise<void> {
    return new Promise(resolve => {
      this.once('push', () => resolve());
    });
  }
}
