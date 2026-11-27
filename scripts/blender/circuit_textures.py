"""Original texture atlases, deterministic; reference photographs are never game textures."""
from PIL import Image,ImageDraw,ImageFont,ImageFilter
from pathlib import Path
import random,math
random.seed(26)
out=Path('src/race/assets/circuits');out.mkdir(exist_ok=True)
font='/System/Library/Fonts/Helvetica.ttc'
def save(im,name):im.save(out/(name+'.png'),optimize=True)
# Supersample the steel wire coverage and keep colour constant in transparent texels.
mask=Image.new('L',(1024,1024));wire=ImageDraw.Draw(mask)
for k in range(-1024,2049,128):
 for end in (-1024,1024):wire.line((k,0,k+end,1024),fill=248,width=7)
wire.line((0,48,1024,48),fill=242,width=7)
im=Image.new('RGBA',(256,256),(72,78,81,0))
im.putalpha(mask.resize(im.size,Image.Resampling.LANCZOS));save(im,'fence')
im=Image.new('RGB',(256,256),(134,124,108));d=ImageDraw.Draw(im)
for i in range(20000):
 x=random.randrange(256);y=random.randrange(256);v=random.randrange(85,180);r=random.randrange(1,3);d.ellipse((x,y,x+r,y+r),fill=(v,int(v*.94),int(v*.82)))

im=Image.new('RGB',(1024,128),(24,31,35));d=ImageDraw.Draw(im);f=ImageFont.truetype(font,62);d.text((30,25),'NEXUS  /  MCP GRAND PRIX',font=f,fill=(240,234,210));save(im,'sign')
im=Image.new('RGB',(1024,96),(21,32,38));d=ImageDraw.Draw(im)
d.rectangle((0,87,1024,91),fill=(175,145,89))
d.text((512,45),'F1   PADDOCK CLUB',anchor='mm',font=ImageFont.truetype(font,62),fill=(247,239,217))
save(im,'paddock-club')
im=Image.new('RGBA',(128,128));d=ImageDraw.Draw(im)
for x in range(128):
 alpha=int(37*math.sin(math.pi*x/127)**2)
 for y in range(128):d.point((x,y),fill=(9,10,12,int(alpha*(.65+random.random()*.35))))
save(im,'rubber')
for number in [150,100,50]:
 im=Image.new('RGB',(576,400),(250,249,243));d=ImageDraw.Draw(im)
 d.rectangle((6,6,569,393),outline=(20,23,24),width=12)
 for left in (21,495):d.rectangle((left,22,left+59,37),fill=(181,38,31))
 heavy=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Black.ttf',242)
 glyph=str(number);x0,y0,x1,y1=d.textbbox((0,0),glyph,font=heavy)
 d.text(((576-x0-x1)/2,(400-y0-y1)/2),glyph,font=heavy,fill=(10,13,15))
 save(im,'brake-'+glyph)
# Formwork texture for concrete at metres-to-centimetres scale. Two fields of
# aggregate, rain traces and small air pockets break the flat barrier highlight.
rng=random.Random(448)
base=Image.new('L',(512,256))
base.putdata([rng.randrange(150,180) for _ in range(512*256)])
stain=Image.new('L',(32,16))
stain.putdata([rng.randrange(112,190) for _ in range(32*16)])
base=Image.blend(base,stain.resize(base.size,Image.Resampling.BICUBIC),.53)
d=ImageDraw.Draw(base)
for i in range(850):
 x=rng.randrange(512);y=rng.randrange(256);rad=rng.choices([.6,1.1,1.8],weights=[8,3,1])[0]
 d.ellipse((x-rad,y-rad,x+rad,y+rad),fill=rng.randint(112,148))
base.convert('RGB').save(out/'formed-concrete.jpg',quality=78,optimize=True)

# Retain the full-resolution normal-map master and compress the browser copy.
Image.open(out.parent/'asphalt-normal.jpg').save(out.parent/'asphalt-normal.webp','WEBP',quality=92,method=6)
# The two television banks use the actual surveyed circuit silhouette.
import json
for circuit in ('monza','las-vegas'):
 source=json.loads(Path(f'data/{circuit}-render-path.json').read_text())['samples'][::10]
 xy=[(p['x'],p['z']) for p in source]
 xs,zs=zip(*xy);span=max(max(xs)-min(xs),max(zs)-min(zs))
 panel=Image.new('RGB',(384,192),(9,18,25));draw=ImageDraw.Draw(panel)
 draw.text((12,5),circuit.upper()+'  /  LIVE TIMING',font=ImageFont.truetype(font,18),fill=(177,223,225))
 trackline=[(81+(x-(min(xs)+max(xs))/2)*130/span,107+(z-(min(zs)+max(zs))/2)*130/span) for x,z in xy]
 draw.line(trackline+[trackline[0]],fill=(90,211,190),width=4)
 for j in range(5):
  draw.text((167,39+27*j),f'{j+1:02}    S{j%3+1}     +0.{14+27*j:03}',font=ImageFont.truetype(font,16),fill=(150,206-j*7,194))
 panel.save(out/(circuit+'-timing.jpg'),quality=91)
 photo=Image.open(out/'garage-backplate.jpg').convert('RGB');w,h=photo.size
 for x0,x1 in [(.253,.448),(.613,.784)]:
  rect=(int(w*x0),int(h*.284),int(w*x1),int(h*.392))
  photo.paste(panel.resize((rect[2]-rect[0],rect[3]-rect[1]),Image.Resampling.LANCZOS),rect)
 photo.save(out/(circuit+'-garage.jpg'),quality=91)
# Tileable, metre-scale racing surfaces. Pair albedo and relief with the same aggregate.
import numpy as np
rng=np.random.default_rng(2026);size=768
yy,xx=np.indices((size,size));phase=2*np.pi/size
def texture(base,noise):
 return Image.fromarray(np.clip(np.array(base)[None,None,:]+noise[:,:,None],0,255).astype('uint8'))
def normal_map(height,strength):
 dx=(np.roll(height,-1,1)-np.roll(height,1,1))*strength
 dy=(np.roll(height,-1,0)-np.roll(height,1,0))*strength
 n=np.stack((-dx,-dy,np.ones_like(dx)),axis=2);n/=np.linalg.norm(n,axis=2)[:,:,None]
 return Image.fromarray(((n*.5+.5)*255).astype('uint8'))
aggregate=rng.normal(0,1,(size,size));macro=np.sin(xx*phase*3+np.sin(yy*phase*2))+np.cos(yy*phase*4+xx*phase)
texture([91,92,92],10*aggregate+2.7*macro+7*np.maximum(aggregate-1,0)).save(out.parent/'asphalt-color.jpg',quality=91)
normal_map(aggregate,.17).save(out.parent/'asphalt-normal.webp',quality=91)
blades=rng.normal(0,1,(size,size));blades=(blades+np.roll(blades,1,0)+np.roll(blades,2,0))*.52
texture([79,98,55],blades*12+macro*3+3*np.cos(xx*phase*2)).save(out.parent/'grass-color.jpg',quality=90)
ridge=np.cos(phase*(yy*24+xx*2)+.17*np.sin(xx*phase*3))
grit=rng.normal(0,1,(size,size))
pebbles=texture([137,119,97],grit*16+11*ridge+3*macro)
pebbles.save(out/'gravel.jpg',quality=89)
normal_map(ridge*12+grit*.59,.39).save(out/'raked-normal.jpg',quality=91)
margin=pebbles.convert('RGBA')
coverage=np.clip((.82-xx/size+.10*macro+grit*.12)*2.2,0,1)
margin.putalpha(Image.fromarray((coverage*255).astype('uint8')))
save(margin.resize((256,512),Image.Resampling.LANCZOS),'gravel-margin')
# Shared wardrobe, separate portrait and stance for the second garage mechanic.
sources=Path('scripts/blender/textures')
crew=Image.open(sources/'crew-atlas.jpg').convert('RGB')
staff=Image.new('RGB',(1024,768));staff.paste(crew,(0,0));staff.paste(crew,(512,0))
portrait=Image.open(sources/'spectators.jpg').crop((0,0,256,256))
staff.paste(portrait.resize((512,512),Image.Resampling.LANCZOS),(512,0))
staff.save(sources/'garage-staff.jpg',quality=92)
normal_map(np.sin(phase*(xx*8+yy*3))+np.cos(phase*(yy*11-xx*4)),2.6).save(out/'water-normal.jpg',quality=88)
for index,(label,bg) in enumerate([('PIRELLI',(184,146,43)),('MONZA  /  ITALIA',(21,66,47)),('GRAN PREMIO',(131,27,37)),('AUTODROMO',(33,48,66))]):
 im=Image.new('RGB',(1024,128),bg);d=ImageDraw.Draw(im);d.text((512,66),label,anchor='mm',font=ImageFont.truetype(font,74),fill=(246,244,234));save(im,'sponsor-'+str(index))
