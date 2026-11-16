import { type Race,type Team,type Instruction,type DriverIntent } from './types';
import {other} from './physics';
import {getTrack} from './track';
export function mockEngineer(s:Race,team:Team):Instruction{
 const c=s.cars[team],rival=s.cars[other(team)],gap=(rival.distance-c.distance)/Math.max(30,c.speed);
 if(c.pit!=='none')return {...c.instruction,line:c.pit==='stopped'?'Hold. New tyres going on.':'Limiter on. We need a clean exit.'};
 const track=getTrack(s.circuit),isDrsZone=track.isDrsZone;
 const box=c.stops===0&&(team==='a'?c.distance>track.LENGTH*.725:c.distance>track.LENGTH*1.69||c.wear>.8);
 if(box)return {pace:'push',ers:'harvest',box:true,tyre:team==='a'?'hard':'soft',tactic:'hold',line:team==='a'?'Box, box. Hard tyres. We are going for the undercut.':'Box this lap. Soft tyres. Attack to the flag.'};
 if(c.stops>0&&c.tyreAge<.6)return {pace:'push',ers:'deploy',box:false,tyre:c.compound,tactic:'attack',line:'Pit exit clear. Push now. This is the undercut lap.'};
 if(c.wear>.62)return {pace:'manage',ers:'harvest',box:false,tyre:c.compound,tactic:'hold',line:'Tyres are dropping. Manage the rears. Harvest on entry.'};
 if(gap>0&&gap<1.4)return {pace:'push',ers:'deploy',box:false,tyre:c.compound,tactic:'attack',line:isDrsZone(c.distance)?'DRS zone. Use it if the dash is green. Attack.':'Within one second. Charge the battery. Set up the pass.'};
 if(gap<0&&gap>-1)return {pace:team==='b'?'push':'balanced',ers:'balanced',box:false,tyre:c.compound,tactic:'defend',line:'Car behind is close. Cover the inside. Keep it clean.'};
 return {pace:team==='b'?'push':'balanced',ers:c.ers<30?'harvest':'balanced',box:false,tyre:c.compound,tactic:'hold',line:team==='a'?'Good rhythm. Hit the apexes. Let the strategy come to us.':'You have clear air. Keep the pressure on.'};
}
export function mockDriver(s:Race,team:Team):DriverIntent{
 const c=s.cars[team],rival=s.cars[other(team)],instruction=c.instruction,gap=rival.distance-c.distance,attack=instruction.tactic==='attack'||gap>0&&gap<70,defend=instruction.tactic==='defend';
 const side=attack?(rival.offset>=0?'left':'right'):defend?'right':'hold';
 return {offset:side==='left'?-3:side==='right'?3:team==='a'?-.6:.6,speedBias:instruction.pace==='manage'?-2:team==='b'?1.6:.3,brakeAggression:instruction.pace==='manage'?.2:team==='a'?.58:.9,side,ers:instruction.ers==='deploy'&&c.ers>8,drs:true,reply:instruction.box?(team==='a'?'Copy. Box this lap. Let’s make it count.':'Box? Fine. Give me the softs.'):(team==='a'?'Understood. Smooth inputs. On the delta.':attack?'Leave it to me. I’m sending it.':'There’s more in this car. Let me push.')};
}
