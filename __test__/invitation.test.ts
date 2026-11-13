import { expect,it } from 'vitest';
import { parseInvitation,playerURL } from '../src/invitation';
const origin='http://127.0.0.1:8897',room='11111111-1111-4111-8111-111111111111',credential='22222222-2222-4222-8222-222222222222';
const invitation={room,side:'right' as const,credential};
it('accepts copied seat codes and same-server player links',()=>{
  expect(parseInvitation(`  \`pong:${room}:right:${credential}\`  `,origin)).toEqual(invitation);
  expect(parseInvitation(playerURL(origin,invitation),origin)).toEqual(invitation);
  expect(new URL(playerURL(origin,invitation)).search).not.toContain(credential);
});
it('rejects blank, incomplete, wrong-server and spectator invitations',()=>{
  for(const input of ['',`pong:${room}:right:bad`,playerURL('https://other.example',invitation),`${origin}/?room=${room}&spectate#token=${credential}`])expect(()=>parseInvitation(input,origin)).toThrow();
});
