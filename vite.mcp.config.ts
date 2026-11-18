import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import {embeddedCircuits} from './scripts/embedded-circuits';
export default defineConfig({define:{'import.meta.env.MCP_APP':JSON.stringify('true')},plugins:[embeddedCircuits(),viteSingleFile()],build:{outDir:'dist/mcp',emptyOutDir:true,rollupOptions:{input:'mcp-app.html'}}});
