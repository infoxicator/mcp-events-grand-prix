#!/bin/zsh
set -euo pipefail
export PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH
export JEV_MOCK=1 ENGINEER_MOCK=1 CAR_REVIEW_DIR=onboard-v9/after/cars CIRCUIT_REVIEW_DIR=onboard-v9/after
export WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/jgp-onboard-v9-wrangler.log
run() { local stage=$1; shift; printf '%s RUN %s\n' "$(date -u +%H:%M:%S)" "$stage" >> artifacts/onboard-v9/logs/status.log; "$@" > "artifacts/onboard-v9/logs/$stage.log" 2>&1; printf '%s PASS %s\n' "$(date -u +%H:%M:%S)" "$stage" >> artifacts/onboard-v9/logs/status.log; }
run build npm run build
run typecheck npm run typecheck
run unit npm test
run e2e npm run test:e2e
cp artifacts/vegas-strip.png artifacts/onboard-v9/after/las-vegas/strip-aerial.png
python3 scripts/review-gloves.py
run mcp npm run test:mcp
run worker npm run test:worker
run worker-dry-run npm run worker:check
run handling npm run test:handling
run performance-monza env PERF_UNCAPPED=1 PERF_DEMO_PROCESSES=1 PORT=5577 npm run test:performance
cp artifacts/performance.json artifacts/onboard-v9/performance-monza.json
run performance-vegas env PERF_UNCAPPED=1 PERF_DEMO_PROCESSES=1 RACE_CIRCUIT=las-vegas PORT=5578 npm run test:performance
cp artifacts/performance-vegas.json artifacts/onboard-v9/performance-vegas.json
run demo-smoke env PORT=5579 npm run demo:smoke
curl --fail --silent http://127.0.0.1:5477/health > artifacts/onboard-v9/server-health.json
curl --fail --silent -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:5477/ > artifacts/onboard-v9/logs/server.log
python3 scripts/measure-car.py > artifacts/onboard-v9/measurements.json
