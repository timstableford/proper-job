import { MockAsyncIterator } from './mock-async-iterator';

export class MockAsyncIterable<K> implements AsyncIterable<K> {
  private iterable: Iterable<K>;

  public constructor(iterable: Iterable<K>) {
    this.iterable = iterable;
  }

  public [Symbol.asyncIterator](): AsyncIterator<K> {
    return new MockAsyncIterator<K>(this.iterable[Symbol.iterator]());
  }
}
