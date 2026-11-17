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
# Opaque leaf clusters for solid 3D crowns (no billboard or alpha cutout).
random.seed(731);im=Image.new('RGB',(512,256),(51,57,42));d=ImageDraw.Draw(im)
for i in range(24000):
 x=random.randrange(512);y=random.randrange(256);r=random.choice([1,1,2,3,5]);v=random.randint(45,180);d.ellipse((x-r,y-r*.5,x+r,y+r*.5),fill=(v,int(v*.98),int(v*.81)))
save(im,'canopy')
