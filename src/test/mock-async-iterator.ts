export class MockAsyncIterator<K> implements AsyncIterator<K> {
  private iterator: Iterator<K>;

  public constructor(iterator: Iterator<K>) {
    this.iterator = iterator;
  }

  public async next(): Promise<IteratorResult<K>> {
    await new Promise(resolve => setTimeout(resolve, 5));
    return this.iterator.next();
  }
}
