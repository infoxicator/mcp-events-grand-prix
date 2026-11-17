"""Original texture atlases, deterministic; reference photographs are never game textures."""
from PIL import Image,ImageDraw,ImageFont,ImageFilter
from pathlib import Path
import random,math
random.seed(26)
out=Path('src/race/assets/circuits');out.mkdir(exist_ok=True)
font='/System/Library/Fonts/Helvetica.ttc'
def save(im,name):im.save(out/(name+'.png'),optimize=True)
im=Image.new('RGBA',(512,512));d=ImageDraw.Draw(im)
for i in range(26000):
 a=random.random()*math.tau;r=math.sqrt(random.random());x=256+math.cos(a)*r*230;y=256+math.sin(a)*r*230
 if r> .9+.08*math.sin(a*7)+.06*math.cos(a*11):continue
 v=random.randrange(36,85);d.ellipse((x-2,y-1,x+3,y+2),fill=(int(v*.76),v,int(v*.48),255))
save(im,'foliage')
im=Image.new('RGBA',(128,128));d=ImageDraw.Draw(im)
for k in range(-128,257,16):d.line((k,0,k+128,128),fill=(170,180,180,240),width=1);d.line((k,0,k-128,128),fill=(170,180,180,240),width=1)
save(im,'fence')
im=Image.new('RGB',(256,256),(134,124,108));d=ImageDraw.Draw(im)
for i in range(20000):
 x=random.randrange(256);y=random.randrange(256);v=random.randrange(85,180);r=random.randrange(1,3);d.ellipse((x,y,x+r,y+r),fill=(v,int(v*.94),int(v*.82)))
save(im,'gravel')
im=Image.new('RGB',(256,512),(19,23,29));d=ImageDraw.Draw(im)
for y in range(0,512,16):
 d.line((0,y,256,y),fill=(64,54,42),width=1)
 for x in range(0,256,12):
  v=random.choice([(150,121,77),(215,180,120),(80,102,125),(23,29,36),(23,29,36)])
  d.rectangle((x+3,y+3,x+9,y+12),fill=v)
save(im,'windows')
# Floodlit limestone facade: opaque stone between recessed windows, not glowing black glass.
im=Image.new('RGB',(256,512),(154,115,73));d=ImageDraw.Draw(im)
for y in range(0,512,16):
 d.rectangle((0,y,255,y+2),fill=(187,146,97));d.line((0,y+15,255,y+15),fill=(97,69,44))
 for x in range(0,256,12):
  d.rectangle((x+2,y+3,x+10,y+14),fill=(90,64,43))
  v=random.choice([(190,159,106),(223,191,132),(35,34,32),(35,34,32),(51,49,43)])
  d.rectangle((x+3,y+4,x+9,y+13),fill=v);d.line((x+6,y+4,x+6,y+13),fill=(73,59,43))
save(im,'warm-windows')

im=Image.new('RGBA',(256,256));d=ImageDraw.Draw(im)
for i in range(8):
 x=i*32+16;v=random.choice([(35,49,63),(160,57,40),(205,202,183),(54,78,69)])
 d.ellipse((x-5,34,x+5,46),fill=(150,113,89,255));d.rounded_rectangle((x-7,46,x+7,68),radius=4,fill=(*v,255));d.line((x-5,65,x-8,80),fill=(*v,255),width=4);d.line((x+5,65,x+8,80),fill=(*v,255),width=4)
save(im.crop((0,24,256,88)),'crowd')
im=Image.new('RGB',(1024,128),(24,31,35));d=ImageDraw.Draw(im);f=ImageFont.truetype(font,62);d.text((30,25),'NEXUS  /  JEV GRAND PRIX',font=f,fill=(240,234,210));save(im,'sign')
im=Image.new('RGBA',(128,128));d=ImageDraw.Draw(im)
for x in range(128):
 alpha=int(37*math.sin(math.pi*x/127)**2)
 for y in range(128):d.point((x,y),fill=(9,10,12,int(alpha*(.65+random.random()*.35))))
save(im,'rubber')
for number in [150,100,50]:
 im=Image.new('RGB',(128,128),(231,230,217));d=ImageDraw.Draw(im);f=ImageFont.truetype(font,55);d.text((64,64),str(number),anchor='mm',font=f,fill=(16,20,25));save(im,'brake-'+str(number))
im=Image.new('RGB',(1024,512),(8,13,28));d=ImageDraw.Draw(im)
for y in range(0,512,6):
 points=[(x,y+int(math.sin(x/90+y/40)*22)) for x in range(0,1024,4)];d.line(points,fill=(25,90+y%100,120+y%110),width=2)
for i in range(2):
 x=256+i*512;d.rounded_rectangle((x-230,150,x+230,360),radius=20,fill=(10,13,28),outline=(210,53,112),width=3)
 for text,y,size,col in [('WELCOME TO',190,25,(224,98,158)),('LAS VEGAS',255,57,(248,230,195)),('JEV GRAND PRIX',320,28,(90,219,209))]:d.text((x,y),text,anchor='mm',font=ImageFont.truetype(font,size),fill=col)
save(im,'sphere-art')
# Perforated original leaf sprays with a branching centre, layered on bent 3D fans.
rng=random.Random(731);im=Image.new('RGBA',(256,256));d=ImageDraw.Draw(im)
for branch in range(9):
 a=branch*math.tau/9+.14;length=rng.uniform(65,115);ex=128+math.cos(a)*length;ey=128+math.sin(a)*length
 d.line((128,128,ex,ey),fill=(78,73,52,255),width=2)
 for leaf in range(64):
  t=rng.uniform(.15,1);x=128+(ex-128)*t+rng.gauss(0,12);y=128+(ey-128)*t+rng.gauss(0,12)
  v=rng.randint(95,205);rx=rng.uniform(4,8);ry=rng.uniform(2.5,6)
  d.ellipse((x-rx,y-ry,x+rx,y+ry),fill=(v,int(v*.98),int(v*.72),255))
save(im,'canopy')

# Four fascia strips share one atlas. Blender places a different strip above each bay.
im=Image.new('RGB',(768,256),'#252b30')
d=ImageDraw.Draw(im)
for row,(team,color) in enumerate([('VECTOR RACING','#aa2639'),('CHAOS MOTORSPORT','#14756d'),
                                  ('RACE ENGINEERING','#586776'),('PIT OPERATIONS','#3d4a55')]):
 top=row*64
 d.rectangle((0,top,125,top+63),fill=color)
 d.rectangle((0,top+58,767,top+62),fill=color)
 d.text((62,top+29),str(row+1).zfill(2),anchor='mm',font=ImageFont.truetype(font,42),fill='#f4f2ed')
 d.text((153,top+28),team,anchor='lm',font=ImageFont.truetype(font,34),fill='#f4f2ed')
save(im,'garage-fascia')

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
