import { DT } from '../src/physics';
/** Wall-time accumulator: Workers clocks advance on I/O, so batch 120 Hz substeps. */
export class FixedClock {
  private previous:number; private accumulator=0;
  droppedSeconds=0;
  constructor(now=Date.now()){this.previous=now;}
  advance(now:number,step:()=>void){
    const elapsed=Math.max(0,(now-this.previous)/1000);this.previous=now;
    this.droppedSeconds+=Math.max(0,elapsed-.25);this.accumulator+=Math.min(elapsed,.25);
    let count=0;
    while(this.accumulator+1e-10>=DT){step();this.accumulator-=DT;count++;}
    return count;
  }
}
