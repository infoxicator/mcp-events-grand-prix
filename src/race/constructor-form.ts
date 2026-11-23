import * as T from 'three';

// Fair the exterior between hard points. Both ends of every envelope blend
// back into the original station; suspension, wings and cockpit rig stay put.
export function shapeBody(geometry:T.BufferGeometry,variant:number,flap=false){
 const pos=geometry.getAttribute('position');
 const sm=T.MathUtils.smoothstep,range=(x:number,a:number,b:number,fade:number)=>sm(x,a,a+fade)*(1-sm(x,b-fade,b));
 const point=new T.Vector3(),tangent=new T.Vector3(),bitangent=new T.Vector3(),normal=new T.Vector3(),original=new T.Vector3();
 function displaced(v:T.Vector3){
  const x=v.x,y=v.y+(flap?.87:0),z=v.z-(flap?2.42:0),side=Math.sign(x),width=Math.abs(x);
  // Retain the nose pylons and swan-neck roots. The spanwise rise, sweep
  // and incidence move the foils, painted marks and tip walls together.
  const outboard=sm(width,.19,.935);
  const front=sm(z,1.99,2.20)*(1-sm(y,.31,.39))*outboard;
  const tip=sm(width,.84,.959);
  const frontFlap=sm(y,.12,.25);
  if(front){
   if(variant>0){
    v.z+=front*(.057-.12*tip+.043*frontFlap);
    v.y+=front*(.061*Math.sin(Math.PI*outboard)-.015*tip);
   }else{
    v.z+=front*(-.13*outboard+.071*tip-.052*frontFlap);
    v.y+=front*(.016+.043*tip+.095*tip*frontFlap);
   }
  }
  const rear=sm(-z,2.095,2.22)*sm(y,.44,.61)*outboard;
  const lowerWall=1-sm(y,.52,.82);
  if(rear){
   const span=sm(width,.27,.78);
   v.y+=rear*(variant>0?.080*span+.062*lowerWall:-.040*span-.048*lowerWall);
   v.z+=rear*(variant>0?.13*lowerWall+.061*span:-.078*lowerWall-.043*span);
   // Keep the end fence planar so the bonded side markings share its face.
  }
  if(flap)return v;
  const tunnel=sm(-z,1.98,2.70)*(1-sm(y,.31,.39));
  if(tunnel){
   const shoulder=sm(width,.18,.40)*(1-sm(width,.61,.77));
   const centre=1-sm(width,.11,.29);
   v.y+=tunnel*sm(y,.074,.23)*(variant>0?.094*shoulder-.029*centre:.066*centre-.048*shoulder);
   v.x+=variant*side*.035*tunnel*sm(width,.20,.48);
  }
  const nose=range(z,.59,2.96,.44)*(1-sm(width,.33,.49))*sm(y,.17,.33);
  const pod=range(z,-1.93,.57,.46)*sm(width,.36,.75)*range(y,.17,.73,.12);
  const floor=range(z,-1.83,.87,.46)*sm(width,.53,.87)*(1-sm(y,.13,.21));
  const cowl=range(z,-2.18,-.75,.29)*sm(y,.54,.84)*(1-sm(width,.31,.46));
  const beak=sm(z,1.64,2.55)*(1-sm(width,.14,.33))*sm(y,.14,.22);
  v.x+=variant*(x*(.37*beak+.15*nose)+side*(.064*pod+.032*floor)+x*.17*cowl);
  v.y+=variant*(-.024*beak+.027*nose+.034*pod+.034*cowl);
  return v;
 }
 const normals=geometry.getAttribute('normal');
 for(let i=0;i<pos.count;i++){
  original.fromBufferAttribute(pos,i);
  if(normals){
   normal.fromBufferAttribute(normals,i);tangent.set(Math.abs(normal.y)>.8?1:0,Math.abs(normal.y)>.8?0:1,0).cross(normal).normalize();
   bitangent.crossVectors(normal,tangent);
   tangent.multiplyScalar(.001).add(original);bitangent.multiplyScalar(.001).add(original);displaced(tangent);displaced(bitangent);
  }
  displaced(point.copy(original));pos.setXYZ(i,point.x,point.y,point.z);
  if(normals){normal.crossVectors(tangent.sub(point),bitangent.sub(point)).normalize();normals.setXYZ(i,normal.x,normal.y,normal.z);}
 }
 geometry.computeBoundingBox();geometry.computeBoundingSphere();
}
