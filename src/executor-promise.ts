export type AbortCallback = () => void;
export type ExecutorPromiseCallback<T> = (
  resolve: (value: T) => void,
  reject: (error: Error) => void,
) => void | AbortCallback;

export class ExecutorPromise<T> extends Promise<T> {
  private abortCallback?: AbortCallback;

  public constructor(callback: ExecutorPromiseCallback<T>) {
    let abortCallback: AbortCallback | undefined | void = undefined;

    super((resolve, reject) => {
      abortCallback = callback(resolve, reject);
    });

    if (abortCallback) {
      this.abortCallback = abortCallback;
    }
  }

  public abort(): void {
    if (!this.abortCallback) {
      throw new Error('Abort not implemented');
    }
    this.abortCallback();
  }
}
