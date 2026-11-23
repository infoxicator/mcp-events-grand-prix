import * as T from 'three';

/** Rebuild the panel grid split into triangles by glTF. A shared diagonal
 * must be the longest side of both triangles, with nearly parallel normals. */
export function inspectionWire(geometry:T.BufferGeometry,showDiagonals=false,divisions=1){
 const position=geometry.getAttribute('position'),index=geometry.index;
 const count=index?.count??position.count;
 const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),normal=new T.Vector3();
 const points:number[]=[],ids=new Map<string,number>();
 const vertexIds=Array.from({length:position.count},(_,i)=>{
  a.fromBufferAttribute(position,i);
  const key=[a.x,a.y,a.z].map(v=>Math.round(v*1e6)).join(',');
  let id=ids.get(key);
  if(id===undefined){id=points.length/3;ids.set(key,id);points.push(a.x,a.y,a.z);}
  return id;
 });
 const segments:number[]=[];
 const edges=new Map<number,{u:number;v:number;candidate:boolean;normal:T.Vector3;hidden:boolean;faces:number}>();
 for(let i=0;i<count;i+=3){
  const vertices=[0,1,2].map(j=>vertexIds[index?index.getX(i+j):i+j]);
  a.fromArray(points,vertices[0]*3);b.fromArray(points,vertices[1]*3);c.fromArray(points,vertices[2]*3);
  // Each row joins corresponding points on the two incident edges.
  // Repeating at all three corners tessellates the triangle without UV seams.
  if(divisions>1){
   for(let corner=0;corner<3;corner++){
    const origin=3*vertices[corner];
    for(let row=1;row<divisions;row++){
     const t=row/divisions;
     for(const other of [vertices[(corner+1)%3],vertices[(corner+2)%3]]){
      for(let axis=0;axis<3;axis++)segments.push(points[origin+axis]*(1-t)+points[3*other+axis]*t);
     }
    }
   }
  }
  const lengths=[a.distanceToSquared(b),b.distanceToSquared(c),c.distanceToSquared(a)];
  const diagonal=lengths.indexOf(Math.max(...lengths));
  normal.crossVectors(b.sub(a),c.sub(a)).normalize();
  for(let j=0;j<3;j++){
   const u=Math.min(vertices[j],vertices[(j+1)%3]),v=Math.max(vertices[j],vertices[(j+1)%3]);
   const key=u*ids.size+v,existing=edges.get(key);
   if(existing){
    existing.faces++;
    existing.hidden=existing.faces===2&&existing.candidate&&j===diagonal&&existing.normal.dot(normal)>.95;
   }else edges.set(key,{u,v,candidate:j===diagonal,normal:normal.clone(),hidden:false,faces:1});
  }
 }
 for(const edge of edges.values()){
  if(edge.hidden&&!showDiagonals)continue;
  for(const id of [edge.u,edge.v])segments.push(points[3*id],points[3*id+1],points[3*id+2]);
 }
 return new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(segments,3));
}

export interface InspectionShell {points:number[][];faces:number[][]}

export function shellGeometry(shell:InspectionShell){
 const positions=new T.Float32BufferAttribute(shell.points.flat().map(v=>v/10000),3);
 // Frame 007 has a darker laminate between the edges ahead of the nose joint.
 const colors=new T.Float32BufferAttribute(shell.points.flatMap(([, ,z])=>{
  const shade=z>6200?.50:1;
  return [shade,shade,shade];
 }),3);
 const faces:number[]=[],edges:number[]=[];
 const seen=new Set<number>(),stride=shell.points.length;
 for(const face of shell.faces){
  const [a,b,c,d]=face;
  faces.push(a,b,c);
  if(face.length===4){
   faces.push(a,c,d);
   edges.push(a,c);
  }
  for(let i=0;i<face.length;i++){
   const u=face[i],v=face[(i+1)%face.length];
   const key=Math.min(u,v)*stride+Math.max(u,v);
   if(!seen.has(key)){seen.add(key);edges.push(u,v);}
  }
 }
 const surface=new T.BufferGeometry().setAttribute('position',positions).setAttribute('color',colors).setIndex(faces);
 surface.computeVertexNormals();
 const grid=new T.BufferGeometry().setAttribute('position',positions).setAttribute('color',colors).setIndex(edges);
 return {surface,grid};
}
