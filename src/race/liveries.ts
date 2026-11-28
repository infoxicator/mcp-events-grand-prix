import * as T from 'three';
import {grid,type GridEntry} from './grid';

// The official season side profiles share an axle datum. Artwork is laid out in
// chassis metres so fairings and decals use the same registration on either LOD.
const tileW=640,tileH=152,length=5.82,height=1.16;
const dark='#171a22',white='#f2f3f2';
type Profile={base:string;side:string;ink:string;cover:string;wing:string};
const profiles:Record<GridEntry['team'],Profile>={
 Ferrari:{base:'#da192b',side:'CEVA',ink:white,cover:'hp',wing:'V-Power'},
 Mercedes:{base:'#8a979e',side:'PETRONAS',ink:white,cover:'TeamViewer',wing:'Snapdragon'},
 McLaren:{base:'#ff880d',side:'OKX',ink:white,cover:'Gemini',wing:'Dropbox'},
 'Red Bull Racing':{base:'#193d9a',side:'ORACLE',ink:white,cover:'Red Bull',wing:'Mobil 1'},
 'Racing Bulls':{base:white,side:'VISA',ink:'#163983',cover:'Red Bull',wing:'VISA'},
 Alpine:{base:'#198bd1',side:'BWT',ink:'#ff9fc8',cover:'eni',wing:'eni'},
 Haas:{base:'#f1f2f1',side:'HAAS',ink:'#18191d',cover:'GR',wing:'TOYOTA'},
 Audi:{base:'#c2c1bd',side:'Revolut',ink:'#15171b',cover:'Audi',wing:'Audi'},
 Williams:{base:'#2343b3',side:'BARCLAYS',ink:white,cover:'ATLASSIAN',wing:'KOMATSU'},
 'Aston Martin':{base:'#00715d',side:'aramco',ink:white,cover:'Ma’aden',wing:'coinbase'},
 Cadillac:{base:'#292a2d',side:'TWG ◇',ink:white,cover:'CADILLAC',wing:'IFS'}
};
// Reuse the immutable artwork across WebGL contexts. Each scene owns its GPU texture.
let gridArt:HTMLCanvasElement|undefined,mercedesArt:HTMLCanvasElement|undefined;
export function liveryAtlas(entries:readonly GridEntry[]=grid,resolution=1){
 const cacheable=entries===grid&&resolution===1;
 const hero=resolution===1.5&&entries.length===1&&entries[0]===grid.find(e=>e.seat==='b');
 const canvas=(cacheable?gridArt:hero?mercedesArt:undefined)??drawAtlas(entries,resolution);
 if(cacheable)gridArt=canvas;
 if(hero)mercedesArt=canvas;
 const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;map.anisotropy=import.meta.env.MCP_APP==='true'?4:8;map.userData.rows=entries.length;return map;
}
function drawAtlas(entries:readonly GridEntry[],resolution:number){
 const canvas=document.createElement('canvas');canvas.width=tileW*4*resolution;canvas.height=tileH*entries.length*resolution;
 const c=canvas.getContext('2d')!;
 c.scale(resolution,resolution);
 entries.forEach((entry,row)=>{
  for(let tile=0;tile<4;tile++){
   const reverse=tile%2===1,printed=tile>=2,p=profiles[entry.team];
   c.save();c.beginPath();c.rect(tile*tileW,row*tileH,tileW,tileH);c.clip();
   c.translate(tile*tileW+2.85*tileW/length,(row+1)*tileH);
   c.scale(tileW/length,-tileH/height);
   function patch(fill:string,...coords:number[]){
    c.fillStyle=fill;c.beginPath();c.moveTo(coords[0],coords[1]);
    for(let i=2;i<coords.length;i+=2)c.lineTo(coords[i],coords[i+1]);c.closePath();c.fill();
    if(fill===dark){c.save();c.globalCompositeOperation='destination-out';c.globalAlpha=.64;c.fill();c.restore();}
   }
   function disc(x:number,y:number,r:number,fill:string){c.fillStyle=fill;c.beginPath();c.arc(x,y,r,0,2*Math.PI);c.fill();}
   function word(s:string,x:number,y:number,w:number,h:number,fill:string,italic=false){
    if(!printed)return;
    c.save();c.translate(x,y);c.font=(italic?'italic ':'')+'bold 100px Arial, sans-serif';c.textAlign='center';
    c.scale((reverse?-1:1)*w/c.measureText(s).width,-h/73);c.fillStyle=fill;c.fillText(s,0,0);c.restore();
   }
   c.fillStyle=p.base;c.fillRect(-3,-.1,6.1,1.5);
   patch(dark,-3,0,3,0,3,.10,.5,.16,-.36,.23,-1.5,.25,-2.8,.18);
   let numberInk=white;
   switch(entry.team){
    case 'Ferrari':
     patch(white,-1.9,1.3,-.39,1.3,-.47,.78,-.94,.73,-1.23,.75,-1.45,.86);
     if(printed){disc(-1.01,.926,.134,'#1664ba');word('hp',-1.01,.857,.202,.117,white,true);c.save();c.translate(.015,.461);c.scale(.086,.089);
      c.fillStyle='#be2326';c.beginPath();c.arc(0,0,1,Math.PI,0,true);c.lineTo(.8,-.60);c.lineTo(.34,-.60);c.lineTo(.28,-.73);c.lineTo(-.31,-.73);c.lineTo(-.36,-.60);c.lineTo(-.81,-.60);c.closePath();c.fill();
      for(let n=0;n<7;n++){const a=.08+n*.442;c.fillStyle='#f3c833';c.beginPath();c.moveTo(0,-.49);c.arc(0,0,.91,a,a+.40);c.closePath();c.fill();}c.restore();}
     break;
    case 'Mercedes':
     patch(dark,-3,0,.49,0,.54,.52,-.20,.66,-.65,.82,-.9,1.25,-3,1.25);
     patch('#00cdb4',-2.1,.286,-1.36,.37,-.78,.45,-.14,.62,.45,.66,.46,.70,-.21,.66,-.88,.49,-1.45,.39);
     patch('#00cdb4',.63,.51,2.62,.23,2.60,.25,.64,.56);
     if(printed)for(let k=0;k<5;k++)for(let j=0;j<3;j++){
      const z=-1.87+k*.103+j*.045,y=.75+j*.071;
      for(let n=0;n<3;n++){const a=n*Math.PI*2/3;patch('#7e878c',z,y,z+.023*Math.sin(a),y+.023*Math.cos(a),z+.004,y+.002);}
     }
     break;
    case 'McLaren':
     patch(dark,-1.91,1.21,-.56,1.21,-.64,.85,-.84,.64,-1.40,.58);
     patch('#242429',-2.1,.26,-1.65,.57,-.80,.57,-.27,.36,.51,.48,.18,.22);
     break;
    case 'Red Bull Racing':case 'Racing Bulls':{
     const rb=entry.team==='Racing Bulls';
     patch(rb?'#254db1':'#102451',-2.8,0,1.45,0,1.15,.37,.52,.51,-.05,.30,-1.09,.31,-1.63,.70,-2.8,.62);
     patch(rb?'#4381cb':'#2d54a2',-2.2,.32,-1.30,.36,-.02,.58,.5,.64,-1.2,.44);
     if(printed){
      disc(-.75,.982,.17,'#f4cb24');
      // Running bull on the engine cover, with the long tail towards the rear axle.
      c.save();c.translate(-1.83,.80);c.scale(1.16,.32);c.fillStyle='#e92739';c.strokeStyle='#f4eee1';c.lineWidth=.029;
      c.beginPath();c.moveTo(0,.02);c.bezierCurveTo(.10,.23,.24,.09,.36,.45);c.bezierCurveTo(.44,.70,.53,.62,.58,.72);
      c.lineTo(.76,.89);c.lineTo(.84,.78);c.lineTo(.90,.83);c.lineTo(.97,.48);c.lineTo(1.01,.25);c.lineTo(.97,.30);
      c.lineTo(.92,.44);c.lineTo(.88,.33);c.lineTo(.9,.14);c.lineTo(.84,.19);c.lineTo(.82,.42);c.lineTo(.71,.39);
      c.lineTo(.70,.16);c.lineTo(.62,.12);c.lineTo(.57,.30);c.lineTo(.65,.27);c.lineTo(.66,.43);
      c.lineTo(.49,.42);c.lineTo(.42,.55);c.quadraticCurveTo(.33,.22,.20,.19);c.lineTo(.04,-.04);c.closePath();c.fill();c.stroke();c.restore();
     }
     break;
    }
    case 'Alpine':
     patch('#ef97bc',-2.0,.88,-1.54,.91,-.82,.64,-1.34,.62);
     patch('#303142',-2.2,.61,-1.61,.59,-.93,.66,-1.48,.53,-2.2,.46);
     patch('#e695bc',.83,.54,2.76,.24,2.76,.31,.88,.60);
     break;
    case 'Haas':
     patch('#d8232c',-1.94,.66,-1.35,.72,.32,.70,1.33,.51,2.67,.28,2.72,.31,1.22,.58,.24,.73,-1.18,.77);
     patch('#17181c',-2.3,.33,-1.84,.65,-1.48,.58,-1.62,.45,-1.18,.24,-.25,.22,.28,.36,.18,.21,-2.0,.16);
     numberInk=dark;break;
    case 'Audi':
     patch('#fa382b',-2.22,.19,-.70,.2,-.70,1.25,-2.23,1.25);
     patch(dark,-2.26,.48,-1.94,.65,-1.43,.80,-.7,.86,-.7,1.25,-2.3,1.25);
     break;
    case 'Williams':
     patch('#40acdd',-1.90,.39,-1.05,.51,.35,.58,.45,.44,-.69,.30,-1.60,.28);
     patch('#17254f',-1.91,.25,-1.18,.33,-.16,.43,.25,.46,.13,.27,-1.15,.19);
     break;
    case 'Aston Martin':
     patch(dark,-2.25,.24,-1.40,.39,-.05,.46,.32,.46,-.02,.26,-1.4,.19);
     patch('#b2cd38',-2.15,.22,-1.30,.285,-.12,.34,.33,.44,-.23,.335,-1.30,.265);break;
    case 'Cadillac':
     c.fillStyle=reverse?'#e7e6e1':'#24262b';c.fillRect(-3,.15,6.1,1.2);
     patch(reverse?'#aaa9a7':'#48474a',-2.21,.27,-1.38,.53,-.33,.63,.24,.67,-.01,.61,-1.45,.42);
     if(reverse)numberInk=dark;break;
   }
   const wingColour=entry.team==='McLaren'?'#ec7b12':entry.team==='Alpine'?'#e89dbb':
    entry.team==='Red Bull Racing'?'#172958':entry.team==='Williams'?'#203f8c':'#25272d';
   patch(wingColour,-2.88,.68,-2.16,.68,-2.16,1.18,-2.88,1.18);
   if(printed){
    const sideInk=entry.team==='Cadillac'&&reverse?dark:p.ink;
    if(entry.team==='Ferrari')word('CEVA',-.68,.409,.65,.082,sideInk);
    else if(entry.team==='Williams'){
     word('KOMATSU',-.91,.37,.72,.092,'#dcf1ff');word('BARCLAYS',-.18,.49,.52,.064,white);
    }else word(p.side,-.66,.395,entry.team==='McLaren'?.85:1.14,entry.team==='Mercedes'?.105:.124,sideInk,['Haas','Racing Bulls'].includes(entry.team));
    if(entry.team==='Mercedes')word(p.cover,-1.13,.847,.53,.079,white);
    else if(entry.team!=='Ferrari')word(p.cover,-.94,entry.team==='McLaren'||entry.team==='Williams'?.83:.697,.69,.083,entry.team==='Racing Bulls'?'#d51c31':entry.team==='Haas'?dark:sideInk);
    word(String(entry.number),-1.76,.81,.205,.122,numberInk,true);
    word(p.wing,-2.406,.809,.315,.056,entry.team==='Alpine'||entry.team==='McLaren'?dark:white);
   }
   if(tile===3){
    // Upper rear flap, unwrapped once across the span, shared by both field LODs.
    c.fillStyle=wingColour;c.fillRect(.58,.81,1.24,.335);
    // Colour returns on the flap tips remain exposed when the engine cover is screened.
    const ends:Record<GridEntry['team'],string>={Alpine:'#efabc4','Aston Martin':'#b4c638',Audi:'#e54433',Cadillac:'#c8cac7',Ferrari:'#bc1c29',Haas:'#ad2532',McLaren:'#f28d35',Mercedes:'#08aca0','Racing Bulls':'#e9ebeb','Red Bull Racing':'#bd293c',Williams:'#479ad0'};
    for(const x of [.60,1.80]){
     const dir=x<1?1:-1;
     patch(ends[entry.team],x,.81,x+dir*.18,.81,x+dir*.11,1.145,x,1.145);
    }
    c.save();c.translate(1.20,.905);c.scale(-1,1);
    word(p.wing,0,0, .95,.167,['Alpine','McLaren'].includes(entry.team)?dark:white);
    c.restore();
    // Above the nose on this tile is the outer front-wing face, viewed broadside.
    const plate=entry.team==='Alpine'?'#f0a6c8':entry.team==='McLaren'?'#ff8d20':entry.team==='Racing Bulls'?white:'#25282b';
    const branding:Record<GridEntry['team'],string>={Ferrari:'UniCredit',Mercedes:'IWC',McLaren:'Workday','Red Bull Racing':'Mobil 1','Racing Bulls':'Cash App',Alpine:'BWT',Haas:'TOYOTA',Audi:'QATAR',Williams:'betway','Aston Martin':'aramco',Cadillac:'IFS'};
    c.fillStyle=plate;c.fillRect(1.90,.722,1,.434);
    c.save();c.translate(2.43,.895);c.scale(-1,1);
    word(branding[entry.team],0,0,entry.team==='Mercedes'?.30:.46,entry.team==='Mercedes'?.122:.098,['McLaren','Alpine','Racing Bulls'].includes(entry.team)?dark:white);
    c.restore();
   }
   if(tile===2){
    // The nose is viewed head-on. Reserve the unoccupied area above the long
    // nose in this side elevation for a separate, correctly oriented top print.
    const noseInk=['Mercedes','Haas','Audi','Racing Bulls'].includes(entry.team)?'#1c2429':white;
    c.save();c.beginPath();c.rect(.72,.76,2.15,.385);c.clip();
    c.fillStyle=p.base;c.fillRect(.72,.76,2.15,.385);
    if(entry.team==='Mercedes'){
     patch('#21292e',2.82,.76,2.87,.76,2.87,1.146,2.82,1.146,2.77,.956);
     for(const sign of [-1,1])patch('#00b5a3',.73,.953+sign*.179,2.69,.953+sign*.062,2.35,.953+sign*.059,.73,.953+sign*.163);
    }
    function noseWord(s:string,z:number,width:number,size:number,colour:string){
     c.save();c.translate(z,.953);c.rotate(Math.PI/2);word(s,0,-size*.38,width,size,colour);c.restore();
    }
    const badge=entry.team==='Ferrari'?'hp':entry.team==='Mercedes'?'AMG':entry.team==='Red Bull Racing'?'ORACLE':entry.team==='McLaren'?'DELL':entry.team;
    noseWord(String(entry.number),1.43,.144,.235,noseInk);
    noseWord(badge,2.06,.124,.089,noseInk);
    if(entry.team==='Mercedes'){
     const z=2.49,y=.953,r=.037;
     c.strokeStyle=noseInk;c.lineWidth=.005;c.beginPath();c.arc(z,y,r,0,Math.PI*2);c.stroke();
     for(let n=0;n<3;n++){const a=n*2*Math.PI/3;c.beginPath();c.moveTo(z,y);c.lineTo(z+r*Math.cos(a),y+r*Math.sin(a));c.stroke();}
    }
    c.restore();
   }
   c.restore();
  }
 });
 return canvas;
}

// Use the body-space rest coordinate. A bent panel carries its printed artwork with it.
export function applyLivery(material:T.MeshStandardMaterial,atlas:T.Texture,instanced:boolean,row=0,endplate=false,fieldFlap=false){
 const rows=atlas.userData.rows??grid.length,shaderRow=rows===1?0:row;
 const ferrariPlate=!instanced&&grid[row]?.team==='Ferrari';
 const existing=material.onBeforeCompile,oldKey=material.customProgramCacheKey();
 material.onBeforeCompile=(shader,renderer)=>{
  existing.call(material,shader,renderer);
  shader.uniforms.liverySheet={value:atlas};
  shader.vertexShader=(instanced?'attribute float liveryRow;':'attribute vec3 liveryPoint;')+'\nvarying float wrapRow; varying vec3 wrapPoint; varying vec3 wrapTint;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
    wrapTint=vec3(1.);
    #if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
     wrapTint=color.rgb;
    #endif
    wrapPoint=${instanced?'position':'liveryPoint'};wrapRow=${instanced?'liveryRow':shaderRow.toFixed(1)};`);
  if(fieldFlap){
   shader.vertexShader='varying vec2 flapUV;\n'+shader.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>
    flapUV=uv;
    // The rear-facing print uses -X as screen right. Reverse the span on the
    // forward-facing presentation of the flap, keeping the flap UV sentinel.
    mat4 flapFrame=modelViewMatrix*instanceMatrix;
    if(uv.x>=0. && dot(flapFrame[2].xyz,-flapFrame[3].xyz)>0.)flapUV.x=1.-uv.x;`);
   shader.fragmentShader='varying vec2 flapUV;\n'+shader.fragmentShader;
  }
  shader.fragmentShader='uniform sampler2D liverySheet; varying float wrapRow; varying vec3 wrapPoint; varying vec3 wrapTint;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   ${endplate?`if((wrapPoint.z < -2.16 && wrapPoint.y > .68 && abs(wrapPoint.x) > .62) ||
                   (wrapPoint.z > 2.025 && wrapPoint.z < 2.82 && wrapPoint.y < .39 && abs(wrapPoint.x) > .90)){`:''}
   vec2 uvPaint=clamp(vec2((wrapPoint.z+2.85)/5.82,wrapPoint.y/1.16),vec2(.002),vec2(.998));
   float column=step(0.,wrapPoint.x);
   vec2 tc=vec2((column+uvPaint.x)*.25,(${(rows-1).toFixed(1)}-wrapRow+uvPaint.y)/${rows.toFixed(1)});
   vec4 bodyPrint=texture2D(liverySheet,tc);
   float lacquer=bodyPrint.a;
   vec3 baseInk=bodyPrint.rgb;
   vec3 face=normalize(cross(dFdx(wrapPoint),dFdy(wrapPoint)));
   // The outward panel sets the reading direction on curved shoulders and thin fins.
   float printSide=step(0.,face.x);
   vec2 printedUV=vec2((2.+printSide+uvPaint.x)*.25,tc.y);
   vec3 printInk=texture2D(liverySheet,printedUV).rgb;
   vec3 finishInk=mix(baseInk,printInk,smoothstep(.33,.70,abs(face.x)));
   if(abs(wrapPoint.x)>.90 && wrapPoint.z>2.025 && wrapPoint.z<2.82 && wrapPoint.y<.39){
    float frontZ=wrapPoint.x<0.?wrapPoint.z:4.86-wrapPoint.z;
    // Follow the sloping endplate between its flap joints; the printable
    // land gets lower towards the rounded leading edge.
    float centre=.235-.075*smoothstep(2.22,2.66,wrapPoint.z);
    frontZ=clamp(${ferrariPlate?'2.43+(frontZ-2.43)*1.42':'frontZ'},1.92,2.88);
    float printHeight=clamp(${ferrariPlate?'.945+(wrapPoint.y-centre)*2.55':'.736+(wrapPoint.y-.105)*1.64'},.75,1.12);
    vec2 frontUV=vec2((3.+(frontZ+2.85)/5.82)*.25,(${(rows-1).toFixed(1)}-wrapRow+printHeight/1.16)/${rows.toFixed(1)});
    finishInk=texture2D(liverySheet,frontUV).rgb;
   }
   ${endplate?`float blade=step(.62,abs(wrapPoint.x))*step(wrapPoint.z,-2.16)*step(.68,wrapPoint.y)*smoothstep(.72,.94,abs(face.x));
   blade=max(blade,${ferrariPlate?'smoothstep(.956,.965,abs(wrapPoint.x))':'step(.90,abs(wrapPoint.x))'}*step(2.025,wrapPoint.z)*step(wrapPoint.z,2.82)
     *step(wrapPoint.y,.39)*${ferrariPlate?'smoothstep(.79,.95,abs(face.x))':'smoothstep(.55,.85,abs(face.x))'});
   diffuseColor.rgb=mix(diffuseColor.rgb,finishInk,blade);}`:`{
    vec2 topUV=vec2((2.+uvPaint.x)*.25,(${(rows-1).toFixed(1)}-wrapRow+(.953+wrapPoint.x*.54)/1.16)/${rows.toFixed(1)});
    // Keep implicit mip derivatives defined across the entire nose.
    // Sampling inside a varying branch gave a one-pixel broken line at z=.73.
    float noseMask=smoothstep(.73,.83,wrapPoint.z)*(1.-smoothstep(2.81,2.86,wrapPoint.z))
                 *smoothstep(.20,.24,wrapPoint.y)*(1.-smoothstep(.31,.35,abs(wrapPoint.x)));
    finishInk=mix(finishInk,texture2D(liverySheet,topUV).rgb,noseMask*smoothstep(.54,.85,abs(face.y)));
   }
   ${fieldFlap?`if(flapUV.x>=0.){
    // Exported flap UVs follow the aft observer on both skins.
    vec2 ink=vec2(.60+1.20*flapUV.x,.825+.30*flapUV.y);
    finishInk=texture2D(liverySheet,vec2((3.+(ink.x+2.85)/5.82)*.25,(${(rows-1).toFixed(1)}-wrapRow+ink.y/1.16)/${rows.toFixed(1)})).rgb;
   }`:''}
   diffuseColor.rgb=finishInk;
   #if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
    diffuseColor.rgb*=wrapTint;
   #endif`}
  `);
  if(!endplate)shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(.57,roughnessFactor,lacquer);');
 };
 material.customProgramCacheKey=()=>oldKey+'-side-paint-'+rows+'-'+(instanced?'grid':row)+(endplate?'wing':fieldFlap?'flap':'body');
}
