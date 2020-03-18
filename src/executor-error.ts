import { ExecutorResults } from './api-types';

export class ExecutorError<V> extends Error {
  public readonly result: ExecutorResults<V>;

  public constructor(result: ExecutorResults<V>) {
    super(`${result.errors.length} executor errors`);
    this.result = result;
  }
}
