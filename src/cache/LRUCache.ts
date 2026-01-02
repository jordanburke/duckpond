import { List } from "functype/list"
import { Option } from "functype/option"
import { LRUCache as LRU } from "lru-cache"

import type { UserDatabase } from "../types"
import { loggers } from "../utils/logger"

const log = loggers.cache

/**
 * Cache options for the LRU cache
 */
export interface LRUCacheOptions<T extends UserDatabase> {
  /** Maximum number of items in cache */
  maxSize: number
  /** Time-to-live in milliseconds (optional, defaults to no TTL) */
  ttl?: number
  /** Callback when items are evicted/disposed */
  dispose?: (value: T, key: string, reason: "evict" | "set" | "delete" | "stale") => void
}

/**
 * Functype-compatible LRU Cache wrapper
 *
 * Wraps the battle-tested lru-cache package with functype Option<T> and List<T>
 * for type-safe null handling and immutable collections.
 *
 * @example
 * ```typescript
 * const cache = new LRUCache<UserDatabase>({
 *   maxSize: 100,
 *   ttl: 1000 * 60 * 30, // 30 min
 *   dispose: (value, key, reason) => {
 *     console.log(`Evicting ${key}: ${reason}`)
 *   }
 * })
 *
 * cache.set("user1", userDb)
 * const result = cache.get("user1") // Option<UserDatabase>
 * result.fold(
 *   () => console.log("Not found"),
 *   (db) => console.log("Found:", db.userId)
 * )
 * ```
 */
export class LRUCache<T extends UserDatabase> {
  private cache: LRU<string, T>
  private readonly maxSize: number

  constructor(options: number | LRUCacheOptions<T>) {
    const opts = typeof options === "number" ? { maxSize: options } : options

    this.maxSize = opts.maxSize

    this.cache = new LRU<string, T>({
      max: opts.maxSize,
      ttl: opts.ttl,
      updateAgeOnGet: true, // Reset TTL on access
      dispose: opts.dispose
        ? (value, key, reason) => {
            log(`Disposing ${key} (reason: ${reason})`)
            opts.dispose!(value, key, reason as "evict" | "set" | "delete" | "stale")
          }
        : undefined,
    })

    log(`Created LRU cache with maxSize=${opts.maxSize}${opts.ttl ? `, ttl=${opts.ttl}ms` : ""}`)
  }

  /**
   * Get a value from the cache
   * Returns Option.Some(value) if found, Option.None otherwise
   */
  get(key: string): Option<T> {
    const value = this.cache.get(key)
    if (value !== undefined) {
      // Update lastAccess for stats tracking
      value.lastAccess = new Date()
      log(`Cache hit: ${key}`)
      return Option(value)
    }
    return Option.none()
  }

  /**
   * Set a value in the cache
   * Automatically evicts LRU item if at capacity
   */
  set(key: string, value: T): void {
    value.lastAccess = new Date()
    this.cache.set(key, value)
    log(`Cache set: ${key} (size=${this.cache.size})`)
  }

  /**
   * Remove a value from the cache
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key)
    if (deleted) {
      log(`Cache delete: ${key}`)
    }
    return deleted
  }

  /**
   * Check if a key exists in the cache (without updating recency)
   */
  has(key: string): boolean {
    return this.cache.has(key)
  }

  /**
   * Get the least recently used key
   * Returns Option.Some(key) if cache not empty, Option.None otherwise
   *
   * Note: lru-cache maintains LRU order, so we iterate from oldest to newest
   */
  getLRU(): Option<string> {
    // lru-cache keys() iterates from most recent to least recent by default
    // Use rkeys() to get reverse (LRU first) order
    const result = this.cache.rkeys().next()
    if (result.done || result.value === undefined) {
      return Option.none()
    }
    return Option(result.value)
  }

  /**
   * Get all keys for items older than the timeout
   * Returns a List of stale keys (functype immutable list)
   *
   * Note: If using TTL, stale items are automatically handled by the cache.
   * This method is for manual staleness checks based on lastAccess.
   */
  getStale(timeoutMs: number): List<string> {
    const now = Date.now()
    const staleKeys: string[] = []

    for (const key of this.cache.keys()) {
      const value = this.cache.peek(key) // peek doesn't update recency
      if (value && now - value.lastAccess.getTime() > timeoutMs) {
        staleKeys.push(key)
      }
    }

    if (staleKeys.length > 0) {
      log(`Found ${staleKeys.length} stale items`)
    }

    return List(staleKeys)
  }

  /**
   * Get the current size of the cache
   */
  size(): number {
    return this.cache.size
  }

  /**
   * Clear all items from the cache
   * Note: This triggers dispose callbacks for each item
   */
  clear(): void {
    const size = this.cache.size
    this.cache.clear()
    log(`Cache cleared (removed ${size} items)`)
  }

  /**
   * Get all values as a List (functype immutable list)
   */
  values(): List<T> {
    return List(Array.from(this.cache.values()))
  }

  /**
   * Get all keys as a List
   */
  keys(): List<string> {
    return List(Array.from(this.cache.keys()))
  }

  /**
   * Purge stale items (TTL expired)
   * Call this to force cleanup of expired items
   */
  purgeStale(): void {
    this.cache.purgeStale()
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number
    maxSize: number
    utilizationPercent: number
    oldestAccessTime: Option<Date>
  } {
    const values = this.values().toArray()
    const sorted = values.sort((a, b) => a.lastAccess.getTime() - b.lastAccess.getTime())
    const oldestAccessTime = Option(sorted[0]).map((item) => item.lastAccess)

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      utilizationPercent: (this.cache.size / this.maxSize) * 100,
      oldestAccessTime,
    }
  }
}
