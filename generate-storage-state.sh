#!/bin/bash
# Generates a Playwright storage state JSON from the Codecks .env token.
# Run this after refreshing a token — or let context-recovery.sh call it at session start.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
OUTPUT_FILE="/Users/mkronk/.playwright-codecks/storage-state.json"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found" >&2
  exit 1
fi

TOKEN=$(grep '^CODECKS_TOKEN=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")

if [ -z "$TOKEN" ]; then
  echo "Error: CODECKS_TOKEN not found in $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_FILE")"

cat > "$OUTPUT_FILE" << ENDJSON
{
  "cookies": [
    {
      "name": "at",
      "value": "$TOKEN",
      "domain": ".codecks.io",
      "path": "/",
      "httpOnly": true,
      "secure": true,
      "sameSite": "Lax"
    }
  ],
  "origins": []
}
ENDJSON

echo "Storage state written to $OUTPUT_FILE"
