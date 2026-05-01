# dropln — cheatsheet

Tip: `dropln examples` prints a colorized version of this in your
terminal.

---

## Send a secret

```sh
echo "$API_KEY" | dropln                      # stdin → URL
docker compose logs --tail 50 | dropln        # command output
cat .env | dropln --note "prod env, 30-min link"
```

## Self-destruct on first read

URL gets a `#-` prefix; opening it consumes the paste atomically.

```sh
echo "ssh password: hunter2" | dropln --burn
echo "$SECRET" | dropln --burn --copy         # clipboard too
```

## Password protection

Combined with the URL fragment via PBKDF2 — server still only sees ciphertext.

```sh
echo "data" | dropln --password "shared-phrase"
echo "data" | dropln --password "$(date +%F)" --copy
```

## Expiry

```sh
cat trace.log | dropln --expire 5min
cat .env      | dropln --expire 1hour
cat README.md | dropln --expire 1week
dropln --file backup.tar.gz --expire never
```

Options: `5min`, `10min`, `1hour`, `1day` (default), `1week`, `1month`,
`1year`, `never`.

## File attachments

```sh
dropln --file screenshot.png
dropln --file diagram.png < explanation.md    # file + text caption
dropln --file build.zip --burn --expire 1hour # one-time download
```

## QR code

Print a Unicode-block QR alongside the URL — scan it from a phone:

```sh
echo "wifi pwd: hunter2" | dropln --qr
```

## Fetch a paste

```sh
dropln "https://dropln.com/p/abc123def456789a#KEY"
dropln <URL> --output secrets.env             # stdout → file
dropln <URL> --no-text --extract ~/downloads  # attachment only
```

Markdown-formatted pastes auto-render (via Glamour) when stdout is a TTY;
piping into a script gets you raw markdown back.

## Local history

```sh
dropln list                                   # what you've created
dropln delete 9e6a2dc6ab47c29b                # uses cached delete-token
dropln delete <id> --token <delete_token>     # explicit token
```

History file: `$XDG_CONFIG_HOME/dropln/history.json` (override with
`DROPLN_HISTORY`). Only paste IDs + delete tokens are stored locally —
no decryption keys.

## Scripting

```sh
URL=$(echo "data" | dropln -q)                # --quiet → URL only on stdout

# CI: post test output as a paste link, attach to a PR
URL=$(make test 2>&1 | dropln -q --expire 1week)
gh pr comment $PR --body "Test logs: $URL"

# Self-hosted instance
export DROPLN_SERVER=https://paste.example.com
```

## Install

```sh
# Homebrew tap (macOS / Linux)
brew install 0xydev/dropln/dropln

# Verified install script
curl -L https://dropln.com/install.sh | sh

# Go toolchain
go install github.com/0xydev/dropln/cmd/dropln-cli@latest

# From source
git clone https://github.com/0xydev/dropln && cd dropln && make build-cli
```

Shell completions (bash / zsh / fish) install automatically with
Homebrew. For other install methods, the completion files are bundled in
the release tarball under `completions/`.
