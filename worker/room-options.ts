import { isMatchup, type Matchup } from '../src/match';
export { isMatchup };
export type HostedMatchup=Matchup;
/** Bound creation input before decoding; credentials are never accepted in room JSON. */
export async function roomOptions(req:Request):Promise<{matchup:HostedMatchup}|Response>{
  let raw='',bytes=0;const reader=req.body?.getReader(),decoder=new TextDecoder();
  if(reader){
    while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;
      if(bytes>1024){await reader.cancel();return Response.json({error:'Room options too large'},{status:413});}
      raw+=decoder.decode(chunk.value,{stream:true});
    }
    raw+=decoder.decode();
  }
  try{const value=raw?JSON.parse(raw):{};const matchup=value.matchup??'jev-vs-jev';
    if(!isMatchup(matchup))return Response.json({error:'Unknown matchup'},{status:400});return {matchup};
  }catch{return Response.json({error:'Invalid room options'},{status:400});}
}
