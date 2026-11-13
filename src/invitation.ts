import type { Side } from './physics';
const UUID='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const uuid=new RegExp(`^${UUID}$`,'i'),code=new RegExp(`^pong:(${UUID}):(left|right):(${UUID})$`,'i');
export interface Invitation {room:string;side:Side;credential:string}
/** Both the browser and MCP accept the same seat code or same-server player link. */
export function parseInvitation(value:string,origin:string):Invitation{
  const text=value.trim().replace(/^`([^`]+)`$/,'$1');
  if(!text||text.length>2048)throw new Error('Paste a complete Pong invitation code or player link.');
  const match=code.exec(text);
  if(match)return {room:match[1].toLowerCase(),side:match[2].toLowerCase() as Side,credential:match[3].toLowerCase()};
  let url:URL;try{url=new URL(text);}catch{throw new Error('Invalid invitation. Copy the complete pong: code or player link.');}
  if(url.origin!==origin)throw new Error('This player link belongs to another server. Open it on that server.');
  const room=url.searchParams.get('room'),side=url.searchParams.get('side'),credential=new URLSearchParams(url.hash.slice(1)).get('token');
  if(url.pathname!=='/'||url.username||url.password||url.searchParams.has('spectate')||!room||!uuid.test(room)||(side!=='left'&&side!=='right')||!credential||!uuid.test(credential))throw new Error('Use a player invitation, not a spectator or owner link.');
  return {room,side,credential};
}
export function playerURL(origin:string,invite:Invitation){
  const url=new URL('/',origin);url.searchParams.set('room',invite.room);url.searchParams.set('side',invite.side);url.hash=new URLSearchParams({token:invite.credential}).toString();return url.href;
}
export function invitationCode(room:string,side:Side,credential:string){return `pong:${room}:${side}:${credential}`;}
