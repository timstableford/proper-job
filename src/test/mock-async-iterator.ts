export interface ItOptions {
  throwAfter?: number;
  throwAfterAsync?: number;
}

export class MockAsyncIterator<K> implements AsyncIterator<K> {
  private iterator: Iterator<K>;
  private options?: ItOptions;
  private count = 0;

  public constructor(iterator: Iterator<K>, options?: ItOptions) {
    this.iterator = iterator;
    this.options = options;
  }

  public async next(): Promise<IteratorResult<K>> {
    this.count = this.count + 1;

    if (this.options) {
      if (this.options.throwAfter && this.options.throwAfter > this.count) {
        throw new Error('iterator failure');
      }

      if (this.options.throwAfterAsync && this.options.throwAfterAsync > this.count) {
        return Promise.reject(new Error('iterator async failure'));
      }
    }

    await new Promise(resolve => setTimeout(resolve, 5));
    return this.iterator.next();
  }
}
