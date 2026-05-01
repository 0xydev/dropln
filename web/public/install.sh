#!/usr/bin/env sh
# dropln CLI installer
#
# Usage:
#   curl -L https://dropln.com/install.sh | sh
#   curl -L https://dropln.com/install.sh | sh -s -- --version v0.2.0
#   curl -L https://dropln.com/install.sh | sh -s -- --bin-dir ~/.local/bin
#
# Detects OS + arch, downloads the matching tarball from the latest GitHub
# release (or a specific tag), verifies SHA-256 against checksums.txt, and
# drops the `dropln` binary into a directory on PATH.

set -eu

REPO="0xydev/dropln"
BIN="dropln"
VERSION=""
BIN_DIR=""

usage() {
    cat <<USAGE
dropln CLI installer

Options:
  --version TAG    install a specific tag (e.g. v0.2.0). default: latest
  --bin-dir DIR    install location. default: /usr/local/bin (or ~/.local/bin)
  -h, --help       this help
USAGE
}

while [ $# -gt 0 ]; do
    case "$1" in
        --version) VERSION="$2"; shift 2 ;;
        --bin-dir) BIN_DIR="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "unknown flag: $1" >&2; usage; exit 2 ;;
    esac
done

# ─── Detect OS / arch ────────────────────────────────────────────────────
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$OS" in
    darwin) OS_ARCHIVE="macos" ;;
    linux)  OS_ARCHIVE="linux" ;;
    *)      echo "error: unsupported OS '$OS' — use the GitHub release directly: https://github.com/$REPO/releases" >&2; exit 1 ;;
esac

ARCH=$(uname -m)
case "$ARCH" in
    x86_64|amd64)  ARCH_ARCHIVE="x86_64" ;;
    aarch64|arm64) ARCH_ARCHIVE="arm64"  ;;
    *) echo "error: unsupported arch '$ARCH'" >&2; exit 1 ;;
esac

# ─── Resolve version ─────────────────────────────────────────────────────
if [ -z "$VERSION" ]; then
    # GitHub redirect from /releases/latest → /releases/tag/<tag>; pull the
    # tag from the redirect URL without depending on jq.
    VERSION=$(curl -fsSL -o /dev/null -w '%{url_effective}' \
        "https://github.com/$REPO/releases/latest" \
        | sed -E 's|.*/tag/||')
    if [ -z "$VERSION" ]; then
        echo "error: could not determine latest version" >&2
        exit 1
    fi
fi

# Strip leading 'v' for archive filename (matches goreleaser's pattern).
VERSION_CLEAN=${VERSION#v}

ARCHIVE="dropln_${VERSION_CLEAN}_${OS_ARCHIVE}_${ARCH_ARCHIVE}.tar.gz"
URL="https://github.com/$REPO/releases/download/$VERSION/$ARCHIVE"
CHECKSUMS_URL="https://github.com/$REPO/releases/download/$VERSION/checksums.txt"

# ─── Pick install dir ────────────────────────────────────────────────────
if [ -z "$BIN_DIR" ]; then
    if [ -w /usr/local/bin ] 2>/dev/null; then
        BIN_DIR="/usr/local/bin"
    elif [ "$(id -u)" = "0" ]; then
        BIN_DIR="/usr/local/bin"
    else
        BIN_DIR="$HOME/.local/bin"
        mkdir -p "$BIN_DIR"
    fi
fi

echo "→ dropln $VERSION ($OS_ARCHIVE/$ARCH_ARCHIVE)"
echo "→ install to: $BIN_DIR/$BIN"

# ─── Download + verify ───────────────────────────────────────────────────
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

curl -fsSL -o "$TMP/$ARCHIVE" "$URL"
curl -fsSL -o "$TMP/checksums.txt" "$CHECKSUMS_URL"

EXPECTED=$(grep " $ARCHIVE\$" "$TMP/checksums.txt" | awk '{print $1}')
if [ -z "$EXPECTED" ]; then
    echo "error: $ARCHIVE not present in checksums.txt" >&2
    exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL=$(sha256sum "$TMP/$ARCHIVE" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
    ACTUAL=$(shasum -a 256 "$TMP/$ARCHIVE" | awk '{print $1}')
else
    echo "error: neither sha256sum nor shasum available — cannot verify download" >&2
    exit 1
fi

if [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "error: checksum mismatch" >&2
    echo "  expected: $EXPECTED" >&2
    echo "  actual:   $ACTUAL" >&2
    exit 1
fi
echo "→ checksum ok"

# ─── Install ─────────────────────────────────────────────────────────────
tar -xzf "$TMP/$ARCHIVE" -C "$TMP"
install -m 0755 "$TMP/$BIN" "$BIN_DIR/$BIN"

echo "✓ installed: $BIN_DIR/$BIN"

# Suggest adding to PATH if needed.
case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) echo "  ⚠ $BIN_DIR is not in PATH — add it to your shell profile" ;;
esac

"$BIN_DIR/$BIN" --version
