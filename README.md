# rate-limiter

Per-user, sliding-window rate-limited HTTP service. In-memory state, one
Express app, structured JSON logs, container-ready.

- `POST /request` — accepts `{ user_id, payload }`, subject to the per-user
  limit.
- `GET /stats` — aggregate counters (or a single user's counters via
  `?user_id=...`).
- `GET /health` — liveness probe.

Default limit: **5 requests per user per 60 s**, configurable via env.

## Quick start

Requires Node.js 18+.

```bash
npm install
npm start
```


## Configuration

All config is via environment variables. See `.env.example`.

| Variable              | Default | Description                                          |
|-----------------------|---------|------------------------------------------------------|
| `PORT`                | `3000`  | HTTP port.                                           |
| `RATE_LIMIT_WINDOW_MS`| `60000` | Window length in ms.                                 |
| `RATE_LIMIT_MAX`      | `5`     | Max requests per user per window.                    |
| `TRUST_PROXY`         | `false` | Set when running behind a reverse proxy.             |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Hard-kill after this long if `server.close` stalls.  |

Invalid values fail fast at startup with a clear error on stderr.

## API

### `POST /request`

Request:

```json
{ "user_id": "alice", "payload": { "anything": "you want" } }
```

Responses:

- `200 OK` — accepted. Body includes current rate-limit state.
- `429 Too Many Requests` — limit exceeded. `Retry-After` header (seconds) and
  `retry_after_ms` field give the precise wait until the oldest in-window
  request expires.
- `400 Bad Request` — missing/invalid `user_id`, or malformed JSON.
- `413 Payload Too Large` — body exceeds 100 kB.

Every response carries:

```
X-RateLimit-Limit:     5
X-RateLimit-Remaining: 4
X-RateLimit-Window-Ms: 60000
```

### `GET /stats`

```json
{
  "limit": 5,
  "window_ms": 60000,
  "tracked_users": 2,
  "users": {
    "alice": {
      "total": 7, "allowed": 5, "rejected": 2,
      "firstRequestAt": 1718000000000,
      "lastRequestAt":  1718000001234,
      "currentWindowCount": 5
    }
  }
}
```

### `GET /stats?user_id=alice`

Single-user view, or `404` if the user is unknown.

### `GET /health`

```json
{ "ok": true, "uptime_s": 42 }
```

## Testing

With the server running on `:3000`:

```bash
curl --location 'localhost:3000/request' \
--header 'Content-Type: application/json' \
--data '{
    "user_id": "alice",
    "payload": {
        "i": 1
    }
}'
```

Run six times — the sixth returns `429` with `Retry-After`. Then:

```bash
curl --location 'localhost:3000/stats'
curl --location 'localhost:3000/stats?user_id=alice'
```

### Concurrency check

Fire 20 parallel requests for the same user. Exactly 5 should be admitted,
regardless of interleaving:

```bash
seq 1 20 | xargs -P 20 -I{} curl -s -o /dev/null -w '%{http_code}\n' \
  --location 'localhost:3000/request' \
  --header 'Content-Type: application/json' \
  --data '{"user_id":"bob","payload":{"i":1}}' | sort | uniq -c
# =>    5 200
#      15 429
```

## Design

**Algorithm.** Sliding-window log. Each user has an ascending array of
request timestamps. On every call we drop expired entries, admit if the
remaining count is below the limit, and otherwise reject with
`retry_after_ms = oldest_in_window + windowMs - now`. Work and memory per
call are bounded by `maxRequests`.

**Concurrency.** Node runs JavaScript single-threaded. The check-and-record
path — `limiter.tryConsume` followed by `stats.record` — is entirely
synchronous and contains no `await`, so it is atomic with respect to other
request callbacks. That is what makes the per-user quota exact under parallel
calls in a single process.

**Memory.** A background sweeper (`limiter.startSweeper`) evicts users whose
window is empty every 5 min. The timer is `unref`'d, so it does not block
shutdown.

**Security posture.** `helmet` for default headers, `x-powered-by` disabled,
JSON body capped at 100 kB, input validated, errors normalised to JSON.

**Graceful shutdown.** `SIGINT`/`SIGTERM` stop the sweeper, stop accepting new
connections (`server.close`), wait for in-flight requests, and hard-exit
after `SHUTDOWN_TIMEOUT_MS` if anything stalls.

## Known limitations

- **Single-process state.** Counters live in the Node heap. `N` replicas ⇒
  `N × limit` effective quota. Horizontal scale-out needs a shared store —
  typically Redis with an atomic sliding-window Lua script.
- **State is lost on restart.** Rolling deploys reset quotas. Acceptable for
  best-effort throttling, not for billing-grade metering.
- **`user_id` is trusted from the body.** Real deployments should key the
  limit off an authenticated identity (JWT `sub`, API key, etc.) and/or a
  client IP derived via `TRUST_PROXY`.
- **Stats map is unbounded.** Fine for bounded user populations; for
  high-cardinality workloads, replace with a real metrics backend or add an
  eviction policy.
- **Wall-clock based.** Uses `Date.now()`. Large backward clock jumps could
  temporarily widen the window.
- **No per-IP or global limit.** Per-user only. Layer a per-IP limit and a
  global concurrency bound in front for real hostile traffic. 

  //Created Readme File using AI 

## Layout

```
.
├── .env.example
├── index.js              # Entry point: config, logger, lifecycle
├── src/
│   ├── app.js            # Express factory (createApp)
│   ├── config.js         # Env parsing + validation
│   ├── rateLimiter.js    # SlidingWindowRateLimiter
│   └── stats.js          # StatsTracker
└── package.json
```
