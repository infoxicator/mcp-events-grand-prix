import { parseInvitation,playerURL,invitationCode } from './invitation';
import { copyInvitation } from './clipboard';
import type { RoomLinks,HostedRoom } from './host-types';
export type { RoomLinks,HostedRoom } from './host-types';
/** Capability credentials live in fragments and the first WS message, never WS query strings. */
export async function prepareRoom():Promise<HostedRoom|null>{
  const response=await fetch('/api/config');
  if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))return null;
  const config=await response.json();if(!config.hosted)return null;
  const fragment=new URLSearchParams(location.hash.slice(1));
  if(fragment.has('invite')){const invitation=parseInvitation(fragment.get('invite')!,location.origin);history.replaceState(null,'',playerURL(location.origin,invitation));}
  let room=new URLSearchParams(location.search).get('room');
  let token=new URLSearchParams(location.hash.slice(1)).get('token')??'';
  let links:RoomLinks|null=null;
  if(!room){
    const created=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({matchup:new URLSearchParams(location.search).get('matchup')??'jev-vs-jev'})});
    if(!created.ok)throw new Error((await created.json()).error??'Unable to create room');
    links=await created.json();room=links!.room;
    history.replaceState(null,'',links!.owner);token=new URLSearchParams(location.hash.slice(1)).get('token')!;
  }else {
    const info=await fetch(`/api/rooms/${room}/info`);
    if(!info.ok)throw new Error('This room has expired. Create a new match.');
  }
  if(!links&&token){
    const res=await fetch(`/api/rooms/${room}/links`,{headers:{Authorization:`Bearer ${token}`}});
    if(res.ok)links=await res.json();
  }
  return {room:room!,token,links};
}
export function showRoomPanel(hosted:HostedRoom){
  const panel=document.createElement('details');panel.open=!!hosted.links;panel.className='room-panel';panel.setAttribute('aria-label','Hosted room');
  const summary=document.createElement('summary');panel.append(summary);
  const title=document.createElement('strong');title.textContent=hosted.links?'YOUR PRIVATE MATCH LINKS':'HOSTED MATCH';summary.append(title);
  const body=document.createElement('div');body.className='room-panel-body';panel.append(body);
  const detail=document.createElement('span');detail.textContent=hosted.links?'Open Vector and Chaos in separate windows. Keep both running. Share only the spectator link.':'Both player windows must stay open. Private seat links come from the room owner.';body.append(detail);
  if(hosted.links){
    for(const [key,label] of [['left','↗ Launch Vector'],['right','↗ Launch Chaos'],['spectator','↗ Spectator']] as const){
      if(!hosted.links[key])continue;
      const link=document.createElement('a');link.href=hosted.links[key];link.textContent=label;link.target='_blank';link.rel='noopener';link.dataset.launch=key;body.append(link);
    }
    const copy=document.createElement('button');copy.textContent='Copy spectator link';copy.onclick=async()=>{await navigator.clipboard.writeText(hosted.links!.spectator);copy.textContent='Copied';};body.append(copy);
    const note=document.createElement('small');note.textContent='Keep this owner link for resets and seat links. Room expires after 15 minutes.';body.append(note);
  }
  if(hosted.links){
    for(const side of ['left','right'] as const){
      if(!hosted.links[side])continue;
      const parsed=parseInvitation(hosted.links[side],location.origin),field=document.createElement('input');field.readOnly=true;field.value=invitationCode(parsed.room,side,parsed.credential);field.setAttribute('aria-label',`${side} player invitation`);field.className='seat-invitation';
      const copy=document.createElement('button');copy.textContent=`Copy ${side} invitation`;copy.onclick=async()=>{copy.textContent=await copyInvitation(field)?'Copied':`Selected — press ⌘C / Ctrl+C`;};body.append(field,copy);
    }
  }
  const form=document.createElement('form');form.className='join-room';form.setAttribute('aria-label','Join an existing game');
  const label=document.createElement('label');label.textContent='Join an existing game';const input=document.createElement('input');input.placeholder='Paste pong: invitation or player link';input.setAttribute('aria-label','Invitation to join');label.append(input);
  const join=document.createElement('button');join.textContent='Join player';join.type='submit';const error=document.createElement('span');error.setAttribute('role','alert');error.hidden=true;
  form.append(label,join,error);form.onsubmit=event=>{event.preventDefault();try{const invitation=parseInvitation(input.value,location.origin);location.assign(playerURL(location.origin,invitation));}catch(e){error.textContent=e instanceof Error?e.message:'Invalid invitation';error.hidden=false;}};body.append(form);
  const fresh=document.createElement('a');fresh.href='/';fresh.textContent='Create a new room';body.append(fresh);
  document.querySelector('.hero')!.after(panel);
}

export function showHostingError(error:unknown){
  const main=document.createElement('main');main.className='hosting-error';
  const title=document.createElement('h1');title.textContent='Jev vs Jev Pong';
  const detail=document.createElement('p');detail.textContent=error instanceof Error?error.message:'Unable to connect to the arena.';
  const link=document.createElement('a');link.href='/';link.textContent='Create a new match ↗';main.append(title,detail,link);document.querySelector('#app')!.replaceChildren(main);
}
