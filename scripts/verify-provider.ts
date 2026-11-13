/** Real SDK + real HTTP; stand-ins assert the documented System One wire contract. No paid calls. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createBrain, providerConfig } from '../server/jev';
import { createGame } from '../src/physics';
import { snapshot, mockBrain } from '../src/agents';
let scenario:'success'|'rate-limit'|'malformed'|'timeout'='success',requests=0,expectedModel='jev-1.13';
const fixture=createServer(async(req,res)=>{
  requests++;assert.equal(req.url,'/v1/systemone');assert.equal(req.method,'POST');assert.equal(req.headers.authorization,'Bearer local-fixture-only');assert.equal(req.headers['content-encoding'],undefined);
  let body='';for await(const chunk of req)body+=chunk;
  const request=JSON.parse(body);assert.equal(request.model,expectedModel);assert.equal(request.state.side,'left');assert.equal(request.questions.move.type,'choice');assert.equal(Object.keys(request.questions.target.criteria).length,17);
  if(scenario==='timeout'){await new Promise(resolve=>setTimeout(resolve,1900));if(res.destroyed)return;}
  res.setHeader('Content-Type','application/json');
  if(scenario==='rate-limit'){res.writeHead(429);res.end(JSON.stringify({error:{message:'Simulated rate limit'}}));return;}
  if(scenario==='malformed'){res.end(JSON.stringify({model:'jev-1.13',answers:{target:{type:'choice',choice:'lane_999',confidence:.9,probabilities:{lane_999:1}}},usage:{input_tokens:100,output_tokens:10}}));return;}
  const answer=(choice:string)=>({type:'choice',choice,confidence:.91,probabilities:{[choice]:1}});
  res.end(JSON.stringify({model:expectedModel,answers:{target:answer('lane_8'),move:answer('down'),taunt:answer('line_2')},usage:{input_tokens:100,output_tokens:10}}));
});
fixture.listen(0,'127.0.0.1');await once(fixture,'listening');
const address=fixture.address();assert(address&&typeof address!=='string');
const config={mock:false,provider:'openrouter' as const,apiKey:'local-fixture-only',baseURL:`http://127.0.0.1:${address.port}`,model:'jev-1.13'};
try{
  assert.equal(providerConfig({}).mock,true);assert.equal(providerConfig({JEV_MOCK:'1',OPENROUTER_API_KEY:'unused'}).mock,true);
  assert.equal(providerConfig({OPENROUTER_API_KEY:'fixture'}).baseURL,'https://openrouter.ai/api');
  assert.equal(providerConfig({AI_GATEWAY_API_KEY:'fixture'}).baseURL,'https://ai-gateway.vercel.sh/typesafe');
  const direct=providerConfig({TYPESAFE_API_KEY:'local-fixture-only'});
  assert.equal(direct.provider,'typesafe');assert.equal(direct.mock,false);assert.equal(direct.baseURL,'https://api.typesafe.ai');assert.equal(direct.model,'jev-latest');
  assert.equal(providerConfig({TYPESAFE_API_KEY:'fixture',OPENROUTER_API_KEY:'other',AI_GATEWAY_API_KEY:'other'}).provider,'typesafe');
  assert.equal(providerConfig({TYPESAFE_API_KEY:'fixture',JEV_MOCK:'1'}).mock,true);
  assert.equal(providerConfig({TYPESAFE_API_KEY:'fixture',JEV_MODEL:'jev-pinned'}).model,'jev-pinned');
  assert.equal(providerConfig({TYPESAFE_API_KEY:'fixture',OPENROUTER_API_KEY:'other',JEV_PROVIDER:'openrouter'}).apiKey,'other');
  assert.throws(()=>providerConfig({TYPESAFE_API_KEY:'fixture',JEV_PROVIDER:'vercel',JEV_MOCK:'0'}));
  assert.throws(()=>providerConfig({TYPESAFE_API_KEY:'fixture',JEV_PROVIDER:'mock',JEV_MOCK:'0'}));
  assert.throws(()=>providerConfig({JEV_MOCK:'0'}));
  const brain=createBrain(config),s=snapshot(createGame(),'left');
  let decision=await brain(s,1);assert.equal(decision.source,'jev');assert.equal(decision.action.target_y,280);assert.equal(decision.action.move,'down');assert.equal(decision.action.taunt,'Calculated. Obviously.');console.log('PASS: actual SDK serialized three typed questions over HTTP and decoded structured intent.');
  expectedModel=direct.model;
  const directBrain=createBrain(direct,async(input,init)=>{
    assert.equal(String(input),'https://api.typesafe.ai/v1/systemone');
    return fetch(`${config.baseURL}/v1/systemone`,init);
  });
  decision=await directBrain(s,3);assert.equal(decision.source,'jev');assert.equal(decision.action.target_y,280);
  console.log('PASS: direct TypeSafe SDK uses its own key, official System One URL, jev-latest and structured decisions over HTTP.');
  expectedModel=config.model;
  for(const failure of ['rate-limit','malformed','timeout'] as const){scenario=failure;const before=requests,start=performance.now();decision=await brain(s,2);assert.equal(decision.source,'fallback');assert.deepEqual(decision.action,mockBrain(s));assert.equal(requests-before,1);assert(performance.now()-start<1850);assert(decision.warning);console.log(`PASS: ${failure} → labeled heuristic fallback; one HTTP attempt; ${Math.round(performance.now()-start)} ms.`);}
  console.log('PASS: provider selection, automatic mock, and explicit real-key requirement. No external provider called.');
}finally{fixture.closeAllConnections();fixture.close();await once(fixture,'close');}
