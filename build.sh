#!/usr/bin/env bash
set -euo pipefail

# Assemble the only folder Wrangler is allowed to upload. Worker source,
# dependencies, and repository tooling are intentionally excluded.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

rm -rf dist
mkdir -p dist

cp index.html 404.html privacy.html terms.html robots.txt sitemap.xml site.webmanifest dist/
cp -R assets dist/
cp _headers _redirects .assetsignore dist/

# Fail locally if a public file exceeds Cloudflare's 25 MiB per-asset limit.
# (find's -size rounds up to MiB, so test for files larger than 25 MiB.)
too_large="$(find dist -type f -size +25M -print)"
if [ -n "$too_large" ]; then
  printf 'ERROR: Cloudflare rejects assets larger than 25 MiB:\n%s\n' "$too_large" >&2
  exit 1
fi

printf 'Built Cloudflare assets in %s\n' "$ROOT_DIR/dist"
