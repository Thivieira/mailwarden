#!/usr/bin/env bash
#
# One command from working tree to production:
#   bun run ship "fix(oauth): render authorize page as HTML"
#
# Runs the gate once, commits, pushes, deploys. Refuses to deploy from a branch
# other than main, and refuses a message that is not a Conventional Commit.
set -euo pipefail

MAIN_BRANCH="main"
ORIGIN="https://mailwarden.corenet.workers.dev"
TYPES="feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert"

msg="${1:-}"
if [ -z "$msg" ]; then
  echo "usage: bun run ship \"<type>(scope): description\"" >&2
  exit 1
fi

# CLAUDE.md mandates Conventional Commits; catch a bad subject before the gate runs.
if ! printf '%s\n' "$msg" | head -n 1 | grep -qE "^($TYPES)(\([a-z0-9._/-]+\))?!?: .+"; then
  echo "not a conventional commit subject: $msg" >&2
  echo "expected <type>[(scope)][!]: <description>, type one of: ${TYPES//|/, }" >&2
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"

echo "==> gate"
bun run typecheck
bun test

if [ -n "$(git status --porcelain)" ]; then
  echo "==> committing"
  git add -A
  git status --short
  git commit -m "$msg"
else
  echo "==> nothing to commit, shipping $(git rev-parse --short HEAD)"
fi

echo "==> pushing $branch"
git push -u origin "$branch"

if [ "$branch" != "$MAIN_BRANCH" ]; then
  echo "==> on '$branch', not '$MAIN_BRANCH' - pushed but not deployed"
  echo "    merge to $MAIN_BRANCH and rerun, or deploy explicitly with: bun x wrangler deploy"
  exit 0
fi

sha="$(git rev-parse --short HEAD)"

# Restamp so the bundle carries the commit that was just made, not its parent.
echo "==> stamping $sha"
bun run ui:build

# The gate already ran above, so go straight to wrangler rather than through bun run deploy.
echo "==> deploying"
bun x wrangler deploy

# A successful upload is not a successful deploy: wrangler has shipped a stale bundle
# before. Confirm the origin is actually serving the commit we just built.
echo "==> verifying"
for attempt in 1 2 3 4 5 6; do
  live="$(curl -fsS --max-time 10 "$ORIGIN/health" 2>/dev/null | grep -o '"commit":"[^"]*"' | cut -d'"' -f4 || true)"
  if [ "$live" = "$sha" ]; then
    echo "==> shipped $sha, live and verified"
    exit 0
  fi
  echo "    attempt $attempt: origin reports '${live:-unreachable}', want '$sha'"
  sleep 5
done

echo "DEPLOY NOT VERIFIED: origin is not serving $sha. Re-run 'bun x wrangler deploy'." >&2
exit 1
