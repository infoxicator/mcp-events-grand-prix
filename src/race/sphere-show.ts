import * as T from 'three';
import type {RenderRace} from './scene';
import type {Track} from './track';

const homeBearing=Math.atan2(190,200); // Boulevard side, visible from the Sphere camera.
const wrap=(angle:number)=>Math.atan2(Math.sin(angle),Math.cos(angle));

function logoTexture(){
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;
 const c=canvas.getContext('2d')!;
 // The three staggered bars are the mark on the pit-wall header.
 c.fillStyle='#ee3448';c.beginPath();c.roundRect(20,44,170,156,26);c.fill();
 c.save();c.transform(1,0,-.32,1,0,0);c.fillStyle='#15161b';
 for(let row=0;row<3;row++)c.fillRect(104-row*9,81+row*32,84,16);
 c.restore();
 c.font='italic 900 182px Arial, sans-serif';c.textBaseline='middle';
 c.fillStyle='#fff9ed';c.fillText('MCP',218,139,423);
 c.fillStyle='#ff4658';c.fillText('GP',660,139,340);
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
 return texture;
}

function browLettering(){
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=96;
 const c=canvas.getContext('2d')!;
 c.fillStyle='#121528';c.font='900 78px Arial, sans-serif';
 c.textAlign='center';c.textBaseline='middle';c.fillText('LAS VEGAS GRAND PRIX',512,51,992);
 return new T.CanvasTexture(canvas);
}

export function createSphereShow(centre:T.Vector3){
 const uniforms={...T.UniformsUtils.clone(T.UniformsLib.fog),displayCentre:{value:centre},clock:{value:0},bearing:{value:homeBearing},
  gaze:{value:new T.Vector2()},wink:{value:0},faceMix:{value:0},flagMix:{value:0},helmetMix:{value:0},browText:{value:browLettering()},wordmark:{value:logoTexture()}};
 const material=new T.ShaderMaterial({uniforms,fog:true,side:T.FrontSide,
  vertexShader:`
   #include <fog_pars_vertex>
   uniform vec3 displayCentre;
   varying vec3 radial;
   void main(){
    vec4 world=modelMatrix*vec4(position,1.);
    radial=world.xyz-displayCentre;
    vec4 mvPosition=viewMatrix*world;
    gl_Position=projectionMatrix*mvPosition;
    #include <fog_vertex>
   }`,
  fragmentShader:`
   #include <fog_pars_fragment>
   uniform float clock,bearing,wink,faceMix,flagMix,helmetMix;
   uniform vec2 gaze;
   uniform sampler2D wordmark,browText;
   varying vec3 radial;
   const float PI=3.14159265;
   float angle(float a){return atan(sin(a),cos(a));}
   float ellipse(vec2 p,vec2 radius){
    float r=length(p/radius),w=max(fwidth(r),.009);
    return 1.-smoothstep(1.-w,1.+w,r);
   }
   float band(float x,float width){return 1.-smoothstep(width,width+max(fwidth(x),.004),abs(x));}
   // Longitude wraps at atan's branch cut and at each repeated wordmark.
   // Measure the short angular step so mip selection stays continuous there.
   vec4 lettering(sampler2D atlas,vec2 uv,float a,float longitudeSpan){
    vec2 dx=vec2(angle(dFdx(a))/longitudeSpan,dFdx(uv.y));
    vec2 dy=vec2(angle(dFdy(a))/longitudeSpan,dFdy(uv.y));
    return textureGrad(atlas,clamp(uv,0.,1.),dx,dy);
   }
   vec3 brand(float a,float lat){
    // Two outward-facing wordmarks, each upright on its own hemisphere.
    float lon=.5*angle(2.*(a-.76));
    float sweep=sin(3.*a-clock*.64)*.065;
    float belt=lat-.20-sweep;
    vec3 ink=mix(vec3(.008,.012,.026),vec3(.034,.060,.105),.5+.5*sin(2.*a+lat*7.-clock*.32));
    float fold=sin(3.*a+lat*1.7-clock*.72);
    vec2 weave=sin(vec2(14.*a+clock*.85,14.*lat+.85*fold));
    vec2 aa=max(fwidth(weave),vec2(.022));
    vec2 square=smoothstep(-aa,aa,weave);
    float check=mix(square.y,1.-square.y,square.x);
    float edge=smoothstep(.14,.34,abs(belt));
    ink=mix(ink,mix(vec3(.011,.017,.031),vec3(.062,.084,.12),check),edge);
    ink=mix(ink,vec3(.96,.034,.064),band(belt-.38,.022)+band(belt+.35,.011));
    // The finish flag unfurls from behind the wordmark.
    vec3 flag=mix(vec3(.012,.016,.027),vec3(.95,.91,.79),check)*(.91+.09*fold);
    ink=mix(ink,flag,flagMix*smoothstep(.105,.30,abs(belt)));
    vec2 uv=vec2(lon/1.62+.5,(lat-.20)/.405+.5);
    vec4 logo=lettering(wordmark,uv,a,1.62);
    return mix(ink,logo.rgb*1.12,logo.a);
   }
   vec3 mascot(float a,float lat){
    vec2 p=vec2(angle(a-bearing),lat);
    vec3 yellow=mix(vec3(.95,.33,.013),vec3(1.15,.75,.045),smoothstep(-.53,.65,p.y));
    yellow*=.82+.18*cos(p.x);
    vec3 ink=vec3(.021,.014,.028);
    // One blink, with a quick close and a slower reopen.
    float beat=mod(clock+.85,4.9);
    float blink=1.-.93*(smoothstep(0.,.085,beat)*(1.-smoothstep(.095,.28,beat)));
    for(int i=0;i<2;i++){
     float side=i==0?-1.:1.;
     float lid=min(blink,1.-(i==1?.94*wink:0.));
     vec2 eye=p-vec2(side*mix(.32,.275,helmetMix),.42);
     eye.y*=1.+.10*helmetMix;
     float shell=ellipse(eye,vec2(.207,.228*lid+.012));
     yellow=mix(yellow,ink,shell);
     vec2 inner=eye/vec2(1.,lid);
     float white=ellipse(inner,vec2(.192,.217));
     yellow=mix(yellow,mix(vec3(.75,.81,.82),vec3(1.12,1.09,.93),smoothstep(-.22,.12,inner.y)),white);
     vec2 iris=(inner-gaze*vec2(.084,.076))/(1.+.22*helmetMix);
     yellow=mix(yellow,vec3(.047,.18,.22),white*ellipse(iris,vec2(.104,.133)));
     yellow=mix(yellow,ink,white*ellipse(iris,vec2(.085,.111)));
     yellow=mix(yellow,vec3(1.2),white*ellipse(iris-vec2(-.030,.047),vec2(.027,.032)));
     vec2 brow=p-vec2(side*.32,.743+.019*sin(clock*1.3+side)+.038*wink*side);
     brow.y+=.95*brow.x*brow.x+side*.095*brow.x;
     yellow=mix(yellow,ink,ellipse(brow,vec2(.16,.024)));
     float cheek=ellipse(p-vec2(side*.60,.08),vec2(.13,.047));
     yellow=mix(yellow,vec3(.98,.265,.036),cheek*.72);
    }
    // A crescent grin cut from two arcs, with a little red tongue.
    vec2 mouth=p-vec2(0.,.04);
    float smile=ellipse(mouth,vec2(.43,.25))*smoothstep(-.012,.004,.54*mouth.x*mouth.x-.048-mouth.y);
    float surprised=ellipse(mouth-vec2(0.,.018),vec2(.056,.065));
    yellow=mix(yellow,ink,mix(smile,surprised,helmetMix));
    yellow=mix(yellow,vec3(.90,.114,.145),(1.-helmetMix)*smile*ellipse(mouth-vec2(.066,-.235),vec2(.22,.070)));
    return yellow;
   }
   // The Vegas helmet wraps around the building. Only the eye port exposes the mascot.
   vec3 helmet(float a,float lat,vec3 face){
    float lon=angle(a-bearing),side=abs(lon),wrapSide=1.-cos(lon);
    vec3 navy=vec3(.014,.023,.076),ice=vec3(.75,.91,1.02),cyan=vec3(.018,.53,1.08);
    float light=.72+.25*cos(lon+.43)*cos(lat-.88);
    float sweep=lat+.33*wrapSide+.09*sin(2.*lat);
    vec3 shell=mix(navy,cyan,smoothstep(-.48,-.23,sweep));
    shell=mix(shell,ice,band(sweep+.23,.12));
    shell=mix(shell,navy,band(sweep+.40,.018)+band(sweep-.31,.014));
    shell=mix(shell,navy,smoothstep(.88,.91,lat+.30*wrapSide));
    float pinstripe=lat+.28*wrapSide-1.04;
    shell=mix(shell,cyan,max(band(pinstripe,.014),band(pinstripe-.07,.012)));
    vec2 badge=vec2(lon/1.08+.5,(lat-.95)/.23+.5);
    vec4 logo=lettering(wordmark,badge,a,1.08);
    shell=mix(shell,logo.rgb,logo.a);
    // Rounded, swept-back visor opening, a raised white brow, and a black rubber seal.
    float middle=.19+.13*smoothstep(.55,1.35,side);
    vec2 q=abs(vec2(lon/1.06,(lat-middle)/.322));
    float port=pow(pow(q.x,5.)+pow(q.y,5.),.2);
    float edge=max(.012,fwidth(port));
    shell=mix(shell,ice,1.-smoothstep(1.23-edge,1.23+edge,port));
    shell=mix(shell,navy,1.-smoothstep(1.07-edge,1.07+edge,port));
    shell=mix(shell,face*(.81+.19*smoothstep(.0,.23,1.-port)),1.-smoothstep(1.-edge,1.+edge,port));
    vec2 title=vec2(lon/1.50+.5,(lat-middle-.373)/.070+.5);
    shell=mix(shell,navy,lettering(browText,title,a,1.50).a);
    vec2 hinge=vec2(side-1.12,lat-.40);
    shell=mix(shell,ice,ellipse(hinge,vec2(.135,.118)));
    shell=mix(shell,navy,ellipse(hinge,vec2(.095,.088)));
    shell=mix(shell,vec3(.38,.56,.75),ellipse(hinge,vec2(.032,.030)));
    vec2 vent=vec2(lon,lat+.29);
    shell=mix(shell,navy,ellipse(vent,vec2(.145,.060)));
    float jaw=lat+.38-.12*wrapSide;
    shell=mix(shell,cyan,band(jaw,.040)*smoothstep(.16,.71,side));
    shell=mix(shell,ice,band(vent.y,.009)*ellipse(vent,vec2(.1,.035)));
    return shell*light;
   }
   void main(){
    vec3 n=normalize(radial);float a=atan(n.x,n.z),lat=asin(clamp(n.y,-1.,1.));
    vec3 show=brand(a,lat);
    if(faceMix>.001){
     // The rear hemisphere carries the brand while the face turns trackside.
     float front=smoothstep(-.38,.26,cos(a-bearing));
     vec3 face=mascot(a,lat+.21*helmetMix);
     show=mix(show,face,front*faceMix);
     if(helmetMix>.001)show=mix(show,helmet(a,lat,face),faceMix*helmetMix);
    }
    // Staggered LED pucks and louver rails converge to their mean radiance
    // below a pixel. Use radial derivatives across the longitude wrap.
    vec2 cell=vec2(a*(1536./(2.*PI)),lat*(768./PI));
    vec2 footprint=vec2(244.46*length(fwidth(n.xz))/max(.02,length(n.xz)),fwidth(cell.y));
    float resolved=1.-smoothstep(.25,1.05,max(footprint.x,footprint.y));
    float baseFade=smoothstep(-.432,-.32,lat);
    vec2 puck=fract(cell+vec2(.5*mod(floor(cell.y),2.),0.))-.5;
    float emitter=1.-smoothstep(.28,.49,length(puck));
    float rails=.5+.5*cos(cell.y*PI*.25);
    show*=1.+baseFade*(resolved*.34*(emitter-.48)
       -.046*(rails-.5)*(1.-smoothstep(1.,3.,footprint.y)));
    gl_FragColor=vec4(show,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
   }`});
 let lastTime:number|undefined,tracked:number|undefined;
 let closest=Infinity,winked=false,lastWink=-10;
 function update(race:RenderRace,track:Track,seconds:number,chequered:boolean){
  const dt=lastTime===undefined?0:T.MathUtils.clamp(seconds-lastTime,0,.15);
  lastTime=seconds;uniforms.clock.value+=dt;
  let nearest=Infinity,selected:number|undefined,targetYaw=homeBearing,range=Infinity;
  function consider(car:{distance:number;offset:number;finishTime?:number|null},id:number){
   if(car.finishTime!=null)return;
   const p=track.pointAt(car.distance,car.offset);
   const dx=p.x-centre.x,dz=p.z-centre.z,distance=Math.hypot(dx,dz);
   // Prefer the current car by 22 m to keep the gaze steady through a pack.
   const score=distance-(tracked===id?22:0);
   if(distance<330&&score<nearest){
    selected=id;nearest=score;range=distance;targetYaw=Math.atan2(dx,dz);
   }
  }
  if(race.phase==='racing'&&!chequered){
   consider(race.cars.a,-1);consider(race.cars.b,-2);race.field?.forEach(consider);
  }
  const t=uniforms.clock.value,near=selected!==undefined;
  if(selected!==tracked){closest=Infinity;winked=false;}
  tracked=selected;
  closest=Math.min(closest,range);
  if(near&&!winked&&closest<205&&range>closest+4&&t-lastWink>4){
   lastWink=t;winked=true;
  }
  const since=t-lastWink;
  uniforms.wink.value=T.MathUtils.smoothstep(since,0,.11)*(1-T.MathUtils.smoothstep(since,.32,.57));
  const idle=t%30;
  uniforms.helmetMix.value=T.MathUtils.smoothstep(idle,13,14)*(1-T.MathUtils.smoothstep(idle,25,26));
  const face=chequered?0:near?1:T.MathUtils.smoothstep(idle,6,7)*(1-T.MathUtils.smoothstep(idle,25,26));
  if(!near)targetYaw+=.16*Math.sin(t*.6);
  const turn=wrap(targetYaw-uniforms.bearing.value);
  uniforms.bearing.value=wrap(uniforms.bearing.value+turn*(-Math.expm1(-dt*1.55)));
  const lookX=near?T.MathUtils.clamp(turn*3.6,-1,1):.62*Math.sin(t*1.1);
  const lookY=near?-T.MathUtils.clamp(85/range,.18,.92):.16*Math.sin(t*.7);
  uniforms.gaze.value.x+=(lookX-uniforms.gaze.value.x)*-Math.expm1(-dt*9);
  uniforms.gaze.value.y+=(lookY-uniforms.gaze.value.y)*-Math.expm1(-dt*9);
  uniforms.faceMix.value+=(face-uniforms.faceMix.value)*-Math.expm1(-dt*3);
  uniforms.flagMix.value+=(Number(chequered)-uniforms.flagMix.value)*-Math.expm1(-dt*2);
 }
 return {material,update};
}
