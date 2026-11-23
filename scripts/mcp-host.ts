/** Local SDK AppBridge test host. MCP app and host have separate browser origins. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve,extname } from 'node:path';
import { spawn } from 'node:child_process';
const gamePort=Number(process.env.PORT??5277),hostPort=Number(process.env.MCP_HOST_PORT??gamePort+1),sandboxPort=hostPort+1;
const origin=process.env.MCP_SERVER_URL?new URL(process.env.MCP_SERVER_URL).origin:`http://127.0.0.1:${gamePort}`,hostOrigin=`http://127.0.0.1:${hostPort}`,sandboxOrigin=`http://127.0.0.1:${sandboxPort}`;
let game:ReturnType<typeof spawn>|undefined;
if(process.argv.includes('--start-game')&&!process.env.MCP_SERVER_URL){
  if(await fetch(`${origin}/health`).then(()=>true).catch(()=>false))throw new Error(`Port ${gamePort} is occupied; choose another PORT or use npm run mcp:host to connect to it.`);
  // The MCP preview defaults to mock; JEV_MOCK=0 explicitly enables configured live providers.
  game=spawn(process.execPath,['--import','tsx','server/index.ts','--production'],{stdio:'inherit',env:{...process.env,PORT:String(gamePort),JEV_MOCK:process.env.JEV_MOCK??'1'}});
}
const root=resolve('dist/mcp-host');
function serve(sandbox:boolean){return createServer(async(req,res)=>{
  const url=new URL(req.url??'/',sandbox?sandboxOrigin:hostOrigin);
  if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(!sandbox&&url.pathname==='/config'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({endpoint:process.env.MCP_SERVER_URL??`${origin}/mcp`,sandboxOrigin,testStrategy:process.env.MCP_TEST_STRATEGY==='1'}));return;}
  if(sandbox){
    let csp:{connectDomains?:unknown;resourceDomains?:unknown}={};try{csp=JSON.parse(url.searchParams.get('csp')??'{}');}catch{}
    const connections=Array.isArray(csp.connectDomains)?csp.connectDomains.filter(x=>x===origin||x===origin.replace('http','ws')):[];
    const resources=Array.isArray(csp.resourceDomains)&&csp.resourceDomains.includes(origin)?' '+origin:'';
    res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'self' 'unsafe-inline'${resources}; style-src 'self' 'unsafe-inline'${resources}; font-src data:${resources}; img-src data:${resources}; connect-src ${connections.length?connections.join(' '):"'none'"}; frame-src 'self'; base-uri 'none'; object-src 'none'`);
    res.setHeader('Referrer-Policy','strict-origin');
  }
  const pathname=url.pathname==='/'?(sandbox?'/mcp-sandbox.html':'/mcp-host.html'):url.pathname;
  if((sandbox&&pathname==='/mcp-host.html')||(!sandbox&&pathname==='/mcp-sandbox.html')){res.writeHead(404);res.end();return;}
  try{const path=resolve(root,`.${decodeURIComponent(pathname)}`);if(!path.startsWith(`${root}/`))throw new Error();const body=await readFile(path);res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'} as Record<string,string>)[extname(path)]??'application/octet-stream');res.end(body);}catch{res.writeHead(404);res.end('Not found');}
});}
const host=serve(false),sandbox=serve(true);
host.listen(hostPort,'127.0.0.1',()=>console.log(`MCP host: ${hostOrigin}\nMCP endpoint: ${origin}/mcp\nSandbox: ${sandboxOrigin}`));sandbox.listen(sandboxPort,'127.0.0.1');
for(const server of [host,sandbox])server.on('error',error=>{console.error(error.message);game?.kill('SIGTERM');process.exit(1);});
function shutdown(){game?.kill('SIGTERM');host.close();sandbox.close();process.exit(0);}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
