#!/usr/bin/env bash
#
# Apply the branch/tag protection rulesets and repo hygiene settings that define what may be
# merged into an upstream (protected) branch. Run once, and again whenever a ruleset JSON changes.
#
# These rules cannot live in a workflow — they are repo configuration. This script is the
# config-as-code source of truth; the rulesets themselves are in .github/rulesets/*.json.
#
# Prerequisites:
#   - gh    (GitHub CLI, authenticated: `gh auth login`) with admin on the repo
#   - jq
#
# Usage:
#   scripts/apply-rulesets.sh [owner/repo]        # defaults to hackathon-by-hgs/code-paste
#   DRY_RUN=1 scripts/apply-rulesets.sh           # print what would change, do nothing
#
# Idempotent: a ruleset is created if absent, updated (by name) if present.

set -euo pipefail

REPO="${1:-hackathon-by-hgs/code-paste}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULESETS_DIR="$HERE/../.github/rulesets"
DRY_RUN="${DRY_RUN:-0}"

command -v gh >/dev/null || { echo "error: gh (GitHub CLI) is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "error: jq is required" >&2; exit 1; }

say() { printf '\033[1m›\033[0m %s\n' "$*"; }
run() {
  if [ "$DRY_RUN" = "1" ]; then echo "  DRY: $*"; else "$@"; fi
}

say "Target repo: $REPO"
echo

# --- 1. Rulesets (upsert by name) --------------------------------------------------------------
existing_json="$(gh api "repos/$REPO/rulesets" 2>/dev/null || echo '[]')"

for f in "$RULESETS_DIR"/*.json; do
  name="$(jq -r '.name' "$f")"
  id="$(echo "$existing_json" | jq -r --arg n "$name" '.[] | select(.name == $n) | .id' | head -n1)"
  if [ -n "$id" ] && [ "$id" != "null" ]; then
    say "Updating ruleset '$name' (id $id)"
    run gh api --method PUT "repos/$REPO/rulesets/$id" --input "$f" >/dev/null
  else
    say "Creating ruleset '$name'"
    run gh api --method POST "repos/$REPO/rulesets" --input "$f" >/dev/null
  fi
done
echo

# --- 2. Labels used by the labeler + issue templates -------------------------------------------
create_label() {
  local name="$1" color="$2" desc="$3"
  if gh label list --repo "$REPO" --limit 200 | grep -qiE "^${name}[[:space:]]"; then
    run gh label edit "$name" --repo "$REPO" --color "$color" --description "$desc" >/dev/null || true
  else
    run gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" >/dev/null || true
  fi
}
say "Ensuring labels exist"
create_label "area: contracts"   "1d76db" "Schemas, vectors, OpenAPI"
create_label "area: docs"        "0e8a16" "Documentation"
create_label "area: ci"          "5319e7" "CI/CD, tooling"
create_label "area: governance"  "b60205" "PR/issue templates, rulesets, ownership"
create_label "area: agent-config" "fbca04" "CLAUDE.md, .codex skills"
create_label "type: bug"         "d73a4a" "Something is broken"
create_label "type: feature"     "a2eeef" "New capability"
create_label "cross-cutting"     "e99695" "Affects multiple domains"
create_label "needs: triage"     "ededed" "Awaiting maintainer review"
echo

# --- 3. Repo merge hygiene ---------------------------------------------------------------------
# Squash-only keeps history linear (matches required_linear_history) and makes the PR title the
# permanent commit message. Auto-delete merged branches keeps the domain branch list clean.
say "Setting merge hygiene (squash-only, auto-delete head branches, auto-merge on)"
run gh api --method PATCH "repos/$REPO" \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=true \
  -F delete_branch_on_merge=true \
  -F allow_auto_merge=true \
  -F squash_merge_commit_title=PR_TITLE \
  -F squash_merge_commit_message=PR_BODY >/dev/null
echo

say "Done."
cat <<'NOTE'

Manual follow-ups (cannot be set safely by this script):
  • Settings → Branches: confirm the default branch is `main`.
  • Settings → Security → Code scanning: enable CodeQL (free on public repos; GHAS on private).
  • Settings → Security → Secret scanning + Push protection: enable (free on public repos).
  • .github/CODEOWNERS on each branch: replace placeholder handles with real teams, then flip
    `require_code_owner_review` to true in the matching .github/rulesets/*.json and re-run this.
  • Break-glass: the rulesets allow the Admin role to bypass. Remove the `bypass_actors` block
    for a stricter posture once the team is comfortable.
NOTE
