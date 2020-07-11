export abstract class ConnectionPoolRunner {
  public abstract quit(): Promise<void>;
}
