export type PopFunction<T> = () => Promise<T | undefined>;

export class AsyncBufferIterator<T> implements AsyncIterator<T> {
  private popFunction: PopFunction<T>;

  public constructor(popFunction: PopFunction<T>) {
    this.popFunction = popFunction;
  }

  public async next(): Promise<IteratorResult<T>> {
    const value = await this.popFunction();

    if (value !== undefined) {
      return { value, done: false };
    } else {
      return { value: undefined, done: true };
    }
  }
}
