#!/usr/bin/env bash
#
# Wrangler wrapper for D1 commands.
#
# `account_id` in wrangler.jsonc is not honoured by the `d1 migrations`
# subcommands: with more than one account on the credentials they fail with
# "unable to select one in non-interactive mode" even though the config names
# one. They do read CLOUDFLARE_ACCOUNT_ID, so this exports it from the same
# single source of truth rather than hardcoding the id in scripts and CI.
#
#   bash scripts/d1.sh d1 migrations apply mailwarden-prod --remote
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACCOUNT_ID="$(sed -n 's/.*"account_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/wrangler.jsonc" | head -1)"

if [[ -z "$ACCOUNT_ID" ]]; then
  echo "No account_id found in wrangler.jsonc" >&2
  exit 1
fi

export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"
exec bunx wrangler "$@"
