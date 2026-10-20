#!/bin/sh
# Pinned, project-local compiler. No system compiler or package upgrades.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VERSION=25.0
ARCHIVE=wasi-sdk-25.0-arm64-macos.tar.gz
SHA256=e1e529ea226b1db0b430327809deae9246b580fa3cae32d31c82dfe770233587
SDK="$ROOT/local/toolchains/wasi-sdk-$VERSION-arm64-macos"
if [ "$(uname -sm)" != 'Darwin arm64' ]; then
  echo 'This pinned installer supports Darwin arm64. Set WASM_CC to another WASI SDK clang for other hosts.' >&2
  exit 1
fi
mkdir -p "$ROOT/local/toolchains"
if [ ! -f "$ROOT/local/toolchains/$ARCHIVE" ]; then
  curl -fL --retry 2 "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-25/$ARCHIVE" -o "$ROOT/local/toolchains/$ARCHIVE.part"
  mv "$ROOT/local/toolchains/$ARCHIVE.part" "$ROOT/local/toolchains/$ARCHIVE"
fi
printf '%s  %s\n' "$SHA256" "$ROOT/local/toolchains/$ARCHIVE" | shasum -a 256 -c -
if [ ! -x "$SDK/bin/clang" ]; then
  tar -xzf "$ROOT/local/toolchains/$ARCHIVE" -C "$ROOT/local/toolchains"
fi
"$SDK/bin/clang" --version
printf '\nWASM_CC=%s\n' "$SDK/bin/clang"
