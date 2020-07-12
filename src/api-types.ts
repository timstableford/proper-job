import { ConnectionPoolRunner } from './connection-pool-runner';
import { PollingConnectionPoolRunner } from './polling-connection-pool-runner';

export interface ExecutorConfig {
  parallel?: number;
  continueOnError?: boolean;
  storeOutput?: boolean;
  throwOnError?: boolean;
  maxErrors?: number;
}

export interface AsyncBufferOptions {
  maxSize?: number;
}

export interface ExecutorResults<V> {
  results: V[];
  errors: Error[];
  fulfilled: number;
  aborted?: boolean;
}

export interface ExecutorInit<K, T> {
  iterable: Iterable<K> | AsyncIterable<K>;
  init: T;
}

export type ExecutorInitResult<K, T> = Iterable<K> | AsyncIterable<K> | ExecutorInit<K, T>;

export type ExecutorCallback<K, V, T> = (value: K, init?: T) => Promise<V>;
export type ExecutorIterableFunction<K, T> = () => Promise<ExecutorInitResult<K, T>>;
export type ExecutorIterable<K, T> =
  | Promise<ExecutorInitResult<K, T>>
  | ExecutorInitResult<K, T>
  | ExecutorIterableFunction<K, T>;

export type CreateRunnerCallback<T extends ConnectionPoolRunner> = () => Promise<T> | T;
export type CreatePollingRunnerCallback<T> = () =>
  | Promise<PollingConnectionPoolRunner<T>>
  | PollingConnectionPoolRunner<T>;
export type ClaimCallback<T extends ConnectionPoolRunner, V = void> = (
  instance: T,
) => Promise<V> | V;

export interface ConnectionPoolOptionsInternal {
  // Minimum number of instances, created on start.
  minInstances: number;
  // Maximum number of instances allowed.
  maxInstances: number;
  // Scale down when load is above this level.
  scaleDownAt: number;
  // Scale up when load is above this level.
  scaleUpAt: number;
  // Period to check usage and scale either direction by 1.
  scaleInterval: number;
  // True to allow scaling instantly when no instances are available
  // rather than if the average usage is exceeded.
  responsiveScale: boolean;
  // Periodicially evaluate usage and scale up or down.
  // Disabling this also disabled responsiveScale.
  // Note even when disabled it will still scale to the minimum.
  autoScale: boolean;
}

export type ConnectionPoolOptions = Partial<ConnectionPoolOptionsInternal>;

export interface PollingAsyncBufferOptions extends ConnectionPoolOptions, AsyncBufferOptions {}
