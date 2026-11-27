import type {Connection} from './network';
import {DRIVER_RADIO_TEXT_LIMIT} from './strategy-events';
import type {DriverConsultRadio, DriverQuestionAccepted, Team} from './types';

type ChatQuestion = Pick<DriverQuestionAccepted, 'room' | 'team' | 'event_id' | 'text'>;
export type SendDriverQuestion = (question: ChatQuestion) => Promise<void>;
const ACK_TIMEOUT_MS = 5_000;

interface ChatSubmission {
 connection: Connection;
 room: string;
 requestId: string;
 text: string;
 accepted?: {question: ChatQuestion; deadline: number};
 timer?: ReturnType<typeof setTimeout>;
 sending?: boolean;
}

export function mountDriverRadio(panel: HTMLElement, seat: Team, connection: () => Connection,
 {collapsible = false, sendDriverQuestion}: {collapsible?: boolean; sendDriverQuestion?: SendDriverQuestion | null} = {}) {
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
 let chat: ChatSubmission | undefined;
 let notice = '';
 let replaying = false;
 let disposed = false;

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
  if (disposed) return;
  replaying = replay;
  const conn = connection(), state = conn.state;
  const authorized = conn.team === seat && conn.role === 'driver' && state?.strategyPractice &&
   Boolean(seat === 'a' ? state.chatStrategy : state.guestChatStrategy);
  const messages = state?.driverConsultRadio?.[seat] ?? [];
  const racing = authorized && state?.live === 'running' && state.race.phase === 'racing' &&
   state.race.cars[seat].finishTime === null && !replaying;
  if (chat && !isCurrent(chat)) {
   clearChat();
   notice = '';
  } else if (chat?.accepted && !chat.sending && performance.now() >= chat.accepted.deadline) {
   clearChat();
   notice = 'This radio question expired. Press Send to ask again.';
  }
  panel.hidden = !authorized || (!racing && (!log || !messages.length));
  if (!racing) toggle?.setAttribute('aria-expanded','false');
  form.hidden = !racing || toggle?.getAttribute('aria-expanded') === 'false';
  if (panel.hidden) return;
  if (log && (messages.length !== rows.size || (messages.length && !rows.has(messages[messages.length - 1].id)))) updateLog(messages);

  if (sent) {
   const {text, afterId, deadline} = sent;
   if (messages.some(message => message.id > afterId && message.consultation === 'question' && message.text === text)) {
    complete(text);
    sent = undefined;
   } else if (performance.now() >= deadline) {
    sent = undefined;
    notice = 'Radio transmission could not be confirmed.';
   }
  }

  input.disabled = conn.status !== 'CONNECTED' || sendDriverQuestion === null;
  input.readOnly = Boolean(chat);
  const value = input.value.trim();
  const transmitting = Boolean(sent) || chat?.timer !== undefined;
  submit.disabled = input.disabled || !value || value.length > DRIVER_RADIO_TEXT_LIMIT || transmitting || Boolean(chat?.sending);
  let feedback = notice;
  if (sendDriverQuestion === null) feedback = 'This host doesn’t support sending team radio questions to chat.';
  else if (chat?.sending) feedback = 'Sending to chat…';
  else if (transmitting) feedback = 'Transmitting…';
  if (feedback !== status.textContent) status.textContent = feedback;
  status.hidden = !feedback;
 }

 function complete(text: string) {
  if (input.value.trim() === text) {
   input.value = '';
   if (toggle) closeForm();
  }
  notice = '';
 }
 function isCurrent(request: ChatSubmission) {
  const conn = connection(), state = conn.state;
  return chat === request && request.connection === conn && state?.room === request.room &&
   state.live === 'running' && state.race.phase === 'racing' && state.race.cars[seat].finishTime === null;
 }
 function clearChat() {
  clearTimeout(chat?.timer);
  chat = undefined;
 }
 function transmitChat(request: ChatSubmission) {
  request.timer = setTimeout(() => {
   request.timer = undefined;
   if (isCurrent(request)) {
    notice = 'Radio transmission could not be confirmed. Press Send to retry.';
    sync();
   }
  }, ACK_TIMEOUT_MS);
  request.connection.send({type: 'strategy-question', text: request.text, delivery: 'chat', requestId: request.requestId});
 }
 async function sendToChat(request: ChatSubmission) {
  if (!sendDriverQuestion || !request.accepted) return;
  if (performance.now() >= request.accepted.deadline) { sync(); return; }
  request.sending = true;
  sync();
  try {
   await sendDriverQuestion(request.accepted.question);
   if (!isCurrent(request)) return;
   clearChat();
   complete(request.text);
  } catch (error) {
   if (!isCurrent(request)) return;
   request.sending = false;
   notice = error instanceof Error && error.message ? error.message : 'Could not send the radio message to chat. Press Send to retry.';
  }
  sync();
 }
 function onAccepted({room, team, event_id, text, expiresAt, requestId}: DriverQuestionAccepted) {
  const request = chat;
  const state = request?.connection.state;
  if (!request || !state || request.accepted || !isCurrent(request) || request.requestId !== requestId ||
      request.room !== room || team !== seat || request.connection.team !== seat || request.connection.role !== 'driver' ||
      request.text !== text) return;
  clearTimeout(request.timer);
  request.timer = undefined;
  request.accepted = {
   question: {room, team, event_id, text},
   deadline: request.connection.received + expiresAt - state.serverTime,
  };
  notice = '';
  void sendToChat(request);
 }
 function onError(message: string, requestId?: string) {
  if (sendDriverQuestion) {
   if (!chat || !isCurrent(chat) || chat.accepted || chat.requestId !== requestId) return;
   clearChat();
  }
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
  notice = '';
  if (sendDriverQuestion) {
   if (!conn.state) return;
   const request = chat ??= {connection: conn, room: conn.state.room, requestId: crypto.randomUUID(), text};
   if (request.accepted) void sendToChat(request);
   else transmitChat(request);
  } else {
   sent = {text, afterId: conn.state?.driverConsultRadio?.[seat]?.at(-1)?.id ?? 0, deadline: performance.now() + ACK_TIMEOUT_MS};
   conn.send({type: 'strategy-question', text});
  }
  if (!toggle) {
   input.blur();
   submit.blur();
  }
  sync();
 };

 return {sync,onAccepted,onError,dispose(){
  disposed = true;
  clearChat();
  if(toggle)toggle.onclick=null;
  panel.onkeydown=null;input.oninput=null;form.onsubmit=null;
  rows.clear();panel.replaceChildren();
 }};
}
