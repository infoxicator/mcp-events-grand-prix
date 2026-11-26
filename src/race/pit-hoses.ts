import * as T from 'three';

/** Four flexible air lines share one indexed mesh. End rings sit inside their couplers. */
export function pitHoses(){
 const steps=24,sides=8,rings=steps+1,count=4*rings*sides;
 const position=new T.Float32BufferAttribute(count*3,3).setUsage(T.DynamicDrawUsage);
 const normal=new T.Float32BufferAttribute(count*3,3).setUsage(T.DynamicDrawUsage);
 const indices:number[]=[];
 for(let hose=0;hose<4;hose++)for(let row=0;row<steps;row++)for(let j=0;j<sides;j++){
  const base=(hose*rings+row)*sides,a=base+j,b=base+(j+1)%sides;
  indices.push(a,b,a+sides,b,b+sides,a+sides);
 }
 const geometry=new T.BufferGeometry().setAttribute('position',position).setAttribute('normal',normal);
 geometry.setIndex(indices);
 const material=new T.MeshLambertMaterial({color:'#282a2b'});
 const mesh=new T.Mesh(geometry,material);mesh.name='Wheel gun air lines';mesh.frustumCulled=false;
 const curve=new T.CubicBezierCurve3(),centre=new T.Vector3(),axis=new T.Vector3(),u=new T.Vector3(),v=new T.Vector3();
 const angles=Array.from({length:sides},(_,j)=>[Math.cos(j*2*Math.PI/sides),Math.sin(j*2*Math.PI/sides)]);
 return {mesh,connect(index:number,outlet:T.Vector3,gun:T.Vector3,side:number){
  curve.v0.copy(outlet);curve.v1.copy(outlet);curve.v1.y-=1.22;
  curve.v2.copy(gun);curve.v2.x+=side*.53;curve.v2.y-=.34;curve.v2.z-=.14;curve.v3.copy(gun);
  for(let row=0;row<=steps;row++){
   const t=row/steps;curve.getPoint(t,centre);curve.getTangent(t,axis);
   u.set(axis.y,-axis.x,0).normalize();v.crossVectors(axis,u);
   for(let j=0;j<sides;j++){
    const [c,s]=angles[j],x=c*u.x+s*v.x,y=c*u.y+s*v.y,z=c*u.z+s*v.z;
    const at=(index*rings+row)*sides+j;
    position.setXYZ(at,centre.x+.016*x,centre.y+.016*y,centre.z+.016*z);normal.setXYZ(at,x,y,z);
   }
  }
  position.needsUpdate=true;normal.needsUpdate=true;
 },dispose(){geometry.dispose();material.dispose();}};
}
