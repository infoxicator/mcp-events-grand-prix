import sharp from 'sharp';

type View={buffer:number;byteOffset?:number;byteLength:number};
type TextureInfo={index:number;extensions?:Record<string,unknown>};
interface Circuit {
 materials:{name:string;pbrMetallicRoughness?:{baseColorTexture?:TextureInfo}}[];
 textures:{source:number}[];
 images:{bufferView:number;mimeType:string}[];
 bufferViews:View[];
 buffers:{byteLength:number}[];
 extensionsUsed?:string[];
 extensionsRequired?:string[];
}

// These two families occupy one UV tile per material. Keep the authored UVs
// and give each tile a gutter so anisotropic filtering stays inside its print.
export async function packCircuitAtlases(doc:Circuit,bin:Buffer){
 const replacements=new Map<number,Buffer>(),aliases=new Map<number,number>();
 for(const [pattern,width,height,columns] of [[/^Canopy\d$/,256,256,2],[/^Brake\d+$/,288,200,3]] as const){
  const prints=doc.materials.filter(m=>pattern.test(m.name)).map(m=>m.pbrMetallicRoughness!.baseColorTexture!);
  if(!prints.length)continue;
  const gutter=8,w=width+2*gutter,h=height+2*gutter;
  const atlasWidth=columns*w,atlasHeight=Math.ceil(prints.length/columns)*h;
  const texture=prints[0].index,source=doc.textures[texture].source,firstView=doc.images[source].bufferView;
  const tiles=await Promise.all(prints.map(async(info,i)=>{
   const image=doc.images[doc.textures[info.index].source],view=doc.bufferViews[image.bufferView];
   const start=view.byteOffset??0,left=(i%columns)*w,top=Math.floor(i/columns)*h;
   const input=await sharp(bin.subarray(start,start+view.byteLength)).resize(width,height,{fit:'fill'})
    .extend({top:gutter,bottom:gutter,left:gutter,right:gutter,extendWith:'copy'}).png().toBuffer();
   aliases.set(image.bufferView,firstView);
   info.index=texture;
   info.extensions={...info.extensions,KHR_texture_transform:{offset:[(left+gutter)/atlasWidth,(top+gutter)/atlasHeight],scale:[width/atlasWidth,height/atlasHeight]}};
   return {input,left,top};
  }));
  replacements.set(firstView,await sharp({create:{width:atlasWidth,height:atlasHeight,channels:4,background:'#00000000'}}).composite(tiles).png().toBuffer());
 }
 if(!replacements.size)return bin;
 for(const key of ['extensionsUsed','extensionsRequired'] as const){
  const extensions=doc[key]??=[];
  if(!extensions.includes('KHR_texture_transform'))extensions.push('KHR_texture_transform');
 }
 // The authored circuit uses only accessor and image buffer views. Preserve
 // every accessor index and slice. Aliased image views share the atlas bytes.
 const parts:Buffer[]=[],offsets:number[]=[],sizes:number[]=[];
 let offset=0;
 for(const [i,view] of doc.bufferViews.entries()){
  if(aliases.has(i)&&aliases.get(i)!==i)continue;
  const start=view.byteOffset??0,data=replacements.get(i)??bin.subarray(start,start+view.byteLength);
  offsets[i]=offset;sizes[i]=data.length;parts.push(data);offset+=data.length;
  const padding=(4-offset%4)%4;
  if(padding){parts.push(Buffer.alloc(padding));offset+=padding;}
 }
 for(const [i,view] of doc.bufferViews.entries()){
  const index=aliases.get(i)??i;view.byteOffset=offsets[index];view.byteLength=sizes[index];
 }
 for(const image of doc.images)if(aliases.has(image.bufferView))image.mimeType='image/png';
 doc.buffers[0].byteLength=offset;
 return Buffer.concat(parts,offset);
}
