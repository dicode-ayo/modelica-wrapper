#!/usr/bin/env bash
# PreToolUse(Bash) guard: deny destructive git operations before they run.
# Fires for the Bash tool (Claude main thread + delegated agents); the user's
# own `!` input-box commands do not pass through the tool, so this guards
# agents without blocking a human's deliberate manual recovery.
set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"
[ -z "$cmd" ] && exit 0

# Only inspect commands that mention git at all.
printf '%s' "$cmd" | grep -q 'git' || exit 0

norm="$(printf '%s' "$cmd" | tr '\n\t' '  ')"

deny() {
  jq -nc --arg r "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

has() { printf '%s' "$norm" | grep -Eq -- "$1"; }

# Force-push (any branch): --force, --force-with-lease, or -f on a push.
if has 'git([[:space:]]|.)*push' && has '(--force-with-lease|--force([[:space:]]|=|$)|[[:space:]]-f([[:space:]]|$))'; then
  deny "Blocked: force-push rewrites remote history. Push a normal commit, or open a fresh branch. (block-destructive-git hook)"
fi

# Push to the protected branches main/master.
if has 'git([[:space:]]|.)*push' && has '([[:space:]:]|^)(main|master)([[:space:]]|$|:)'; then
  deny "Blocked: never push to main/master. Push your feature branch and open a PR. (block-destructive-git hook)"
fi

# reset --hard onto a shared/remote ref (local HEAD~n resets stay allowed).
if has 'git([[:space:]]|.)*reset' && has '--hard' && has '(origin/|upstream/|[[:space:]](main|master)([[:space:]]|$))'; then
  deny "Blocked: reset --hard onto a shared ref discards history. Reset a local ref only, or branch instead. (block-destructive-git hook)"
fi

# Branch deletion.
if has 'git([[:space:]]|.)*branch' && has '([[:space:]](-D|--delete)([[:space:]]|$)|[[:space:]]-d[[:space:]])'; then
  deny "Blocked: branch deletion. Leave branches in place for the user to clean up after validation. (block-destructive-git hook)"
fi

# Amending committed history.
if has 'git([[:space:]]|.)*commit' && has '--amend'; then
  deny "Blocked: commit --amend rewrites history. Make a new commit (e.g. refactor: address review). (block-destructive-git hook)"
fi

# Hook / signature bypass on commit or push.
if has '(--no-verify|--no-gpg-sign)'; then
  deny "Blocked: --no-verify/--no-gpg-sign bypasses git hooks. Fix the underlying failure instead. (block-destructive-git hook)"
fi

exit 0
