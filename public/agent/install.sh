#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${TOOLSPEC_BASE_URL:-https://toolspec.dev}"
INSTALL_DIR="${TOOLSPEC_INSTALL_DIR:-$HOME/.local/bin}"
CONFIG_DIR="${TOOLSPEC_CONFIG_DIR:-$HOME/.toolspec}"
CLI_PATH="$INSTALL_DIR/toolspec"
INSTALL_FILE="$CONFIG_DIR/install.json"

if ! command -v curl >/dev/null 2>&1; then
  echo "ToolSpec install failed: curl is required."
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "ToolSpec install failed: npx is required to run the ToolSpec CLI."
  exit 1
fi

mkdir -p "$INSTALL_DIR" "$CONFIG_DIR"

REGISTER_RESPONSE=""
if REGISTER_RESPONSE="$(curl -fsS -X POST "$BASE_URL/api/v1/installs/register" 2>/dev/null)"; then
  printf '%s\n' "$REGISTER_RESPONSE" > "$INSTALL_FILE"
fi

cat > "$CLI_PATH" <<CLI
#!/usr/bin/env bash
set -euo pipefail
export TOOLSPEC_BASE_URL="$BASE_URL"
export TOOLSPEC_CONFIG_DIR="$CONFIG_DIR"
export TOOLSPEC_INSTALL_DIR="$INSTALL_DIR"
if ! command -v npx >/dev/null 2>&1; then
  echo "ToolSpec CLI requires npx."
  exit 1
fi
npx -y toolspec-cli@latest "\$@"
CLI

chmod +x "$CLI_PATH"

if ! echo ":$PATH:" | grep -q ":$INSTALL_DIR:"; then
  echo "Add this to your shell profile to use 'toolspec' globally:"
  echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
fi

PROMPT_MESSAGE=""
if [ -f "$INSTALL_FILE" ] && command -v python3 >/dev/null 2>&1; then
  PROMPT_MESSAGE="$(python3 - "$INSTALL_FILE" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
try:
    payload = json.loads(path.read_text())
    prompt = payload.get("post_install_prompt") or {}
    msg = prompt.get("message")
    if isinstance(msg, str):
        print(msg)
except Exception:
    pass
PY
)"
fi

echo "ToolSpec installed: $CLI_PATH"
if [ -n "$PROMPT_MESSAGE" ]; then
  echo "$PROMPT_MESSAGE"
fi
echo "Preparing local review draft (not submitting)..."
"$CLI_PATH" prepare

echo "REQUIRED NEXT STEP: toolspec approve"
echo "Optional: toolspec verify"
echo

echo "Running post-install status check..."
if ! "$CLI_PATH" status; then
  echo "Could not run status automatically. Run: toolspec status"
fi
