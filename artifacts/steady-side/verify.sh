#!/bin/zsh
set -euo pipefail
export PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH
export JEV_MOCK=1 ENGINEER_MOCK=1 CAR_REVIEW_DIR=steady-side/after/cars CIRCUIT_REVIEW_DIR=steady-side/after AERIAL_REVIEW_DIR=steady-side/aerial
export WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/jgp-steady-side-wrangler.log
run() { local stage=$1; shift; printf '%s RUN %s\n' "$(date -u +%H:%M:%S)" "$stage" >> artifacts/steady-side/logs/status.log; "$@" > "artifacts/steady-side/logs/$stage.log" 2>&1; printf '%s PASS %s\n' "$(date -u +%H:%M:%S)" "$stage" >> artifacts/steady-side/logs/status.log; }
run typecheck npm run typecheck
run e2e npm run test:e2e
cp artifacts/vegas-strip.png artifacts/steady-side/after/las-vegas/strip-aerial.png
run mcp npm run test:mcp
run worker npm run test:worker
run worker-dry-run npm run worker:check
run handling npm run test:handling
run performance-monza env PERF_UNCAPPED=1 PERF_DEMO_PROCESSES=1 PORT=5577 npm run test:performance
cp artifacts/performance.json artifacts/steady-side/performance-monza.json
run performance-vegas env PERF_UNCAPPED=1 PERF_DEMO_PROCESSES=1 RACE_CIRCUIT=las-vegas PORT=5578 npm run test:performance
cp artifacts/performance-vegas.json artifacts/steady-side/performance-vegas.json
run demo-smoke env PORT=5579 npm run demo:smoke
curl --fail --silent http://127.0.0.1:5477/health > artifacts/steady-side/server-health.json
curl --fail --silent -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:5477/ > artifacts/steady-side/logs/server.log
