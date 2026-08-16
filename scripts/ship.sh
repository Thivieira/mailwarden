#!/usr/bin/env bash
#
# One command from working tree to production:
#   bun run ship "fix(oauth): render authorize page as HTML"
#
# Runs the gate once, commits, pushes, deploys. Refuses to deploy from a branch
# other than main, and refuses a message that is not a Conventional Commit.
set -euo pipefail

MAIN_BRANCH="main"
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

# The gate already ran above, so go straight to wrangler rather than through bun run deploy.
echo "==> deploying"
bun x wrangler deploy

echo "==> shipped $(git rev-parse --short HEAD)"
