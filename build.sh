#!/usr/bin/env bash
set -euo pipefail

# Build the static Cloudflare Pages output. Pages Functions are read by
# Cloudflare/Wrangler from ./functions, so they are intentionally not copied
# into dist.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

rm -rf dist
mkdir -p dist

cp index.html 404.html privacy.html terms.html robots.txt sitemap.xml site.webmanifest dist/
cp -R assets dist/
cp _headers _redirects dist/

printf 'Built Cloudflare Pages output in %s\n' "$ROOT_DIR/dist"
