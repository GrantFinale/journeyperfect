#!/bin/bash
# launchd entry point for the home (Mac Studio) runner. See HOME-RUNNER.md.
# Loads ~/journeyperfect-runner/.env (mode 600) and execs the built service.
set -euo pipefail
RUNNER_DIR="${RUNNER_DIR:-$HOME/journeyperfect-runner}"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$RUNNER_DIR"
set -a
# shellcheck disable=SC1091
source "$RUNNER_DIR/.env"
set +a
exec node "$RUNNER_DIR/dist/index.js"
