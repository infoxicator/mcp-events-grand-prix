import type {Connection} from './network';
import {raceAudio} from './race-audio';

export function broadcastView(viewport:HTMLElement,initial:boolean,watchURL:string,connection:Connection,openLink?:(url:string)=>void){
 const toolbar=viewport.querySelector<HTMLElement>('.camera-controls')!,anchor=document.createComment('camera controls');
 toolbar.before(anchor);
 const enter=document.createElement('button');enter.id='clean-broadcast';enter.textContent='Clean broadcast';
 const feedActions=document.querySelector('.feed-actions')!;
 feedActions.prepend(enter);
 const menu=document.createElement('details');menu.className='broadcast-menu';
 menu.innerHTML='<summary>Broadcast controls</summary><section><div class="broadcast-options"><button class="return-wall">Pit Wall</button><button class="feed-replay">Replay</button><button class="audio-toggle">Enable sound</button><label>Volume <input aria-label="Sound level" type="range" min="0" max="1" step=".05"></label></div><a class="private-watch">Watch a new mock race at 1×</a><a class="drive-entry" href="/?drive">Drive an F1 car</a></section>';
 viewport.append(menu);const summary=menu.querySelector('summary')!,panel=menu.querySelector('section')!;
 const privateWatch=menu.querySelector<HTMLAnchorElement>('.private-watch')!;
 const audioButton=menu.querySelector<HTMLButtonElement>('.audio-toggle')!;
 const audio=raceAudio(audioButton,menu.querySelector('input')!,connection);
 const watch=document.createElement('a');
 watch.className='watch-entry';
 watch.textContent='Watch a solo mock race at 1×';
 document.querySelector('#waiting p')!.after(watch);
 const watchLinks=[watch,privateWatch];
 function setWatchURL(url:string){for(const link of watchLinks)link.href=url;}
 setWatchURL(watchURL);
 const driveEntry=menu.querySelector<HTMLAnchorElement>('.drive-entry')!;if(openLink){driveEntry.onclick=event=>{event.preventDefault();openLink(new URL('/?drive',watchURL).href);};}if(openLink)for(const link of watchLinks){
  link.onclick=event=>{event.preventDefault();openLink(link.href);};
 }
 const ac=new AbortController(),{signal}=ac;
 const inactive:HTMLElement[]=[];
 let clean=false;
 function set(next:boolean,focus=true){
  clean=next;document.body.classList.toggle('clean-feed',next);menu.open=false;
  if(next){panel.prepend(toolbar);menu.querySelector('.broadcast-options')!.prepend(audioButton);
   for(let node:HTMLElement|null=viewport;node&&node!==document.body;node=node.parentElement){
    for(const sibling of node.parentElement!.children)if(sibling!==node&&sibling instanceof HTMLElement&&!sibling.inert){
     sibling.inert=true;inactive.push(sibling);
    }
   }
  }else{anchor.after(toolbar);enter.after(audioButton);for(const e of inactive)e.inert=false;inactive.length=0;}
  if(focus)(next?summary:enter).focus();
 }
 enter.onclick=()=>set(true);menu.querySelector<HTMLButtonElement>('.return-wall')!.onclick=()=>set(false);
 menu.querySelector<HTMLButtonElement>('.feed-replay')!.onclick=()=>{menu.open=false;document.querySelector<HTMLButtonElement>('#replay-button')!.click();};
 toolbar.addEventListener('click',()=>{if(clean){menu.open=false;summary.focus();}},{signal});
 const nav=document.querySelector<HTMLAnchorElement>('a[data-view="broadcast"]')!;
 if(document.body.dataset.view==='spectator'){
  nav.addEventListener('click',e=>{e.preventDefault();set(true);},{signal});
 }else{
  const world=new URL(nav.href);world.searchParams.set('broadcast','');nav.href=world.href;
  nav.target='_blank';nav.rel='noopener';nav.textContent='World feed ↗';
 }
 function key(e:KeyboardEvent){
  if(e.altKey||e.ctrlKey||e.metaKey||e.repeat||document.querySelector('dialog[open]')||e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement)return;
  if(e.key==='Escape'&&clean){if(menu.open){menu.open=false;summary.focus();}else set(false);e.preventDefault();}
  if(e.key.toLowerCase()==='b'){set(!clean);e.preventDefault();}
  if(clean&&e.key.toLowerCase()==='c'){menu.open=!menu.open;summary.focus();e.preventDefault();}
 }
 window.addEventListener('keydown',key,{signal});set(initial,false);
 return {get clean(){return clean;},audio,setWatchURL,dispose(){set(false,false);audio.dispose();ac.abort();enter.remove();audioButton.remove();menu.remove();watch.remove();anchor.remove();}};
}
