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

export type ExecutorCallback<K, V> = (value: K) => Promise<V>;
