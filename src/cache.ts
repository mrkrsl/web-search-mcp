/**
 * Small in-process caches.
 *
 * The server used to hit the network on every call: the same URL asked twice inside one research
 * pass was fetched twice, and a repeated query walked the whole engine chain again. Both are cheap
 * to avoid, and repeated traffic is what gets this egress IP rate-limited by the free engines
 * (see the DuckDuckGo cooldown in search-engine.ts).
 *
 * No timers are scheduled: entries expire on read and the oldest ones are dropped when the cache is
 * full, so a cache never keeps the event loop - or a browser - alive.
 */
export interface CacheStats {
  lookups: number;
  hits: number;
  sets: number;
  evictions: number;
}

export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();
  private readonly stats: CacheStats = { lookups: 0, hits: 0, sets: 0, evictions: 0 };

  /**
   * @param maxEntries   LRU bound; oldest entries are dropped first
   * @param defaultTtlMs 0 disables caching entirely (what NO_CACHE=true resolves to)
   */
  /** LRU bound; oldest entries are dropped first */
  constructor(private readonly maxEntries: number, private readonly defaultTtlMs: number) {}

  get enabled(): boolean {
    return this.defaultTtlMs > 0 && this.maxEntries > 0;
  }

  get(key: string): V | undefined {
    if (!this.enabled) return undefined;

    this.stats.lookups++;
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }

    // re-insert: Map iterates in insertion order, so this makes the entry the most recent one
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.stats.hits++;
    return entry.value;
  }

  set(key: string, value: V, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs;
    if (!this.enabled || ttl <= 0) return;

    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + ttl });
    this.stats.sets++;

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
      this.stats.evictions++;
    }
  }

  /** Seconds until the entry for `key` would expire - used in the cached-failure message. */
  remainingFor(key: string): number {
    const entry = this.entries.get(key);
    return entry ? Math.max(0, Math.round((entry.expiresAt - Date.now()) / 1000)) : 0;
  }

  get size(): number {
    return this.entries.size;
  }

  summary(): string {
    return `${this.stats.hits}/${this.stats.lookups} hits, ${this.entries.size} entries` +
      (this.stats.evictions ? `, ${this.stats.evictions} evicted` : '');
  }
}

/**
 * Joins concurrent calls with the same key onto one in-flight promise, so a burst of identical
 * requests costs one upstream request instead of N. The key is released as soon as the work
 * settles, so failures are not sticky.
 */
export class SingleFlight {
  private readonly inflight = new Map<string, Promise<unknown>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) {
      console.log(`[SingleFlight] Joining an in-flight request for ${key}`);
      return existing;
    }

    const promise = work().finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }
}
