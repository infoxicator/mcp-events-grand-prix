import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
export default defineConfig({define:{'import.meta.env.MCP_APP':JSON.stringify('true')},plugins:[viteSingleFile()],build:{outDir:'dist/mcp',emptyOutDir:true,rollupOptions:{input:'mcp-app.html'}}});
