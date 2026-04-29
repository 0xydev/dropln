# ulakbin

A zero-knowledge encrypted paste tool. Single Go binary; modern web UI;
client-side AES-256-GCM with PBKDF2 key derivation. The server stores only
ciphertext — it cannot decrypt your data, even if it wanted to.

Modeled on [PrivateBin](https://privatebin.info/), reimplemented from
scratch as a focused dev tool. Format v2 wire-compatible.

## Features

- **End-to-end encryption** — AES-256-GCM, PBKDF2-SHA256 (100k iter), per-paste
  random key + IV + salt. Key lives in the URL fragment, never sent to the server.
- **Burn-after-read** — atomic delete on first read (server-side `DELETE … RETURNING`,
  unlike PrivateBin's PHP impl). URLs use a `#-{key}` warning prefix so link
  previewers can't silently consume one-time pastes.
- **Optional password** — combined with the URL key via PBKDF2 before deriving the
  AES key. Server still stores only ciphertext.
- **Expiry** — 5 min, 10 min, 1 hour, 1 day, 1 week, 1 month, 1 year, never. Lazy
  filtering on read + periodic batch purge.
- **File attachments** — inline base64 inside the encrypted plaintext. View-side
  shows MIME-aware previews (image, video, audio, PDF) plus download.
- **Comments / discussions** — threaded encrypted comments using the parent
  paste's key. Cascade-deleted with the paste.
- **Markdown rendering** — `markdown-it` + DOMPurify, view-only.
- **Code editor** — CodeMirror 6 with per-language lazy-loaded syntax highlight
  (TypeScript, JavaScript, Python, Go, Rust, SQL, YAML, JSON, Markdown), find/
  replace, multi-cursor, history.
- **Hardening** — per-IP token-bucket rate limiter, strict CSP + security headers,
  optional HSTS, optional X-Forwarded-For trust.
- **Single binary** — Vite frontend embedded via `embed.FS`. ~15 MiB image,
  `FROM scratch`.

## Quick start

```sh
# 1. Postgres in a container
make db-up

# 2. Build everything (frontend → embedded into Go binary)
make build

# 3. Run
make run        # or:
ULAKBIN_DATABASE_URL='postgres://ulakbin:ulakbin@localhost:5432/ulakbin?sslmode=disable' \
  ./bin/ulakbin
```

The server listens on `:8080`. Open `http://localhost:8080/`.

For frontend development with hot-reload, run the Go backend on `:8080` and
Vite on `:5173` (which proxies `/api/*` to the backend):

```sh
ULAKBIN_DATABASE_URL='postgres://...' ./bin/ulakbin &
make dev   # → http://localhost:5173
```

## Configuration

All settings are environment variables.

| Variable | Default | Notes |
|---|---|---|
| `ULAKBIN_DATABASE_URL` | (required) | `postgres://user:pass@host:5432/dbname` |
| `ULAKBIN_ADDR` | `:8080` | Listen address |
| `ULAKBIN_MAX_PASTE_BYTES` | `33554432` (32 MiB) | POST body size limit. Compound base64 means a 32 MiB body fits ~18 MiB of raw attachment. |
| `ULAKBIN_RATE_LIMIT_PER_MIN` | `10` | Per-IP create rate limit |
| `ULAKBIN_RATE_LIMIT_BURST` | `5` | Burst capacity |
| `ULAKBIN_TRUST_PROXY` | `false` | If `true`, honor `X-Forwarded-For` / `X-Real-IP`. Only enable behind a reverse proxy that strips spoofed values. |
| `ULAKBIN_HSTS` | `false` | Send `Strict-Transport-Security` header. Only enable when serving over HTTPS. |

Migrations run automatically on startup (embedded via `embed.FS`).

## API

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/paste` | Create. Body = Format v2 envelope. Returns `{id, delete_token}`. Rate-limited. |
| `GET` | `/api/v1/paste/{id}` | Read. Atomic burn-after-read happens here. |
| `DELETE` | `/api/v1/paste/{id}?token={delete_token}` | Delete with token. |
| `POST` | `/api/v1/paste/{id}/comment` | Create comment. Rate-limited. |
| `GET` | `/api/v1/paste/{id}/comments` | List comments (each gets server-spliced `id` + `created`). |
| `GET` | `/api/v1/info` | `{version, max_paste_bytes, expire_options, formatter_options}`. |
| `GET` | `/healthz` | Liveness probe. |
| `GET` | `/_dev/round-trip.html` | Vanilla-JS crypto round-trip page (dev/test). |

Format v2 envelope, paste:

```json
{
  "v": 2,
  "ct": "<base64 ciphertext>",
  "adata": [
    [
      "<base64 iv>", "<base64 salt>", 100000, 256, 128,
      "aes", "gcm", "zlib"
    ],
    "plaintext|syntaxhighlighting|markdown",
    0,
    0
  ],
  "meta": { "expire": "1day" }
}
```

For comments: `adata` is the flat cipher-params (8 elements), and
`pasteid`/`parentid` replace `meta`.

## Architecture

```
┌────────────────────────────┐
│  Browser (web/)            │
│  • React 19 + Vite + TS    │   Vanilla TS crypto module
│  • CodeMirror 6 editor     │   (Web Crypto API, audit-isolated)
│  • Markdown-it + DOMPurify │
└──────────────┬─────────────┘
               │  Format v2 envelope (HTTPS / JSON)
┌──────────────▼─────────────┐
│  Go binary                 │
│  • net/http + chi-style    │   Embedded SPA (web/dist)
│    ServeMux (Go 1.22+)     │   Embedded SQL migrations
│  • pgx/v5                  │
│  • Rate limit, CSP, HSTS   │
└──────────────┬─────────────┘
               │  Opaque bytes (server cannot decrypt)
┌──────────────▼─────────────┐
│  PostgreSQL                │
│  • pastes, comments tables │
│  • Atomic burn via         │
│    DELETE … RETURNING      │
└────────────────────────────┘
```

## Project layout

```
.
├── cmd/ulakbin/main.go                   # entry: graceful shutdown, slog
├── internal/
│   ├── config/                           # env-driven config
│   ├── paste/                            # Format v2 spec + ID generation
│   ├── ratelimit/                        # IP-keyed token bucket
│   ├── purge/                            # background expiry sweeper
│   ├── server/                           # HTTP routing, middleware
│   │   ├── server.go                     # routes, security headers, embed mount
│   │   ├── paste.go                      # paste handlers
│   │   ├── comment.go                    # comment handlers
│   │   ├── spa.go                        # SPA static + fallback
│   │   └── dev/round-trip.html           # crypto interop page
│   └── storage/
│       ├── storage.go                    # interface
│       └── postgres/                     # pgx impl + migrations
├── web/
│   ├── src/
│   │   ├── crypto/                       # vanilla TS, Web Crypto API
│   │   ├── api/                          # typed fetch client
│   │   ├── components/                   # React UI
│   │   └── lib/                          # helpers
│   ├── styles.css                        # design system
│   └── web.go                            # Go embed.FS for dist/
├── reference/privatebin/                 # source-of-truth reference (gitignored)
├── Dockerfile
└── Makefile
```

## Tests

```sh
make test                # unit tests (no DB)
make db-up
make test-integration    # full Postgres-backed suite
```

Coverage:

- 28 paste format unit tests (paste + comment, all rejection paths)
- 14 Postgres integration tests (incl. 32-reader concurrent burn,
  cascade on delete/burn)
- 5 rate-limit unit tests (burst, key isolation, sweep, 429,
  X-Forwarded-For)
- 4 server integration tests (info, 413, security headers, full HTTP
  round-trip)

## Why "ulakbin"?

Turkish wordplay: *ulak* (messenger / courier) + *bin* (the PrivateBin /
PasteBin suffix).

## License

TBD.
