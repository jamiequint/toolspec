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
PUBLIC_WHITELIST_JSON='["anthropic","airtable","asana","aws","azure","bigquery","brave","browserbase","cloudflare","confluence","discord","fetch","figma","filesystem","gcp","github","gitlab","google","hubspot","jira","linear","mongodb","mysql","notion","openai","paypal","postgres","redis","salesforce","serpapi","shopify","slack","snowflake","sqlite","stripe","supabase","tavily","twilio","vercel","zendesk"]'

usage() {
  cat <<'USAGE'
ToolSpec CLI

Commands:
  toolspec status
  toolspec verify
  toolspec submit
  toolspec submit all
  toolspec submit all --yolo
  toolspec uninstall
USAGE
}

now_utc() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

get_install_id() {
  if [ ! -f "$INSTALL_FILE" ] || ! command -v python3 >/dev/null 2>&1; then
    return 0
  fi

  python3 - "$INSTALL_FILE" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
try:
    payload = json.loads(path.read_text())
    value = payload.get("install_id")
    if isinstance(value, str) and value.strip():
        print(value.strip())
except Exception:
    pass
PY
}

access_status_url() {
  local install_id
  install_id="$(get_install_id || true)"
  if [ -n "$install_id" ]; then
    printf '%s/api/v1/access-status?install_id=%s' "$BASE_URL" "$install_id"
  else
    printf '%s/api/v1/access-status' "$BASE_URL"
  fi
}

json_array_from_csv() {
  local raw="${1:-}"
  if [ -z "$raw" ] || ! command -v python3 >/dev/null 2>&1; then
    echo "[]"
    return 0
  fi

  TOOLSPEC_CSV="$raw" python3 - <<'PY'
import json
import os

raw = os.environ.get("TOOLSPEC_CSV", "")
out = []
seen = set()
for part in raw.split(","):
    val = part.strip()
    if not val or val in seen:
        continue
    seen.add(val)
    out.append(val)
print(json.dumps(out))
PY
}

json_field_csv() {
  local json_input="${1:-}"
  local field_name="${2:-}"
  if [ -z "$json_input" ] || [ -z "$field_name" ] || ! command -v python3 >/dev/null 2>&1; then
    echo ""
    return 0
  fi

  TOOLSPEC_JSON="$json_input" python3 - "$field_name" <<'PY'
import json
import os
import sys

field = sys.argv[1]
try:
    payload = json.loads(os.environ.get("TOOLSPEC_JSON", "{}"))
except Exception:
    print("")
    raise SystemExit(0)

arr = payload.get(field)
if not isinstance(arr, list):
    print("")
    raise SystemExit(0)

out = []
seen = set()
for val in arr:
    if isinstance(val, str):
        s = val.strip()
        if s and s not in seen:
            out.append(s)
            seen.add(s)
print(",".join(out))
PY
}

csv_union() {
  local csv_a="${1:-}"
  local csv_b="${2:-}"
  if ! command -v python3 >/dev/null 2>&1; then
    if [ -n "$csv_a" ] && [ -n "$csv_b" ]; then
      echo "$csv_a,$csv_b"
    elif [ -n "$csv_a" ]; then
      echo "$csv_a"
    else
      echo "$csv_b"
    fi
    return 0
  fi

  TOOLSPEC_A="$csv_a" TOOLSPEC_B="$csv_b" python3 - <<'PY'
import os

def parse_csv(raw: str):
    out = []
    seen = set()
    for part in raw.split(","):
        s = part.strip()
        if not s or s in seen:
            continue
        out.append(s)
        seen.add(s)
    return out

combined = []
seen = set()
for value in parse_csv(os.environ.get("TOOLSPEC_A", "")) + parse_csv(os.environ.get("TOOLSPEC_B", "")):
    if value in seen:
        continue
    seen.add(value)
    combined.append(value)
print(",".join(combined))
PY
}

csv_count() {
  local raw="${1:-}"
  if [ -z "$raw" ] || ! command -v python3 >/dev/null 2>&1; then
    echo "0"
    return 0
  fi

  TOOLSPEC_CSV="$raw" python3 - <<'PY'
import os

raw = os.environ.get("TOOLSPEC_CSV", "")
seen = set()
for part in raw.split(","):
    s = part.strip()
    if s:
        seen.add(s)
print(len(seen))
PY
}

classify_observed_json() {
  local observed_csv="${1:-}"
  if ! command -v python3 >/dev/null 2>&1; then
    echo '{"public":[],"unknown":[]}'
    return 0
  fi

  TOOLSPEC_OBSERVED="$observed_csv" TOOLSPEC_WHITELIST="$PUBLIC_WHITELIST_JSON" python3 - <<'PY'
import json
import os
import re

def parse_csv(raw: str):
    out = []
    seen = set()
    for part in raw.split(","):
        s = part.strip()
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)
    return out

def candidates(slug: str):
    raw = slug.strip().lower()
    if not raw:
        return set()

    out = {raw}
    for token in re.split(r"[/:_\\\-.@]+", raw):
        if token:
            out.add(token)

    match = re.match(r"^mcp__([^_]+)__", raw)
    if match:
        out.add(match.group(1))

    if "server-" in raw:
        out.add(raw.split("server-", 1)[1])

    return out

observed = parse_csv(os.environ.get("TOOLSPEC_OBSERVED", ""))
whitelist = set(json.loads(os.environ.get("TOOLSPEC_WHITELIST", "[]")))

public = []
unknown = []
for slug in observed:
    if any(c in whitelist for c in candidates(slug)):
        public.append(slug)
    else:
        unknown.append(slug)

print(json.dumps({"public": public, "unknown": unknown}))
PY
}

extract_required_field() {
  local json_input="$1"
  local field_name="$2"
  if [ -z "$json_input" ] || ! command -v python3 >/dev/null 2>&1; then
    return 1
  fi

  TOOLSPEC_JSON="$json_input" python3 - "$field_name" <<'PY'
import json
import os
import sys

field = sys.argv[1]
try:
    payload = json.loads(os.environ.get("TOOLSPEC_JSON", "{}"))
except Exception:
    sys.exit(0)

value = payload.get(field)
if isinstance(value, str) and value.strip():
    print(value.strip())
PY
}

status_and_next_steps() {
  local status_json="" required_command required_message
  required_command="toolspec submit"
  required_message=""

  local status_url
  status_url="$(access_status_url)"

  if status_json="$(curl -fsS "$status_url" 2>/dev/null || true)"; then
    if [ -n "$status_json" ]; then
      echo "ToolSpec status:"
      echo "$status_json"
      echo
    fi
  fi

  local extracted_command
  extracted_command="$(extract_required_field "$status_json" "post_install_required_command" || true)"
  if [ -n "$extracted_command" ]; then
    required_command="$extracted_command"
  fi

  required_message="$(extract_required_field "$status_json" "post_install_required_message" || true)"
  if [ -n "$required_message" ]; then
    echo "$required_message"
  else
    echo "REQUIRED NEXT STEP: $required_command"
  fi

  local observed_csv classify_json public_csv unknown_csv
  observed_csv="${TOOLSPEC_OBSERVED_TOOLS:-}"
  if [ -n "$observed_csv" ]; then
    classify_json="$(classify_observed_json "$observed_csv")"
    public_csv="$(json_field_csv "$classify_json" "public")"
    unknown_csv="$(json_field_csv "$classify_json" "unknown")"

    echo "Observed tools: $(csv_count "$observed_csv") ($(csv_count "$public_csv") public, $(csv_count "$unknown_csv") non-whitelist)"
    echo "Default mode: toolspec submit"
    echo "All mode: toolspec submit all"
    echo "All mode, no prompts: toolspec submit all --yolo"
  fi

  echo "Run 'toolspec help' for command reference."
}

submit_review() {
  local all_mode="false"
  local yolo_mode="false"

  while [ "$#" -gt 0 ]; do
    case "$1" in
      all)
        all_mode="true"
        shift
        ;;
      --yolo)
        yolo_mode="true"
        shift
        ;;
      --*)
        echo "Unknown option for submit: $1"
        echo "Usage: toolspec submit [all] [--yolo]"
        exit 1
        ;;
      *)
        echo "Usage: toolspec submit [all] [--yolo]"
        exit 1
        ;;
    esac
  done

  if [ "$yolo_mode" = "true" ] && [ "$all_mode" != "true" ]; then
    echo "Error: --yolo requires all"
    exit 1
  fi

  local mode_label
  if [ "$all_mode" = "true" ]; then
    mode_label="all"
  else
    mode_label="whitelist"
  fi

  local observed_csv classify_json public_csv unknown_csv included_csv redacted_csv
  observed_csv="${TOOLSPEC_OBSERVED_TOOLS:-}"
  classify_json="$(classify_observed_json "$observed_csv")"
  public_csv="$(json_field_csv "$classify_json" "public")"
  unknown_csv="$(json_field_csv "$classify_json" "unknown")"
  included_csv="$public_csv"
  redacted_csv="$unknown_csv"

  if [ "$all_mode" = "true" ]; then
    if [ "$yolo_mode" = "true" ]; then
      included_csv="$(csv_union "$public_csv" "$unknown_csv")"
      redacted_csv=""
    elif [ -n "$unknown_csv" ]; then
      if [ -t 0 ] && [ -t 1 ]; then
        local include_unknown=""
        local redact_unknown=""
        IFS=',' read -r -a unknown_items <<< "$unknown_csv"
        for slug in "${unknown_items[@]}"; do
          [ -z "$slug" ] && continue
          read -r -p "Include non-whitelist tool '$slug'? [y/N]: " answer
          answer="${answer:-N}"
          case "$answer" in
            y|Y|yes|YES)
              include_unknown="$(csv_union "$include_unknown" "$slug")"
              ;;
            *)
              redact_unknown="$(csv_union "$redact_unknown" "$slug")"
              ;;
          esac
        done
        included_csv="$(csv_union "$public_csv" "$include_unknown")"
        redacted_csv="$redact_unknown"
      else
        echo "Unknown non-whitelist tools require explicit choice."
        echo "Use 'toolspec submit all --yolo' to include all unknown tools, or run 'toolspec submit' for whitelist-only."
        exit 1
      fi
    fi
  fi

  local observed_json redacted_json submitted_json observed_count redacted_count
  observed_json="$(json_array_from_csv "$observed_csv")"
  redacted_json="$(json_array_from_csv "$redacted_csv")"
  submitted_json="$(json_array_from_csv "$included_csv")"
  observed_count="$(csv_count "$observed_csv")"
  redacted_count="$(csv_count "$redacted_csv")"

  local agent_model now ts install_id install_id_json payload
  agent_model="${TOOLSPEC_AGENT_MODEL:-unknown-agent}"
  now="$(now_utc)"
  ts="$(date -u +%s)"
  install_id="$(get_install_id || true)"
  install_id_json="null"
  if [ -n "$install_id" ]; then
    install_id_json="\"$install_id\""
  fi

  payload="$(cat <<JSON
{
  "install_id": $install_id_json,
  "submission_scope": "all_observed",
  "tool_slug": "__session__",
  "agent_model": "$agent_model",
  "review_window_start_utc": "$now",
  "review_window_end_utc": "$now",
  "recommendation": "caution",
  "confidence": "low",
  "observed_tool_slugs": $observed_json,
  "redacted_tool_slugs": $redacted_json,
  "reliable_tools": $submitted_json,
  "unreliable_tools": [],
  "hallucinated_tools": [],
  "never_used_tools": $redacted_json,
  "behavioral_notes": [
    "submitted_via_toolspec_cli",
    "submission_scope=all_observed",
    "submit_mode=$mode_label",
    "submit_yolo=$yolo_mode",
    "whitelist_tools=$(csv_count "$public_csv")",
    "unknown_tools=$(csv_count "$unknown_csv")",
    "observed_tools=$observed_count",
    "redacted_tools=$redacted_count"
  ],
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
      "tool_call_id": "session_${ts}",
      "timestamp_utc": "$now"
    }
  ],
  "idempotency_key": "session_${ts}"
}
JSON
)"

  curl -fsS -X POST "$BASE_URL/api/v1/reviews/submit" \
    -H "content-type: application/json" \
    -d "$payload"
  echo

  local mode_display="$mode_label"
  if [ "$all_mode" = "true" ] && [ "$yolo_mode" = "true" ]; then
    mode_display="all (yolo)"
  fi
  echo "Submitted tools: $(csv_count "$included_csv") | Redacted tools: $redacted_count | Mode: $mode_display"

  if [ -n "$redacted_csv" ]; then
    echo "Redacted tool slugs: $redacted_csv"
  fi
}

revoke_install() {
  local install_id
  install_id="$(get_install_id || true)"

  if [ -n "$install_id" ]; then
    curl -fsS -X POST "$BASE_URL/api/v1/installs/revoke" \
      -H "content-type: application/json" \
      -d "{\"install_id\":\"$install_id\"}" >/dev/null 2>&1 || true
  fi
}

cmd="${1:-status}"
case "$cmd" in
  status)
    status_and_next_steps
    ;;
  verify)
    curl -fsS "$(access_status_url)"
    echo
    ;;
  submit)
    shift
    submit_review "$@"
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
echo "Run: toolspec verify"
echo "REQUIRED NEXT STEP: toolspec submit"
echo
echo "Running post-install status check..."
if ! "$CLI_PATH" status; then
  echo "Could not run status automatically. Run: toolspec status"
fi
