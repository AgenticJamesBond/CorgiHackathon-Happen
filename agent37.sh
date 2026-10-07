#!/usr/bin/env bash
set -euo pipefail

: "${AGENT37_KEY:?Set AGENT37_KEY to your Agent37 API key before running this script.}"
command -v jq >/dev/null || { echo "jq is required: brew install jq" >&2; exit 1; }

default_prompt="Create a Python file at /tmp/fibonacci.py that prints the first 10 Fibonacci numbers. Execute the file using Python and return the actual terminal output. Do not just calculate the answer yourself."
prompt="${1:-$default_prompt}"

instance_file="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.agent37-instance-url"

if [[ -n "${AGENT37_INSTANCE_URL:-}" ]]; then
  instance_url="$AGENT37_INSTANCE_URL"
elif [[ -s "$instance_file" ]]; then
  instance_url="$(<"$instance_file")"
else
  if ! instance_json="$(curl -sS --fail-with-body https://api.agent37.com/v1/instances \
    -H "Authorization: Bearer $AGENT37_KEY" \
    -H "Content-Type: application/json" \
    -d '{"template":"agent37-hermes"}')"; then
    echo "$instance_json" >&2
    exit 1
  fi

  instance_url="$(jq -r '.url // empty' <<<"$instance_json")"
  if [[ -z "$instance_url" ]]; then
    echo "Instance response did not include a url:" >&2
    echo "$instance_json" >&2
    exit 1
  fi

  printf '%s\n' "$instance_url" > "$instance_file"
  echo "Created instance $instance_url (saved to $instance_file; delete that file to create a new one)" >&2
fi

request_body="$(jq -n --arg input "$prompt" '{input: $input}')"

if ! response_json="$(curl -sS --fail-with-body "${instance_url%/}/v1/responses" \
  -H "X-Agent37-Key: $AGENT37_KEY" \
  -H "Content-Type: application/json" \
  -d "$request_body")"; then
  echo "$response_json" >&2
  exit 1
fi

if [[ "$(jq -r '.status' <<<"$response_json")" != "completed" ]]; then
  jq -r '"Request \(.status): \(.error.code // "unknown_error"): \(.error.message // "no message")"' <<<"$response_json" >&2
  exit 1
fi

jq -r '.output_text' <<<"$response_json"
