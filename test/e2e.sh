#!/usr/bin/env bash
# End-to-end tests: runs the bundled action against scratch git repositories
# derived from test/fixture-project. Requires node, git and forge on PATH and
# `npm run build` to have produced dist/index.cjs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist/index.cjs"
FIXTURE="$ROOT/test/fixture-project"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
CASE_DIR=""

new_repo() {
  # new_repo <name> [subdir]: copies the fixture project into a fresh git
  # repository (optionally nested under a subdirectory) and commits it.
  local name="$1" subdir="${2:-}"
  local repo="$TMP/$name"
  local project="$repo"
  if [ -n "$subdir" ]; then
    project="$repo/$subdir"
  fi
  mkdir -p "$project"
  cp -r "$FIXTURE"/. "$project"/
  rm -rf "$project/out" "$project/cache"
  git -C "$repo" init -q -b main
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name test
  git -C "$repo" config commit.gpgsign false
  git -C "$repo" add -A
  git -C "$repo" commit -q -m initial
  CASE_DIR="$project"
  BASE_SHA="$(git -C "$repo" rev-parse HEAD)"
}

run_case() {
  # run_case <name> <expected-exit: 0|1> <required-log-pattern> [VAR=value...]
  local name="$1" expected="$2" pattern="$3"
  shift 3
  local log="$TMP/$name.log"
  local status=0
  (cd "$CASE_DIR" && env -i PATH="$PATH" HOME="$HOME" "$@" node "$DIST" >"$log" 2>&1) || status=$?
  local ok=1
  if [ "$expected" = 0 ] && [ "$status" -ne 0 ]; then ok=0; fi
  if [ "$expected" = 1 ] && [ "$status" -eq 0 ]; then ok=0; fi
  if [ -n "$pattern" ] && ! grep -qF -- "$pattern" "$log"; then ok=0; fi
  if [ "$ok" = 1 ]; then
    echo "ok   $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL $name (exit=$status, expected=$expected, pattern='$pattern')"
    sed 's/^/     | /' "$log"
    FAIL=$((FAIL + 1))
  fi
}

regen() {
  (cd "$CASE_DIR" && forge inspect "$1" storage-layout --json >"storage-layouts/$1.json")
}

append_var() {
  sed -i 's/uint256\[46\] private __gap;/uint256[46] private __gap;\n    uint256 public newVar;/' \
    "$CASE_DIR/src/Vault.sol"
}

prepend_var() {
  sed -i 's/address public manager;/uint256 public sneaky;\n    address public manager;/' \
    "$CASE_DIR/src/Vault.sol"
}

new_repo fresh
run_case fresh-and-compatible 0 'passed for 2 contract(s)' INPUT_BASE="$BASE_SHA"
run_case no-base-event 0 'Compatibility check skipped'
run_case summary-written 0 '' INPUT_BASE="$BASE_SHA" GITHUB_STEP_SUMMARY="$TMP/summary.md"
grep -q 'Storage layout check' "$TMP/summary.md" || {
  echo "FAIL summary-written (no summary content)"
  FAIL=$((FAIL + 1))
}

new_repo stale
append_var
run_case stale-snapshot 1 'no longer matches the storage layout' INPUT_BASE="$BASE_SHA"

new_repo append
append_var
regen Vault
run_case regenerated-append 0 'passed for 2 contract(s)' INPUT_BASE="$BASE_SHA"

new_repo insert
prepend_var
regen Vault
run_case incompatible-insert 1 'Inserted `sneaky`' INPUT_BASE="$BASE_SHA"

new_repo rename
sed -i 's/uint256 public totalShares;/uint256 public sharesTotal;/' "$CASE_DIR/src/Vault.sol"
regen Vault
run_case rename-rejected 1 'Renamed `totalShares`' INPUT_BASE="$BASE_SHA"
run_case rename-allowed 0 'passed for 2 contract(s)' INPUT_BASE="$BASE_SHA" INPUT_UNSAFE_ALLOW_RENAMES=true

new_repo inputs
run_case missing-snapshot 1 'No snapshot found for Dup' INPUT_BASE="$BASE_SHA" INPUT_CONTRACTS='src/a/Dup.sol:Dup'
run_case ambiguous-name 1 'Multiple contracts found' INPUT_BASE="$BASE_SHA" INPUT_CONTRACTS='Dup'
run_case invalid-entry 1 'invalid contract entry' INPUT_CONTRACTS='-rf'

new_repo new-contract
cat >"$CASE_DIR/src/NewToken.sol" <<'EOF'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract NewToken {
    uint256 public supply;
}
EOF
regen NewToken
run_case new-contract-skipped 0 'passed for 3 contract(s)' INPUT_BASE="$BASE_SHA"

new_repo nested contracts
run_case nested-working-directory 0 'passed for 2 contract(s)' INPUT_BASE="$BASE_SHA"

# The incompatible change is committed to the local main, so the check can
# only fail if the base branch is genuinely fetched from origin (which still
# has the original layout), not resolved from the local ref.
new_repo remote
git clone -q --bare "$TMP/remote" "$TMP/remote-origin.git"
git -C "$TMP/remote" remote add origin "$TMP/remote-origin.git"
prepend_var
regen Vault
git -C "$TMP/remote" add -A
git -C "$TMP/remote" commit -q -m insert
printf '{"pull_request": {}}' >"$TMP/event.json"
run_case pull-request-base-fetch 1 'Inserted `sneaky`' \
  GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=main GITHUB_EVENT_PATH="$TMP/event.json"

echo
echo "e2e: $PASS passed, $FAIL failed"
test "$FAIL" -eq 0
