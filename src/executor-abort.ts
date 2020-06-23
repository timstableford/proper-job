export class ExecutorAbortError extends Error {
  public constructor() {
    super('Execution aborted');
  }
}
