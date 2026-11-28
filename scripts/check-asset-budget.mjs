import {readFile,readdir,stat} from 'node:fs/promises';
const limit=25*1024*1024;let largest={path:'',bytes:0};
async function check(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=`${dir}/${entry.name}`;if(entry.isDirectory())await check(path);else{const bytes=(await stat(path)).size;if(bytes>largest.bytes)largest={path,bytes};if(bytes>=limit)throw new Error(`${path}: ${bytes} bytes exceeds the Worker 25 MiB asset limit`);}}}
await check('dist');console.log(`Asset budget PASS: largest ${largest.path}, ${largest.bytes} / ${limit} bytes`);
const mcpTemplateBytes=(await stat('dist/mcp/mcp-app.html')).size;
const mcpTemplateLimit=64*1024;
if(mcpTemplateBytes>mcpTemplateLimit)throw new Error(`MCP template: ${mcpTemplateBytes} bytes exceeds the ${mcpTemplateLimit}-byte project budget`);
console.log(`MCP template budget PASS: ${mcpTemplateBytes} / ${mcpTemplateLimit} bytes`);

const glb=await readFile(new URL('../src/race/assets/jgp26-high.glb',import.meta.url));
const model=JSON.parse(glb.toString('utf8',20,20+glb.readUInt32LE(12)));
const triangles=model.meshes.flatMap(mesh=>mesh.primitives).reduce((sum,primitive)=>{
 if((primitive.mode??4)!==4)throw Error('Expected triangles in the hero export');
 return sum+model.accessors[primitive.indices??primitive.attributes.POSITION].count/3;
},0);
if(triangles>245000)throw Error('High-detail hero exceeds 245,000 triangles: '+triangles);
console.log('Hero triangle budget PASS: '+triangles+' / 245000');
