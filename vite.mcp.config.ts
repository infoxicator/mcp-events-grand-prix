import {circuitClusters} from './scripts/circuit-clusters';
import {defineConfig} from 'vite';

export default defineConfig({
 base:'./',
 publicDir:false,plugins:[circuitClusters()],
 define:{'import.meta.env.MCP_APP':JSON.stringify('true')},
 build:{outDir:'dist/mcp',emptyOutDir:true,rollupOptions:{input:'mcp-app.html'}},
});
