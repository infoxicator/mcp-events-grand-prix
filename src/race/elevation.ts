import monza from './assets/circuits/monza-manifest.json';
import vegas from './assets/circuits/las-vegas-manifest.json';
import type {CircuitId} from './track';
/** Terrain-scale visualization only; these DEM samples are not a road survey. */
export function circuitHeight(id:CircuitId,d:number){
 const p=id==='monza'?monza:vegas,h=p.heights,n=h.length,f=((d%p.length+p.length)%p.length)*n/p.length,i=Math.floor(f),t=f-i;
 const a=h[(i-1+n)%n],b=h[i],c=h[(i+1)%n],v=h[(i+2)%n];
 return .5*(2*b+(-a+c)*t+(2*a-5*b+4*c-v)*t*t+(-a+3*b-3*c+v)*t*t*t);
}
