'use strict';

const { loadConfig } = require('./src/config');
const { createApp } = require('./src/app');

let config;
try {
  config = loadConfig();
} catch (err) {
  process.stderr.write(`config error: ${err.message}\n`);
  process.exit(64); // EX_USAGE
}

const { app, limiter } = createApp({
  windowMs: config.windowMs,
  maxRequests: config.maxRequests,
  trustProxy: config.trustProxy,
});
limiter.startSweeper();

const server = app.listen(config.port, () => {
  console.log(
    `rate-limiter listening on :${config.port} ` +
    `(limit=${config.maxRequests} req / ${config.windowMs}ms per user)`
  );
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${signal}, shutting down`);

  limiter.stopSweeper();
  server.close((err) => {
    if (err) {
      console.error('shutdown error:', err);
      process.exit(1);
    }
    process.exit(0);
  });

  setTimeout(() => {
    console.error('shutdown timeout exceeded, forcing exit');
    process.exit(1);
  }, config.shutdownTimeoutMs).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
