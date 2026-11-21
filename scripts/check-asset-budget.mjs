import {readdir,stat} from 'node:fs/promises';
const limit=25*1024*1024;let largest={path:'',bytes:0};
async function check(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=`${dir}/${entry.name}`;if(entry.isDirectory())await check(path);else{const bytes=(await stat(path)).size;if(bytes>largest.bytes)largest={path,bytes};if(bytes>limit)throw new Error(`${path}: ${bytes} bytes exceeds the Worker 25 MiB asset limit`);}}}
await check('dist');console.log(`Asset budget PASS: largest ${largest.path}, ${largest.bytes} / ${limit} bytes`);
const mcpTemplateBytes=(await stat('dist/mcp/mcp-app.html')).size;
const mcpTemplateLimit=64*1024;
if(mcpTemplateBytes>mcpTemplateLimit)throw new Error(`MCP template: ${mcpTemplateBytes} bytes exceeds the ${mcpTemplateLimit}-byte project budget`);
console.log(`MCP template budget PASS: ${mcpTemplateBytes} / ${mcpTemplateLimit} bytes`);
