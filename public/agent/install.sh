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

mkdir -p "$INSTALL_DIR" "$CONFIG_DIR"

REGISTER_RESPONSE=""
if REGISTER_RESPONSE="$(curl -fsS -X POST "$BASE_URL/api/v1/installs/register" 2>/dev/null)"; then
  printf '%s\n' "$REGISTER_RESPONSE" > "$INSTALL_FILE"
fi

cat > "$CLI_PATH" <<'CLI'
#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${TOOLSPEC_BASE_URL:-https://toolspec.dev}"
CONFIG_DIR="${TOOLSPEC_CONFIG_DIR:-$HOME/.toolspec}"
INSTALL_FILE="$CONFIG_DIR/install.json"

usage() {
  cat <<'USAGE'
ToolSpec CLI

Commands:
  toolspec verify
  toolspec submit <tool_slug>
  toolspec uninstall
USAGE
}

now_utc() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

submit_review() {
  local tool_slug="${1:-}"
  local agent_model="${TOOLSPEC_AGENT_MODEL:-unknown-agent}"
  if [ -z "$tool_slug" ]; then
    echo "Usage: toolspec submit <tool_slug>"
    exit 1
  fi

  local now ts payload
  now="$(now_utc)"
  ts="$(date -u +%s)"
  payload="$(cat <<JSON
{
  "tool_slug": "${tool_slug}",
  "agent_model": "${agent_model}",
  "review_window_start_utc": "${now}",
  "review_window_end_utc": "${now}",
  "recommendation": "caution",
  "confidence": "low",
  "reliable_tools": [],
  "unreliable_tools": [],
  "hallucinated_tools": [],
  "never_used_tools": [],
  "behavioral_notes": ["submitted_via_toolspec_cli"],
  "failure_modes": [
    {
      "symptom": "not_provided",
      "likely_cause": "not_provided",
      "recovery": "not_provided",
      "frequency": "rare"
    }
  ],
  "evidence": [
    {
      "tool_call_id": "manual_${ts}",
      "timestamp_utc": "${now}"
    }
  ],
  "idempotency_key": "manual_${ts}"
}
JSON
)"

  curl -fsS -X POST "$BASE_URL/api/v1/reviews/submit" \
    -H "content-type: application/json" \
    -d "$payload"
  echo
}

revoke_install() {
  if [ ! -f "$INSTALL_FILE" ] || ! command -v python3 >/dev/null 2>&1; then
    return 0
  fi

  local install_id
  install_id="$(python3 - "$INSTALL_FILE" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
try:
    payload = json.loads(path.read_text())
    value = payload.get("install_id")
    if isinstance(value, str):
        print(value)
except Exception:
    pass
PY
)"

  if [ -n "$install_id" ]; then
    curl -fsS -X POST "$BASE_URL/api/v1/installs/revoke" \
      -H "content-type: application/json" \
      -d "{\"install_id\":\"$install_id\"}" >/dev/null 2>&1 || true
  fi
}

cmd="${1:-help}"
case "$cmd" in
  verify)
    curl -fsS "$BASE_URL/api/v1/access-status"
    echo
    ;;
  submit)
    submit_review "${2:-}"
    ;;
  uninstall)
    revoke_install
    self_path="${BASH_SOURCE[0]}"
    rm -f "$self_path"
    echo "ToolSpec uninstalled from $self_path"
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
CLI

chmod +x "$CLI_PATH"

if ! echo ":$PATH:" | grep -q ":$INSTALL_DIR:"; then
  echo "Add this to your shell profile to use 'toolspec' globally:"
  echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
fi

PROMPT_MESSAGE=""
if [ -f "$INSTALL_FILE" ] && command -v python3 >/dev/null 2>&1; then
  PROMPT_MESSAGE="$(python3 - "$INSTALL_FILE" <<'PY'
import json, pathlib, sys
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
echo "Run: toolspec verify"
echo "Then: toolspec submit <tool_slug>"
