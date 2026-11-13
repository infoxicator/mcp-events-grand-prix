import type {Team} from './types';
const UUID='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',uuid=new RegExp(`^${UUID}$`,'i'),code=new RegExp(`^jev:(${UUID}):(a|b):(${UUID})$`,'i');
export interface Invitation{room:string;team:Team;credential:string}
export function parseInvitation(value:string,origin:string):Invitation{
 const text=value.trim().replace(/^`([^`]+)`$/,'$1');if(text.length>2048)throw new Error('Paste a complete Jev invitation.');const m=code.exec(text);if(m)return {room:m[1].toLowerCase(),team:m[2].toLowerCase() as Team,credential:m[3].toLowerCase()};
 let u:URL;try{u=new URL(text);}catch{throw new Error('Use the complete jev: invitation or team link.');}const room=u.searchParams.get('room'),team=u.searchParams.get('team'),credential=new URLSearchParams(u.hash.slice(1)).get('token');if(u.origin!==origin||u.pathname!=='/'||u.username||u.password||u.searchParams.has('spectate')||!room||!uuid.test(room)||(team!=='a'&&team!=='b')||!credential||!uuid.test(credential))throw new Error('Use a team invitation from this server.');return {room,team,credential};
}
export function invitationCode(room:string,team:Team,credential:string){return `jev:${room}:${team}:${credential}`;}
export function playerURL(origin:string,i:Invitation){return `${origin}/?room=${i.room}&team=${i.team}#token=${i.credential}`;}
