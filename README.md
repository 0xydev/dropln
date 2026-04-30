# dropln

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
DROPLN_DATABASE_URL='postgres://dropln:dropln@localhost:5432/dropln?sslmode=disable' \
  ./bin/dropln
```

The server listens on `:8080`. Open `http://localhost:8080/`.

For frontend development with hot-reload, run the Go backend on `:8080` and
Vite on `:5173` (which proxies `/api/*` to the backend):

```sh
DROPLN_DATABASE_URL='postgres://...' ./bin/dropln &
make dev   # → http://localhost:5173
```

## Configuration

All settings are environment variables.

| Variable | Default | Notes |
|---|---|---|
| `DROPLN_DATABASE_URL` | (required) | `postgres://user:pass@host:5432/dbname` |
| `DROPLN_ADDR` | `:8080` | Listen address |
| `DROPLN_MAX_PASTE_BYTES` | `33554432` (32 MiB) | POST body size limit. Compound base64 means a 32 MiB body fits ~18 MiB of raw attachment. |
| `DROPLN_RATE_LIMIT_PER_MIN` | `10` | Per-IP create rate limit |
| `DROPLN_RATE_LIMIT_BURST` | `5` | Burst capacity |
| `DROPLN_TRUST_PROXY` | `false` | If `true`, honor `X-Forwarded-For` / `X-Real-IP`. Only enable behind a reverse proxy that strips spoofed values. |
| `DROPLN_HSTS` | `false` | Send `Strict-Transport-Security` header. Only enable when serving over HTTPS. |

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
├── cmd/dropln/main.go                   # entry: graceful shutdown, slog
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

## CLI

`bin/dropln-cli` is a stand-alone client. Same crypto module as the web UI;
server still only sees ciphertext. Built by `make build-cli` (or `make build`,
which builds everything).

```sh
make build-cli
sudo install -m 0755 bin/dropln-cli /usr/local/bin/dropln   # optional

# server defaults to http://localhost:8080 — point elsewhere with --server or
# the DROPLN_SERVER env var:
export DROPLN_SERVER=https://dropln.example.com
```

### Common flows

```sh
# stdin → URL
echo "hello" | dropln
cat error.log | dropln --expire=1hour

# one-time-read paste (URL gets a #- warning prefix; link previewers
# can't silently consume it)
git diff | dropln --burn

# password protected
echo "AKIA..." | dropln --password="$PASSWORD"

# attach a file (separate from stdin)
dropln --file diagram.png

# fetch & decrypt to stdout
dropln abc123def456789a#KEY
dropln https://dropln.example.com/p/abc123def456789a#KEY

# fetch with password
dropln --password="$PASSWORD" abc123def456789a#KEY

# write fetched content to file (saves attachment as the original
# filename if present, else writes paste text)
dropln --output recovered.log abc123def456789a#KEY

# pipe-friendly: print only the URL on success
echo "x" | dropln -q
```

`--copy` also pushes the URL to the clipboard (`pbcopy` on macOS,
`wl-copy`/`xclip`/`xsel` on Linux, `clip` on Windows).

Every paste is encrypted client-side with AES-256-GCM, key derived via
PBKDF2-SHA256 (100k iterations). The decryption key lives in the URL
fragment after `#` — never sent to the server. Pastes created with the
CLI decrypt cleanly in the web UI and vice versa.

## Internal deployment

The simplest path is the included `compose.yaml`: it brings up the app and a
PostgreSQL 17 instance on a single host. Bind is `127.0.0.1:8080` by default,
so put your team's reverse proxy in front of it for TLS.

```sh
cp .env.example .env
# fill in POSTGRES_PASSWORD (e.g. `openssl rand -base64 24`)

docker compose up -d --build
docker compose logs -f dropln
```

### Reverse proxy

**Caddy** (auto Let's Encrypt, single-line config):

```Caddyfile
dropln.example.com {
    reverse_proxy 127.0.0.1:8080
    encode zstd gzip
}
```

After putting Caddy in front, set `DROPLN_HSTS=true` and
`DROPLN_TRUST_PROXY=true` in `.env`, then `docker compose up -d`.

**nginx** equivalent:

```nginx
server {
    listen 443 ssl http2;
    server_name dropln.example.com;
    ssl_certificate     /etc/letsencrypt/live/dropln.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dropln.example.com/privkey.pem;

    client_max_body_size 64m;   # > DROPLN_MAX_PASTE_BYTES

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP       $remote_addr;
        proxy_set_header Host            $host;
    }
}
```

### Backups

Postgres data lives in the `postgres-data` named volume. Snapshot it
however your team handles backups; for a quick `pg_dump`:

```sh
docker compose exec postgres pg_dump -U dropln -d dropln -Fc > dropln-$(date +%F).dump
```

### Updating

```sh
git pull
docker compose up -d --build dropln   # rebuild + restart only the app
```

Migrations run automatically on startup (idempotent — `schema_migrations`
table tracks applied versions).

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

## Why "dropln"?

"Drop a line" — the English idiom for sending a quick note — collapsed
into a CLI-shaped name. The `ln` suffix nods to `\n` (the line break)
and the `ln` Unix command, both of which made sense for a tool whose
core verb is `cat secret.txt | dropln`.

## License

TBD.
