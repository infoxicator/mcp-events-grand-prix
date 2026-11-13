import {McpServer} from '@modelcontextprotocol/server';
import {registerAppTool,registerAppResource,RESOURCE_MIME_TYPE} from '@modelcontextprotocol/ext-apps/server';
import {z} from 'zod';
import type {Matchup} from '../src/race/matchup';
import type {RaceState,RoomLinks,Team} from '../src/race/types';
import {parseInvitation,invitationCode} from '../src/race/invitation';
export const RACE_RESOURCE='ui://jev-grand-prix/pit-wall.html';
export interface McpRoom {links:RoomLinks;mcpToken:string;state:RaceState;}
export interface RaceGateway{create:(matchup:Matchup)=>Promise<McpRoom>;get:(id:string)=>Promise<McpRoom|null>;html:()=>Promise<string>;}
export function createRaceMcp(origin:string,gateway:RaceGateway){
 const server=new McpServer({name:'Jev Grand Prix',version:'1.0.0'});
 registerAppTool(server,'open_grand_prix',{title:'Open Jev Grand Prix',description:'Create a Monza race with an engineer and fast Jev or Luna drivers. Choose matchup jev-vs-jev or jev-vs-luna. Choose team a or b; share the other team invitation across MCP hosts. An invite always joins its existing race. Public MCP races use mock agents.',inputSchema:z.object({autoplay:z.boolean().default(false),player:z.enum(['a','b','both','spectator']).default('a'),matchup:z.enum(['jev-vs-jev','jev-vs-luna']).default('jev-vs-jev'),invite:z.string().max(2048).optional()}),_meta:{ui:{resourceUri:RACE_RESOURCE}},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},async({autoplay,player,matchup,invite})=>{
  let room:McpRoom|null,joined=false;let assigned=player;
  if(invite){const i=parseInvitation(invite,origin);room=await gateway.get(i.room);if(!room||new URLSearchParams(new URL(room.links[i.team]).hash.slice(1)).get('token')!==i.credential)return {isError:true,content:[{type:'text',text:'Invalid or expired invitation.'}]};assigned=i.team;joined=true;}else room=await gateway.create(matchup);
  const links=room.links,own=assigned==='a'||assigned==='b'?assigned:null,opponent:Team=own==='b'?'a':'b';
  const token=assigned==='both'?new URLSearchParams(new URL(links.owner).hash.slice(1)).get('token')!:own?new URLSearchParams(new URL(links[own]).hash.slice(1)).get('token')!:'';
  // Only the creator gets the other seat invitation; joiners get no opposing credentials.
  const safeLinks={...links,owner:'',a:assigned==='a'||assigned==='both'?links.a:'',b:assigned==='b'||assigned==='both'?links.b:''};
  const invitation=!joined&&assigned!=='spectator'?invitationCode(links.room,opponent,new URLSearchParams(new URL(links[opponent]).hash.slice(1)).get('token')!):'';
  return {content:[{type:'text',text:`Jev Grand Prix · Monza · race ${links.room}. Team ${assigned} · ${room.state.matchup}. Spectator: ${links.spectator}. ${autoplay?'AI seat controllers start when the app is visible.':'Start the team in the app.'}`}],structuredContent:{room:links.room,player:assigned,autoplay,mode:room.state.mode,matchup:room.state.matchup,players:room.state.players},_meta:{connection:{origin,token:room.mcpToken,hosted:{room:links.room,token,links:safeLinks}},...(invitation?{invitation,inviteTeam:opponent,joinURL:links[opponent]}:{})}};
 });
 server.registerTool('grand_prix_status',{title:'Race telemetry',description:'Read the authoritative lap timing, telemetry, radio and connected seats. Starts no agents.',inputSchema:z.object({room:z.string().uuid()}),annotations:{readOnlyHint:true}},async({room})=>{const found=await gateway.get(room);return found?{content:[{type:'text',text:JSON.stringify(found.state)}],structuredContent:{...found.state}}:{isError:true,content:[{type:'text',text:'Race not found or expired.'}]};});
 registerAppResource(server,'Jev Grand Prix pit wall',RACE_RESOURCE,{mimeType:RESOURCE_MIME_TYPE},async()=>({contents:[{uri:RACE_RESOURCE,mimeType:RESOURCE_MIME_TYPE,text:await gateway.html(),_meta:{ui:{prefersBorder:false,csp:{connectDomains:[origin.replace(/^http/,'ws')],resourceDomains:[],frameDomains:[]}}}}]}));
 return server;
}
