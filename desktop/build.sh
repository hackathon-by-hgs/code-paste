#!/usr/bin/env bash
# Release build.
#
# Bakes the control-plane URL into the binary so a user never has to set an
# environment variable — a background service started at login has no shell to
# inherit one from, so anything it needs must be compiled in or saved to disk.
#
#   ./build.sh https://code-paste.onrender.com
#
# Output lands in ../dist (git-ignored).

set -euo pipefail

API_URL="${1:-${CODEPASTE_API_URL:-}}"
if [ -z "$API_URL" ]; then
  echo "usage: ./build.sh <control-plane-origin>" >&2
  echo "  e.g. ./build.sh https://code-paste.onrender.com" >&2
  exit 1
fi

# The origin only — /v1 is appended at runtime (ADR-008).
case "$API_URL" in
  */v1|*/v1/) echo "error: pass the origin without /v1 — it is appended for you" >&2; exit 1 ;;
esac

OUT="$(cd "$(dirname "$0")/.." && pwd)/dist"
PKG="github.com/hackathon-by-hgs/code-paste/desktop/internal/config"

# -s -w strip the symbol table and DWARF: ~30% smaller, and nothing here is
# debugged from a customer machine.
LDFLAGS="-s -w -X ${PKG}.DefaultAPIURL=${API_URL}"

rm -rf "$OUT"
mkdir -p "$OUT"

build() {
  local goos="$1" goarch="$2" ext="${3:-}"
  echo "  ${goos}/${goarch}"
  # CGO_ENABLED=0 keeps every target a static binary with no runtime deps,
  # which is why the clipboard backends shell out instead of linking Cocoa/X11.
  CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
    go build -trimpath -ldflags "$LDFLAGS" -o "$OUT/agent-${goos}-${goarch}${ext}" ./cmd/agent
}

echo "Building against ${API_URL}"
build windows amd64 .exe
build darwin  arm64
build darwin  amd64
build linux   amd64

echo
echo "Binaries in $OUT:"
ls -1 "$OUT"
echo
echo "To use one: copy it to the target machine, then run"
echo "  ./agent pair <CODE-FROM-MY-DEVICES>"
