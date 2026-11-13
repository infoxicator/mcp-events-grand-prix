import { defineConfig } from 'vite';
export default defineConfig({base:'./',build:{outDir:'dist/mcp-host',emptyOutDir:true,rollupOptions:{input:['mcp-host.html','mcp-sandbox.html']}}});
