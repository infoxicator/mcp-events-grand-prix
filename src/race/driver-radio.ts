import type {Connection} from './network';
import {DRIVER_RADIO_TEXT_LIMIT} from './strategy-events';
import type {DriverConsultRadio, Team} from './types';

export function mountDriverRadio(panel: HTMLElement, seat: Team, connection: () => Connection, {collapsible = false} = {}) {
 panel.innerHTML = `
  ${collapsible
   ? '<button type="button" class="radio-talk" aria-controls="driver-radio-form" aria-expanded="false"><i aria-hidden="true"></i>Team radio</button>'
   : '<h2 id="drive-team-radio-title">Team radio</h2><div class="drive-team-radio-log" role="log" aria-labelledby="drive-team-radio-title"></div>'}
  <form id="driver-radio-form" hidden>
   <label for="drive-radio-question">Ask the strategist</label>
   <div class="drive-team-radio-row">
    <input id="drive-radio-question" type="text" maxlength="${DRIVER_RADIO_TEXT_LIMIT}" autocomplete="off" placeholder="How are my tyres?" required>
    <button type="submit" disabled>Send</button>
   </div>
   <p class="drive-team-radio-status" role="status" hidden></p>
  </form>`;
 const toggle = panel.querySelector<HTMLButtonElement>('.radio-talk');
 const log = panel.querySelector<HTMLElement>('[role="log"]');
 const form = panel.querySelector('form')!;
 const input = form.querySelector('input')!;
 const submit = form.querySelector('button')!;
 const status = form.querySelector<HTMLElement>('[role="status"]')!;
 const rows = new Map<number, HTMLElement>();
 let sent: {text: string; afterId: number; deadline: number} | undefined;
 let notice = '';
 let replaying = false;

 function updateLog(messages: readonly DriverConsultRadio[]) {
  if (!log) return;
  const ids = new Set(messages.map(message => message.id));
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 4;
  for (const [id, row] of rows) {
   if (ids.has(id)) continue;
   row.remove();
   rows.delete(id);
  }
  for (const message of messages) {
   if (rows.has(message.id)) continue;
   const row = document.createElement('div');
   row.className = 'drive-team-radio-message';
   row.dataset.speaker = message.speaker;
   const speaker = document.createElement('b');
   speaker.textContent = message.consultation === 'question' ? 'Driver' : 'ChatGPT strategist';
   const line = document.createElement('p');
   line.textContent = message.text;
   row.append(speaker, line);
   log.append(row);
   rows.set(message.id, row);
  }
  log.tabIndex = messages.length ? 0 : -1;
  if (atBottom) log.scrollTop = log.scrollHeight;
 }

 function sync(replay = replaying) {
  replaying = replay;
  const conn = connection(), state = conn.state;
  const authorized = conn.team === seat && conn.role === 'driver' && state?.strategyPractice &&
   Boolean(seat === 'a' ? state.chatStrategy : state.guestChatStrategy);
  const messages = state?.driverConsultRadio?.[seat] ?? [];
  const racing = authorized && state?.live === 'running' && state.race.phase === 'racing' &&
   state.race.cars[seat].finishTime === null && !replaying;
  panel.hidden = !authorized || (!racing && (!log || !messages.length));
  if (!racing) toggle?.setAttribute('aria-expanded','false');
  form.hidden = !racing || toggle?.getAttribute('aria-expanded') === 'false';
  if (panel.hidden) return;
  if (log && (messages.length !== rows.size || (messages.length && !rows.has(messages[messages.length - 1].id)))) updateLog(messages);

  if (sent) {
   const {text, afterId, deadline} = sent;
   if (messages.some(message => message.id > afterId && message.consultation === 'question' && message.text === text)) {
    if (input.value.trim() === text) {
     input.value = '';
     if (toggle) closeForm();
    }
    sent = undefined;
    notice = '';
   } else if (performance.now() >= deadline) {
    onError('Radio transmission could not be confirmed.');
   }
  }

  input.disabled = conn.status !== 'CONNECTED';
  const value = input.value.trim();
  submit.disabled = input.disabled || !value || value.length > DRIVER_RADIO_TEXT_LIMIT || Boolean(sent);
  const feedback = notice || (sent ? 'Transmitting…' : '');
  if (feedback !== status.textContent) status.textContent = feedback;
  status.hidden = !feedback;
 }

 function onError(message: string) {
  sent = undefined;
  notice = message;
  sync();
 }
 function closeForm() {
  const restoreFocus = form.contains(document.activeElement);
  toggle?.setAttribute('aria-expanded','false');
  form.hidden = true;
  if (restoreFocus) toggle?.focus();
 }
 if (toggle) toggle.onclick = () => {
  if (!form.hidden) { closeForm(); return; }
  toggle.setAttribute('aria-expanded','true');
  sync();
  if (!form.hidden) input.focus();
 };
 panel.onkeydown = event => {
  event.stopPropagation();
  if (event.key === 'Escape' && !event.isComposing) {
   event.preventDefault();
   if (toggle) closeForm();
   else (document.activeElement as HTMLElement | null)?.blur();
  }
 };
 input.oninput = () => {
  notice = '';
  sync();
 };
 form.onsubmit = event => {
  event.preventDefault();
  sync();
  if (form.hidden || submit.disabled) return;
  const conn = connection(), text = input.value.trim();
  sent = {text, afterId: conn.state?.driverConsultRadio?.[seat]?.at(-1)?.id ?? 0, deadline: performance.now() + 5_000};
  notice = '';
  conn.send({type: 'strategy-question', text});
  if (!toggle) {
   input.blur();
   submit.blur();
  }
  sync();
 };

 return {sync,onError,dispose(){
  if(toggle)toggle.onclick=null;
  panel.onkeydown=null;input.oninput=null;form.onsubmit=null;
  rows.clear();panel.replaceChildren();
 }};
}
