#!/bin/bash
# Prevent infinite recursion during postinstall
# electron-builder install-app-deps can trigger nested bun installs
# which would re-run postinstall, spawning hundreds of processes

if [ -n "$SUPERSET_POSTINSTALL_RUNNING" ]; then
  exit 0
fi

export SUPERSET_POSTINSTALL_RUNNING=1

# Run sherif for workspace validation
sherif

# GitHub CI runs multiple Bun install jobs that do not need desktop native rebuilds.
# Running electron-builder here can trigger nested Bun installs while the main
# install is still materializing packages, which has been flaky with native deps.
if [ -n "$CI" ]; then
  exit 0
fi

# Electron 44 V8 headers require a newer compiler on Debian bookworm.
# Reuse an installed compiler when available; never install one here.
if [ -z "${CC:-}" ] && command -v clang++-16 >/dev/null 2>&1; then
  export CC=clang-16 CXX=clang++-16
fi

# Electron 43+ no longer downloads its binary through package postinstall.
# The desktop install:deps script now materializes Electron explicitly first,
# including callers whose dependency install used --ignore-scripts.
# Install native dependencies for desktop app
bun run --filter=@superset/desktop install:deps
