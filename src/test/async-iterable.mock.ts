import { ItOptions, MockAsyncIterator } from './async-iterator.mock';

export class MockAsyncIterable<K> implements AsyncIterable<K> {
  private iterable: Iterable<K>;
  private options?: ItOptions;

  public constructor(iterable: Iterable<K>, options?: ItOptions) {
    this.iterable = iterable;
    this.options = options;
  }

  public [Symbol.asyncIterator](): AsyncIterator<K> {
    return new MockAsyncIterator<K>(this.iterable[Symbol.iterator](), this.options);
  }
}
