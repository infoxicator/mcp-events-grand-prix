import { H, W, INSET, PADDLE_H, PADDLE_W, R, type GameState } from './physics';
export const COLORS = { left: '#c5fa6c', right: '#bda4ff' };
export function createRenderer(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const trail: {x:number;y:number}[] = [];
  return (s: GameState, replay = false) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== W*dpr) { canvas.width=W*dpr; canvas.height=H*dpr; }
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);
    ctx.fillStyle='#0b1215'; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='#ffffff04'; ctx.lineWidth=1;
    for (let x=20;x<W;x+=40) { ctx.beginPath(); ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke(); }
    for (let y=20;y<H;y+=40) { ctx.beginPath(); ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke(); }
    ctx.setLineDash([5,12]);ctx.strokeStyle='#ffffff20';ctx.beginPath();ctx.moveTo(W/2,24);ctx.lineTo(W/2,H-24);ctx.stroke();ctx.setLineDash([]);
    ctx.beginPath();ctx.arc(W/2,H/2,68,0,Math.PI*2);ctx.strokeStyle='#ffffff0a';ctx.stroke();
    if (s.phase === 'play' || replay) { trail.unshift({x:s.ball.x,y:s.ball.y});if(trail.length>16)trail.pop(); } else trail.length=0;
    trail.forEach((p,i)=>{ctx.fillStyle=`rgba(225,255,206,${(1-i/16)*0.23})`;ctx.beginPath();ctx.arc(p.x,p.y,R*(1-i/20),0,Math.PI*2);ctx.fill();});
    for (const side of ['left','right'] as const) {
      const x=side==='left'?INSET:W-INSET-PADDLE_W;
      ctx.shadowColor=COLORS[side];ctx.shadowBlur=22;ctx.fillStyle=COLORS[side];
      ctx.beginPath();ctx.roundRect(x,s.paddles[side]-PADDLE_H/2,PADDLE_W,PADDLE_H,5);ctx.fill();ctx.shadowBlur=0;
      ctx.strokeStyle=COLORS[side]+'50';ctx.setLineDash([3,5]);ctx.beginPath();ctx.arc(x+PADDLE_W/2,s.targets[side],17,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    }
    if (s.phase !== 'lobby') { ctx.shadowBlur=20;ctx.shadowColor='#e9ffd9';ctx.fillStyle='#f3ffe6';ctx.beginPath();ctx.arc(s.ball.x,s.ball.y,R,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0; }
    ctx.font='11px monospace';ctx.fillStyle='#56686c';ctx.fillText('01 / LEFT',24,H-18);ctx.textAlign='right';ctx.fillText('RIGHT / 02',W-24,H-18);ctx.textAlign='left';
  };
}
