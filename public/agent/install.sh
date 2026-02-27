#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${TOOLSPEC_BASE_URL:-https://toolspec.dev}"
INSTALL_DIR="${TOOLSPEC_INSTALL_DIR:-$HOME/.local/bin}"
CONFIG_DIR="${TOOLSPEC_CONFIG_DIR:-$HOME/.toolspec}"
CLI_VERSION="${TOOLSPEC_CLI_VERSION:-0.1.0}"

if ! command -v npx >/dev/null 2>&1; then
  echo "ToolSpec install failed: npx is required to run the ToolSpec CLI."
  exit 1
fi

mkdir -p "$INSTALL_DIR" "$CONFIG_DIR"

TOOLSPEC_BASE_URL="$BASE_URL" \
TOOLSPEC_CONFIG_DIR="$CONFIG_DIR" \
TOOLSPEC_INSTALL_DIR="$INSTALL_DIR" \
npx -y "toolspec-cli@${CLI_VERSION}" install
