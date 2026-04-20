'use strict';

function parsePositiveInt(name, raw, fallback) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer (got "${raw}")`);
  }
  return n;
}

function parseBool(name, raw, fallback) {
  if (raw === undefined || raw === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  throw new Error(`${name} must be a boolean (got "${raw}")`);
}

function loadConfig(env = process.env) {
  return {
    port: parsePositiveInt('PORT', env.PORT, 3000),
    windowMs: parsePositiveInt('RATE_LIMIT_WINDOW_MS', env.RATE_LIMIT_WINDOW_MS, 60_000),
    maxRequests: parsePositiveInt('RATE_LIMIT_MAX', env.RATE_LIMIT_MAX, 5),
    trustProxy: parseBool('TRUST_PROXY', env.TRUST_PROXY, false),
    shutdownTimeoutMs: parsePositiveInt('SHUTDOWN_TIMEOUT_MS', env.SHUTDOWN_TIMEOUT_MS, 10_000),
  };
}

module.exports = { loadConfig };
