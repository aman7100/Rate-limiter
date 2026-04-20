'use strict';

class SlidingWindowRateLimiter {
  constructor({ windowMs = 60_000, maxRequests = 5, sweepIntervalMs = 5 * 60_000 } = {}) {
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new TypeError('windowMs must be > 0');
    }
    if (!Number.isInteger(maxRequests) || maxRequests <= 0) {
      throw new TypeError('maxRequests must be a positive integer');
    }

    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.sweepIntervalMs = sweepIntervalMs;

    this._buckets = new Map();
    this._sweepTimer = null;
  }

  tryConsume(userId, now = Date.now()) {
    if (typeof userId !== 'string' || userId.length === 0) {
      throw new TypeError('userId must be a non-empty string');
    }

    const windowStart = now - this.windowMs;
    let ts = this._buckets.get(userId);
    if (!ts) {
      ts = [];
      this._buckets.set(userId, ts);
    }

    // Drop expired timestamps. Array is append-only in ascending order, so the
    // expired prefix is contiguous.
    let drop = 0;
    while (drop < ts.length && ts[drop] <= windowStart) drop++;
    if (drop) ts.splice(0, drop);

    if (ts.length >= this.maxRequests) {
      return {
        allowed: false,
        count: ts.length,
        remaining: 0,
        retryAfterMs: Math.max(0, ts[0] + this.windowMs - now),
        limit: this.maxRequests,
        windowMs: this.windowMs,
      };
    }

    ts.push(now);
    return {
      allowed: true,
      count: ts.length,
      remaining: this.maxRequests - ts.length,
      retryAfterMs: 0,
      limit: this.maxRequests,
      windowMs: this.windowMs,
    };
  }

  getCount(userId, now = Date.now()) {
    const ts = this._buckets.get(userId);
    if (!ts || ts.length === 0) return 0;
    const windowStart = now - this.windowMs;
    let i = 0;
    while (i < ts.length && ts[i] <= windowStart) i++;
    return ts.length - i;
  }

  sweep(now = Date.now()) {
    const windowStart = now - this.windowMs;
    let removed = 0;
    for (const [userId, ts] of this._buckets) {
      let i = 0;
      while (i < ts.length && ts[i] <= windowStart) i++;
      if (i) ts.splice(0, i);
      if (ts.length === 0) {
        this._buckets.delete(userId);
        removed++;
      }
    }
    return removed;
  }

  startSweeper() {
    if (this._sweepTimer) return;
    this._sweepTimer = setInterval(() => this.sweep(), this.sweepIntervalMs);
    this._sweepTimer.unref?.();
  }

  stopSweeper() {
    if (this._sweepTimer) {
      clearInterval(this._sweepTimer);
      this._sweepTimer = null;
    }
  }

  get trackedUsers() {
    return this._buckets.size;
  }
}

module.exports = { SlidingWindowRateLimiter };
