import { List } from "functype/list"
import { Option } from "functype/option"

import type { UserDatabase } from "../types"
import { loggers } from "../utils/logger"

const log = loggers.cache

/**
 * LRU Cache for managing active user database connections
 *
 * Uses functype Option for safe null handling
 */
export class LRUCache<T extends UserDatabase> {
  private cache: Map<string, T>
  private readonly maxSize: number

  constructor(maxSize: number = 10) {
    this.cache = new Map()
    this.maxSize = maxSize
    log(`Created LRU cache with maxSize=${maxSize}`)
  }

  /**
   * Get a value from the cache
   * Returns Option.Some(value) if found, Option.None otherwise
   */
  get(key: string): Option<T> {
    return Option(this.cache.get(key)).map((item) => {
      // Move to end (most recently used)
      this.cache.delete(key)
      this.cache.set(key, item)
      item.lastAccess = new Date()
      log(`Cache hit: ${key}`)
      return item
    })
  }

  /**
   * Set a value in the cache
   * Evicts LRU item if at capacity
   */
  set(key: string, value: T): void {
    // Remove if exists (to update position)
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }

    // Evict LRU if at capacity
    if (this.cache.size >= this.maxSize) {
      this.evictLRU()
    }

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
   * Check if a key exists in the cache
   */
  has(key: string): boolean {
    return this.cache.has(key)
  }

  /**
   * Get the least recently used key
   * Returns Option.Some(key) if cache not empty, Option.None otherwise
   */
  getLRU(): Option<string> {
    const firstKey = this.cache.keys().next().value
    return Option(firstKey)
  }

  /**
   * Evict the least recently used item
   */
  private evictLRU(): void {
    this.getLRU().forEach((key) => {
      log(`Evicting LRU: ${key}`)
      this.cache.delete(key)
    })
  }

  /**
   * Get all keys for items older than the timeout
   * Returns a List of stale keys (functype immutable list)
   */
  getStale(timeoutMs: number): List<string> {
    const now = Date.now()
    const staleKeys: string[] = []

    for (const [key, value] of this.cache.entries()) {
      const age = now - value.lastAccess.getTime()
      if (age > timeoutMs) {
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
