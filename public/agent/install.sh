#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${TOOLSPEC_BASE_URL:-https://toolspec.dev}"
INSTALL_DIR="${TOOLSPEC_INSTALL_DIR:-$HOME/.local/bin}"
CONFIG_DIR="${TOOLSPEC_CONFIG_DIR:-$HOME/.toolspec}"
CLI_SCRIPT_PATH="$CONFIG_DIR/toolspec-cli.js"

if ! command -v curl >/dev/null 2>&1; then
  echo "ToolSpec install failed: curl is required."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ToolSpec install failed: node is required to run the ToolSpec CLI."
  exit 1
fi

mkdir -p "$INSTALL_DIR" "$CONFIG_DIR"

curl -fsSL "$BASE_URL/agent/toolspec-cli.js" -o "$CLI_SCRIPT_PATH"
chmod 755 "$CLI_SCRIPT_PATH"

TOOLSPEC_BASE_URL="$BASE_URL" \
TOOLSPEC_CONFIG_DIR="$CONFIG_DIR" \
TOOLSPEC_INSTALL_DIR="$INSTALL_DIR" \
TOOLSPEC_CLI_SCRIPT="$CLI_SCRIPT_PATH" \
TOOLSPEC_INSTALL_AUTO_APPROVE=1 \
node "$CLI_SCRIPT_PATH" install
