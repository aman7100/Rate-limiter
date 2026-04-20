'use strict';

class StatsTracker {
  constructor() {
    this._stats = new Map();
  }

  record(userId, allowed, now = Date.now()) {
    let s = this._stats.get(userId);
    if (!s) {
      s = { total: 0, allowed: 0, rejected: 0, firstRequestAt: now, lastRequestAt: now };
      this._stats.set(userId, s);
    }
    s.total++;
    if (allowed) s.allowed++;
    else s.rejected++;
    s.lastRequestAt = now;
  }

  getUser(userId) {
    const s = this._stats.get(userId);
    return s ? { ...s } : null;
  }

  snapshot(limiter, now = Date.now()) {
    const out = {};
    for (const [userId, s] of this._stats) {
      out[userId] = {
        ...s,
        currentWindowCount: limiter ? limiter.getCount(userId, now) : undefined,
      };
    }
    return out;
  }

  get trackedUsers() {
    return this._stats.size;
  }

  reset() {
    this._stats.clear();
  }
}

module.exports = { StatsTracker };
