import {defineConfig} from '@playwright/test';

const endpoint='http://127.0.0.1:8797';
export default defineConfig({
 testDir:'./e2e-worker',outputDir:'worker-test-results',timeout:90000,workers:1,reporter:'list',
 use:{baseURL:endpoint,headless:true,channel:process.platform==='darwin'?'chromium':undefined,viewport:{width:1200,height:900}},
 webServer:[
  {command:'node --import tsx e2e-worker/fixture-server.ts',url:'http://127.0.0.1:8798/fixture'},
  {command:'wrangler dev --config wrangler.test.jsonc --env-file /dev/null --ip 127.0.0.1 --port 8797 --inspector-port 9237',
   url:endpoint+'/health',timeout:40000,env:{WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:'/tmp/jev-grand-prix-worker-test.log'}},
  {command:'npm run mcp:host',url:'http://127.0.0.1:8799',env:{MCP_SERVER_URL:endpoint+'/mcp',MCP_HOST_PORT:'8799',MCP_TEST_STRATEGY:'1'}},
 ],
});
