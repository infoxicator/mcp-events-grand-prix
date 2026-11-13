import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import type { ArenaState } from '../src/protocol';
export const PONG_RESOURCE='ui://jev-pong/arena.html';

/** Local Streamable HTTP MCP adapter. Physics, agents and credentials stay in the game server. */
export function createPongMcp(origin:string,getState:()=>ArenaState){
  const websocketOrigin=origin.replace(/^http/,'ws'),tokens=new Map<string,number>();
  function mintToken(){
    for(const [token,expires] of tokens)if(expires<Date.now())tokens.delete(token);
    if(tokens.size>=256)tokens.delete(tokens.keys().next().value!);
    const token=randomBytes(32).toString('base64url');tokens.set(token,Date.now()+2*60*60*1000);return token;
  }
  function createServer(){
    const server=new McpServer({name:'Jev Pong',version:'1.0.0'});
    registerAppTool(server,'open_pong',{
      title:'Open Jev Pong',description:'Open the live Jev Pong arena. Read-only by default. Autoplay fills empty AI player seats and may use paid providers configured on the server. Existing web players keep their seats.',
      inputSchema:z.object({autoplay:z.boolean().default(false),player:z.enum(['left','right','both','spectator']).default('both')}),
      annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
      _meta:{ui:{resourceUri:PONG_RESOURCE}},
    },async({autoplay,player})=>{
      const s=getState();
      return {content:[{type:'text',text:`${s.matchup}: ${s.game.score.left}:${s.game.score.right}. Web spectator: ${origin}/?spectate. ${autoplay?'The app will connect AI controllers to empty seats.':'Use Start AI players in the app, or open the two web player windows.'}`}],
        structuredContent:{origin,autoplay,player,matchup:s.matchup,players:s.players},
        _meta:{connection:{origin,token:mintToken()}}};
    });
    server.registerTool('pong_status',{
      title:'Pong match status',description:'Read the current authoritative score, players, decisions, provider status and tick. Does not start agents or call an AI provider.',
      inputSchema:z.object({}),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
    },async()=>{const s=getState();return {content:[{type:'text',text:JSON.stringify(s)}],structuredContent:{...s}};});
    registerAppResource(server,'Jev Pong arena',PONG_RESOURCE,{mimeType:RESOURCE_MIME_TYPE},async()=>({
      contents:[{uri:PONG_RESOURCE,mimeType:RESOURCE_MIME_TYPE,text:await readFile(resolve('dist/mcp/mcp-app.html'),'utf8'),
        _meta:{ui:{prefersBorder:false,csp:{connectDomains:[websocketOrigin],resourceDomains:[],frameDomains:[]}}}}],
    }));
    return server;
  }
  return {
    acceptsToken(token:string|null){return !!token&&(tokens.get(token)??0)>Date.now();},
    async handle(req:IncomingMessage,res:ServerResponse){
      const host=req.headers.host;
      if(host!==new URL(origin).host&&host!==new URL(origin.replace('127.0.0.1','localhost')).host){res.writeHead(403);res.end('Invalid MCP host');return;}
      const requestOrigin=req.headers.origin;
      if(requestOrigin){
        try{const url=new URL(requestOrigin);if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname))throw new Error();}
        catch{res.writeHead(403);res.end('Invalid MCP origin');return;}
        res.setHeader('Access-Control-Allow-Origin',requestOrigin);res.setHeader('Vary','Origin');
        res.setHeader('Access-Control-Allow-Headers','Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID');
        res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Expose-Headers','MCP-Session-Id');
      }
      if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
      const server=createServer(),transport=new NodeStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
      res.on('close',()=>{void transport.close();void server.close();});
      try{await server.connect(transport);await transport.handleRequest(req,res);}
      catch{if(!res.headersSent){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32603,message:'MCP request failed'}}));}}
    },
  };
}
