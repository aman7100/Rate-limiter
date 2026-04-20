'use strict';

const express = require('express');
const helmet = require('helmet');

const { SlidingWindowRateLimiter } = require('./rateLimiter');
const { StatsTracker } = require('./stats');

const DEFAULT_PAYLOAD_LIMIT = '100kb';

function createApp(opts = {}) {
  const {
    windowMs = 60_000,
    maxRequests = 5,
    payloadLimit = DEFAULT_PAYLOAD_LIMIT,
    trustProxy = false,
  } = opts;

  const limiter = opts.limiter || new SlidingWindowRateLimiter({ windowMs, maxRequests });
  const stats = opts.stats || new StatsTracker();

  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', trustProxy);

  app.use(helmet());
  app.use(express.json({ limit: payloadLimit }));
  app.use((err, _req, res, next) => {
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Payload too large' });
    }
    return next(err);
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, uptime_s: Math.round(process.uptime()) });
  });

  app.post('/request', (req, res) => {
    const { user_id: userId, payload } = req.body || {};

    if (typeof userId !== 'string' || userId.trim().length === 0) {
      return res.status(400).json({
        error: 'user_id is required and must be a non-empty string',
      });
    }

    // tryConsume and stats.record are synchronous; together they form the
    // atomic check-and-increment that keeps the quota exact under concurrent
    // requests within a single process.
    const result = limiter.tryConsume(userId);
    stats.record(userId, result.allowed);

    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Window-Ms', String(result.windowMs));

    if (!result.allowed) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
      return res.status(429).json({
        error: 'Rate limit exceeded',
        user_id: userId,
        limit: result.limit,
        window_ms: result.windowMs,
        retry_after_ms: result.retryAfterMs,
      });
    }

    return res.status(200).json({
      status: 'accepted',
      user_id: userId,
      payload_echo: payload ?? null,
      rate_limit: {
        limit: result.limit,
        remaining: result.remaining,
        window_ms: result.windowMs,
        used: result.count,
      },
    });
  });

  app.get('/stats', (req, res) => {
    const userId = typeof req.query.user_id === 'string' ? req.query.user_id : null;

    if (userId) {
      const s = stats.getUser(userId);
      if (!s) return res.status(404).json({ error: 'No stats for that user_id' });
      return res.json({
        user_id: userId,
        ...s,
        current_window_count: limiter.getCount(userId),
        limit: limiter.maxRequests,
        window_ms: limiter.windowMs,
      });
    }

    return res.json({
      limit: limiter.maxRequests,
      window_ms: limiter.windowMs,
      tracked_users: stats.trackedUsers,
      users: stats.snapshot(limiter),
    });
  });

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    res.status(status).json({ error: status === 500 ? 'Internal Server Error' : err.message });
  });

  return { app, limiter, stats };
}

module.exports = { createApp };
