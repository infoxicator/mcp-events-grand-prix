import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { parseInvitation } from '../src/invitation';
import type { Env } from './index';
import type { RoomLinks } from '../src/host-types';
const RESOURCE='ui://jev-pong/arena.html';
/** Stateless HTTPS MCP; create an isolated mock room or join its invited seat across hosts. */
export async function handleMcp(req:Request,env:Env):Promise<Response>{
  const origin=new URL(req.url).origin;
  const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID','Access-Control-Allow-Methods':'POST, GET, DELETE, OPTIONS','Access-Control-Expose-Headers':'MCP-Session-Id'};
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return new Response('Use Streamable HTTP POST',{status:405,headers:{...cors,Allow:'POST, OPTIONS'}});
  const server=new McpServer({name:'Jev Pong',version:'1.2.0'});
  registerAppTool(server,'open_pong',{
    title:'Open Jev Pong',description:'Create or join an interactive Pong game. To play across ChatGPT and Claude, create with player=left and autoplay=true, then copy the right-player invitation from the app into the other host. Join an existing game by passing its exact pong: invitation as invite; never create a new room when an invitation was supplied. player=both runs both controllers in one view (default); spectator starts none. Public brains are mocked, no paid API calls; rooms expire after 15 minutes.',
    inputSchema:z.object({autoplay:z.boolean().default(false),matchup:z.enum(['jev-vs-jev','jev-vs-luna']).default('jev-vs-jev'),player:z.enum(['left','right','both','spectator']).default('both'),invite:z.string().max(2048).optional()}),
    annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},_meta:{ui:{resourceUri:RESOURCE}},
  },async({autoplay,matchup,player,invite})=>{
    let room:string,mcpToken:string,links:RoomLinks,joined=false;
    if(invite!==undefined){
      let parsed:ReturnType<typeof parseInvitation>;
      try{parsed=parseInvitation(invite,origin);}catch(error){return {isError:true,content:[{type:'text',text:error instanceof Error?error.message:'Invalid invitation'}]};}
      room=parsed.room;const side=parsed.side;
      if(player!=='both'&&player!==side)return {isError:true,content:[{type:'text',text:`This invitation is for the ${side} player only.`}]};
      const response=await env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(new Request(`${origin}/mcp-join?room=${room}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({side,credential:parsed.credential})}));
      if(!response.ok)return {isError:true,content:[{type:'text',text:'Invitation invalid or room expired. Ask the first player for a fresh invitation.'}]};
      ({mcpToken,links}=await response.json() as {mcpToken:string;links:RoomLinks});player=side;joined=true;
    }else{
      const limit=await env.ROOM_CREATION.limit({key:req.headers.get('CF-Connecting-IP')??'mcp-local'});
      if(!limit.success)return {isError:true,content:[{type:'text',text:'Room creation limit reached. Try again in a minute.'}]};
      room=crypto.randomUUID();
      const response=await env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(new Request(`${origin}/init?room=${room}`,{method:'POST',headers:{'X-Matchup':matchup,'X-Real-Room':'false','X-MCP-Room':'true'}}));
      if(!response.ok)throw new Error('Unable to create Pong room');
      const created=await response.json() as RoomLinks&{mcpToken:string};({mcpToken,...links}=created);
    }
    const state=await (await env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(new Request(`${origin}/mcp-status`))).json() as {players:unknown;matchup:string};
    const other=player==='right'?'left':'right';
    const invitation=!joined&&player!=='spectator'?`pong:${room}:${other}:${new URLSearchParams(new URL(links[other]).hash.slice(1)).get('token')}`:undefined;
    return {content:[{type:'text',text:`Mock ${state.matchup} arena ${joined?'joined':'opened'}. Room ${room}. This app controls: ${player}. Spectator: ${links.spectator}. ${autoplay&&player!=='spectator'?'Your player controller(s) will start.':'Use Start in the app to begin.'} ${invitation?'Copy the other-player invitation from the app to join this same room in another MCP host.':''}`}],
      structuredContent:{origin,autoplay,matchup:state.matchup,room,player,spectatorURL:links.spectator,players:state.players},
      _meta:{invitation,joinURL:invitation?links[other]:undefined,inviteSide:other,connection:{origin,token:mcpToken,hosted:{room,token:links.owner?new URLSearchParams(new URL(links.owner).hash.slice(1)).get('token'):'',links}}}};
  });
  server.registerTool('pong_status',{
    title:'Pong match status',description:'Read score, tick, decisions and connectivity for a public mock room opened with open_pong. Does not start agents or call providers.',
    inputSchema:z.object({room:z.string().uuid()}),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
  },async({room})=>{
    const response=await env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(new Request(`${origin}/mcp-status`));
    if(!response.ok)return {isError:true,content:[{type:'text',text:'MCP room missing or expired. Open a new Pong arena.'}]};
    const state=await response.json() as Record<string,unknown>;
    return {content:[{type:'text',text:JSON.stringify(state)}],structuredContent:state};
  });
  registerAppResource(server,'Jev Pong arena',RESOURCE,{mimeType:RESOURCE_MIME_TYPE},async()=>{
    const resource=await env.ASSETS.fetch(new Request(`${origin}/mcp/mcp-app.html`));
    if(!resource.ok)throw new Error('MCP UI bundle missing');
    return {contents:[{uri:RESOURCE,mimeType:RESOURCE_MIME_TYPE,text:await resource.text(),_meta:{ui:{prefersBorder:false,csp:{connectDomains:[origin.replace(/^http/,'ws')],resourceDomains:[],frameDomains:[]}}}}]};
  });
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  try{
    await server.connect(transport);
    const response=await transport.handleRequest(req);
    const headers=new Headers(response.headers);for(const [key,value] of Object.entries(cors))headers.set(key,value);headers.set('Cache-Control','no-store');
    return new Response(response.body,{status:response.status,headers});
  }finally{await server.close();}
}
