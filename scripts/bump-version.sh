#!/bin/bash
# Usage: scripts/bump-version.sh [new-version]
set -e
cd "$(dirname "${BASH_SOURCE[0]}")/.."

CURRENT=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
VERSION="$1"
if [ -z "$VERSION" ]; then
  read -p "Current version: $CURRENT — New version: " VERSION
fi

if [ -z "$VERSION" ]; then
  echo "No version provided, aborting."
  exit 1
fi

sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$VERSION\"/" package.json
sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json
sed -i "s/^version = \"$CURRENT\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
sed -i "s/^pkgver=.*/pkgver=$VERSION/" packaging/arch/PKGBUILD

# Keep the lockfiles in step with the manifests
npm install --package-lock-only --ignore-scripts >/dev/null
cargo update --workspace --offline >/dev/null 2>&1 || cargo update --workspace >/dev/null

echo "Updated to $VERSION in package.json, tauri.conf.json, Cargo.toml, PKGBUILD and the lockfiles"
