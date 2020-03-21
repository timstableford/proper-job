export interface ExecutorConfig {
  parallel?: number;
  continueOnError?: boolean;
  storeOutput?: boolean;
  throwOnError?: boolean;
}

export interface ExecutorResults<V> {
  results: V[];
  errors: Error[];
  fulfilled: number;
  aborted?: boolean;
}

export interface ExecutorInit<K, T> {
  iterable: Iterable<K>;
  init: T;
}

export type ExecutorInitResult<K, T> = Iterable<K> | ExecutorInit<K, T>;

export type ExecutorCallback<K, V, T> = (value: K, init?: T) => Promise<V>;
export type ExecutorIterableFunction<K, T> = () => Promise<ExecutorInitResult<K, T>>;
export type ExecutorIterable<K, T> =
  | Promise<ExecutorInitResult<K, T>>
  | ExecutorInitResult<K, T>
  | ExecutorIterableFunction<K, T>;
