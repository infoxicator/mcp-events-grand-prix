#!/bin/zsh
set -euo pipefail
export PATH=/Users/ruben.casas@postman.com/.nvm/versions/node/v24.14.0/bin:$PATH
export JEV_MOCK=1 ENGINEER_MOCK=1 CAR_REVIEW_DIR=realism-v6/after/cars CIRCUIT_REVIEW_DIR=realism-v6/after
export WRANGLER_SEND_METRICS=false WRANGLER_LOG_PATH=/tmp/jgp-v6-wrangler.log
run() { local stage=$1; shift; printf '%s RUN %s\n' "$(date -u +%H:%M:%S)" "$stage" >> artifacts/realism-v6/logs/status.log; "$@" > "artifacts/realism-v6/logs/$stage.log" 2>&1; printf '%s PASS %s\n' "$(date -u +%H:%M:%S)" "$stage" >> artifacts/realism-v6/logs/status.log; }
run build npm run build
run typecheck npm run typecheck
run unit npm test
run e2e npm run test:e2e
cp artifacts/vegas-strip.png artifacts/realism-v6/after/las-vegas/strip-aerial.png
python3 scripts/review-v6.py after
run mcp npm run test:mcp
run worker npm run test:worker
run worker-dry-run npm run worker:check
run handling npm run test:handling
run performance-monza env PORT=5577 npm run test:performance
cp artifacts/performance.json artifacts/realism-v6/performance-monza.json
run performance-vegas env RACE_CIRCUIT=las-vegas PORT=5578 npm run test:performance
cp artifacts/performance-vegas.json artifacts/realism-v6/performance-vegas.json
run demo-smoke env PORT=5579 npm run demo:smoke
curl --fail --silent http://127.0.0.1:5477/health > artifacts/realism-v6/server-health.json
curl --fail --silent -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:5477/ > artifacts/realism-v6/logs/server.log
python3 scripts/measure-car.py > artifacts/realism-v6/measurements.json
