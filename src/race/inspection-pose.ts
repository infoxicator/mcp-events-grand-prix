import * as T from 'three';

type Layout = [triangles: number, runs: number[], splits: Record<number, number[][]>];
interface Pose {
 matrices: number[][];
 meshes: Record<string, [layout: number, palette: number[]]>;
}
export interface InspectionPoses { layouts: Layout[]; poses: Record<string, Pose> }

/** Apply Blender's inspection transforms to the same indexed mesh the car races with. */
export function posedGeometry(source:T.BufferGeometry, data:InspectionPoses, name:string, part:string, progress=1) {
 const pose=data.poses[name], binding=pose?.meshes[part];
 if(!binding)return source;
 const [layoutIndex,palette]=binding;
 const [count,runs,splits]=data.layouts[layoutIndex];
 const srcIndex=source.index;
 if(count*3!==(srcIndex?.count??source.getAttribute('position').count))throw new Error('Inspection triangle count changed for '+part);
 const transforms=palette.map(i=>{
  const m=pose.matrices[i];
  const transform=new T.Matrix4().set(m[0],m[1],m[2],m[3],m[4],m[5],m[6],m[7],m[8],m[9],m[10],m[11],0,0,0,1);
  if(progress!==1){
   const offset=new T.Vector3(),rotation=new T.Quaternion(),scale=new T.Vector3();
   transform.decompose(offset,rotation,scale);
   transform.compose(offset.multiplyScalar(progress),new T.Quaternion().slerp(rotation,progress),new T.Vector3(1,1,1).lerp(scale,progress));
  }
  return {transform,normal:new T.Matrix3().getNormalMatrix(transform)};
 });
 const attributes=Object.entries(source.attributes).map(([key,input])=>({key,input,values:[] as number[]}));
 const lookup=palette.map(()=>new Map<number,number>()),indices:number[]=[];
 const vector=new T.Vector3();
 let vertices=0;
 function vertex(group:number,ids:number[],weights:number[]){
  const {transform,normal}=transforms[group];
  for(const {key,input,values} of attributes){
   const offset=values.length;
   for(let k=0;k<input.itemSize;k++){
    let component=0;
    for(let j=0;j<ids.length;j++)component+=weights[j]*input.getComponent(ids[j],k);
    values.push(component);
   }
   if(key==='position'||key==='normal'){
    vector.fromArray(values,offset);
    if(key==='position')vector.applyMatrix4(transform);else vector.applyNormalMatrix(normal);
    vector.toArray(values,offset);
   }
  }
  return vertices++;
 }
 let run=0;
 for(let i=0;i<count;i++){
  if(run+2<runs.length&&i===runs[run+2])run+=2;
  const ids=[0,1,2].map(c=>srcIndex?srcIndex.getX(3*i+c):3*i+c);
  const fragments=splits[i];
  if(fragments){
   for(const [group,...weights] of fragments){
    for(let k=0;k<weights.length;k+=2){
     const b=weights[k]/65535,c=weights[k+1]/65535;
     indices.push(vertex(group,ids,[1-b-c,b,c]));
    }
   }
  }else{
   const group=runs[run+1],cache=lookup[group];
   for(const id of ids){
    let mapped=cache.get(id);
    if(mapped===undefined){mapped=vertex(group,[id],[1]);cache.set(id,mapped);}
    indices.push(mapped);
   }
  }
 }
 const output=new T.BufferGeometry();
 for(const {key,input,values} of attributes)output.setAttribute(key,new T.Float32BufferAttribute(values,input.itemSize));
 output.setIndex(indices);
 return output;
}
