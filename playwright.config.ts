import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',timeout:120_000,fullyParallel:false,workers:1,retries:0,
  reporter:'list',use:{baseURL:'http://127.0.0.1:5187',browserName:'chromium',headless:true,viewport:{width:1440,height:1080},trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:'npm run start',url:'http://127.0.0.1:5187/health',reuseExistingServer:false,timeout:30_000,env:{PORT:'5187',JEV_MOCK:'1',PONG_MATCHUP:'jev-vs-jev'}},
});
