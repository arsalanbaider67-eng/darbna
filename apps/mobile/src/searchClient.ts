import type { LngLat } from "@darbna/core";

export interface SearchOptions { remote?: boolean; autocomplete?: boolean }

/** Serializes request starts. A full search waits its turn instead of silently losing a provider. */
export function createRequestGate(intervalMs: number, now = Date.now, sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
  let nextStart = 0;
  let queue = Promise.resolve();
  return () => {
    const turn = queue.then(async () => {
      const wait = nextStart - now();
      if (wait > 0) await sleep(wait);
      nextStart = now() + intervalMs;
    });
    queue = turn.catch(() => {});
    return turn;
  };
}

/** Cache successful queries briefly and share in-flight requests; failed providers can be retried. */
export function createCachedSearch<T>(load: (q: string, lang: string, near: LngLat | undefined, opts: SearchOptions) => Promise<{ results: T[]; partial: boolean }>, now = Date.now) {
  type Result = { results: T[]; partial: boolean };
  const cache = new Map<string, { at: number; result: Result }>();
  const pending = new Map<string, Promise<Result>>();
  return (q: string, lang: string, near?: LngLat, opts: SearchOptions = {}): Promise<Result> => {
    const query = q.trim().replace(/\s+/g, " ");
    const key = JSON.stringify([query, lang, near, !!opts.remote, !!opts.autocomplete]);
    const hit = cache.get(key);
    if (hit && now() - hit.at < 180_000) return Promise.resolve(hit.result);
    const running = pending.get(key);
    if (running) return running;
    const request = Promise.resolve().then(() => load(query, lang, near, opts)).then(result => {
      if (!result.partial) {
        if (cache.size >= 100) cache.delete(cache.keys().next().value!);
        cache.set(key, { at: now(), result });
      }
      return result;
    }).finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
}
