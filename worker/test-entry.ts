/** Local workerd fixture entry only. Never referenced by production wrangler.jsonc. */
import app, { GameRoom, type Env } from './index';
import { createLunaBrain, lunaConfig } from '../server/luna';
import { createBrain } from '../server/jev';
import { createGame, type GameState } from '../src/physics';
import { snapshot } from '../src/agents';
export class TestGameRoom extends GameRoom {
  async fetch(req:Request):Promise<Response>{
    if(new URL(req.url).pathname.endsWith('/budget-exhausted')||new URL(req.url).pathname.endsWith('/won-checkpoint')){
      const saved=await this.ctx.storage.get<{real:boolean;calls:number;game:GameState}>('room');if(!saved)return new Response(null,{status:404});
      if(new URL(req.url).pathname.endsWith('/budget-exhausted')){saved.real=true;saved.calls=1200;}
      else{saved.game={...createGame(),tick:900,phase:'won',score:{left:7,right:5},pointId:12,lastScorer:'left',countdown:3};}await this.ctx.storage.put({room:saved,calls:saved.calls});await this.ctx.storage.sync();this.ctx.abort('Test cold start after persisting checkpoint');
    }
    if(new URL(req.url).pathname.endsWith('/reconstruct')){
      // Exercise the actual constructor's storage + hibernation attachment recovery.
      const fresh=new GameRoom(this.ctx,this.env);
      return fresh.fetch(new Request(req.url.replace('/reconstruct','/status'),req));
    }
    return super.fetch(req);
  }
}
export default {
  async fetch(req:Request,env:Env){
    const url=new URL(req.url);
    if(url.pathname==='/__test__/luna'){
      const scenario=url.searchParams.get('scenario')??'success';
      const brain=createLunaBrain(lunaConfig({OPENAI_API_KEY:'local-fixture-only'}),(input,init)=>{
        if(String(input)!=='https://api.openai.com/v1/decisions')throw new Error('Unexpected Luna endpoint');
        return fetch(`http://127.0.0.1:5191/${scenario}/v1/decisions`,init);
      });
      return Response.json(await brain(snapshot(createGame(),'right'),1));
    }
    if(url.pathname==='/__test__/sdk'){
      const scenario=url.searchParams.get('scenario')??'success';
      const brain=createBrain({mock:false,provider:'openrouter',apiKey:'local-fixture-only',baseURL:`http://127.0.0.1:5191/${scenario}`,model:'jev-1.13'});
      return Response.json(await brain(snapshot(createGame(),'left'),1));
    }
    if(url.pathname.endsWith('/reconstruct')||url.pathname.endsWith('/budget-exhausted')||url.pathname.endsWith('/won-checkpoint'))return env.ROOMS.get(env.ROOMS.idFromName(url.pathname.split('/')[3])).fetch(req);
    return app.fetch(req,env);
  }
};
