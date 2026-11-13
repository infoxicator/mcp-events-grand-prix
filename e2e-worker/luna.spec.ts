import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';

test('Luna Decisions transport executes in workerd with real HTTP and labeled failures',async({request})=>{
  test.skip(!!process.env.LIVE_URL,'Local fixture endpoint is excluded from production');
  const calls:string[]=[];
  const fixture=createServer(async(req,res)=>{
    calls.push(req.url!);expect(req.method).toBe('POST');expect(req.headers.authorization).toBe('Bearer local-fixture-only');
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);
    expect(body.model).toBe('gpt-6-luna');expect(body.input[0].role).toBe('user');
    const evidence=body.input[0].content.find((part:{type:string})=>part.type==='input_json');expect(evidence.data.side).toBe('right');
    expect(body.questions).toHaveLength(3);expect(body.questions[0].type).toBe('choice');expect(body.questions[0].choices).toHaveLength(17);
    const scenario=req.url!.split('/')[1];
    if(scenario==='timeout'){await new Promise(r=>setTimeout(r,1900));if(res.destroyed)return;}
    res.setHeader('Content-Type','application/json');
    if(scenario==='rate-limit'){res.writeHead(429);res.end('{"error":{"message":"fixture rate limit"}}');return;}
    const answer=(name:string,choice:string)=>({type:'choice',name,choice,confidence:.91,probabilities:[{value:choice,probability:1}]});
    const answers=scenario==='refusal'?[{type:'refusal',name:'target'}]:[answer('target',scenario==='malformed'?'lane_999':'lane_8'),answer('move','down'),answer('taunt','line_2')];
    res.end(JSON.stringify({model:'gpt-6-luna',answers,usage:{input_tokens:100,output_tokens:0,total_tokens:100}}));
  });
  fixture.listen(5191,'127.0.0.1');await once(fixture,'listening');
  try{
    for(const scenario of ['success','rate-limit','malformed','refusal','timeout']){
      const response=await request.get(`/__test__/luna?scenario=${scenario}`);expect(response.ok()).toBe(true);const d=await response.json();
      expect(d.source).toBe(scenario==='success'?'luna':'fallback');expect(d.responseMs).toBeLessThan(1850);
      if(scenario==='success'){expect(d.action.target_y).toBe(280);expect(d.action.move).toBe('down');}else expect(d.warning).toContain('fallback');
      expect(calls.filter(path=>path===`/${scenario}/v1/decisions`)).toHaveLength(1);
      console.log(`workerd Luna ${scenario}: ${d.source}, ${d.responseMs} ms`);
    }
  }finally{fixture.closeAllConnections();fixture.close();await once(fixture,'close');}
});
