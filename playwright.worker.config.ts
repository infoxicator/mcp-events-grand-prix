import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./e2e-worker',outputDir:'worker-test-results',timeout:150_000,workers:1,retries:0,reporter:'list',
  use:{baseURL:process.env.LIVE_URL??'http://127.0.0.1:8797',browserName:'chromium',headless:true,viewport:{width:1440,height:1080},trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:[...(!process.env.LIVE_URL?[{command:'wrangler dev --config wrangler.test.jsonc --persist-to .wrangler/test-state --ip 127.0.0.1 --port 8797 --inspector-port 9237',url:'http://127.0.0.1:8797/health',reuseExistingServer:false,timeout:30_000}]:[]),{command:`MCP_SERVER_URL=${process.env.LIVE_URL??'http://127.0.0.1:8797'}/mcp MCP_HOST_PORT=5398 tsx scripts/mcp-host.ts`,url:'http://127.0.0.1:5398/config',reuseExistingServer:false,timeout:15_000}],
});
