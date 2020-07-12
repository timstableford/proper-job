import { ConnectionPoolRunner } from './connection-pool-runner';

export abstract class PollingConnectionPoolRunner<T> extends ConnectionPoolRunner {
  public abstract fetch(): Promise<T | undefined>;
}
