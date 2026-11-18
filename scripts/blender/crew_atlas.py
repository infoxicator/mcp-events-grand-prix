"""Build the face projection and woven insignia sheet used in Blender."""
from pathlib import Path
import math,random
from PIL import Image,ImageDraw,ImageFont
def build():
 root=Path(__file__).parent
 im=Image.new('RGB',(512,768),'white');im.paste(Image.open(root/'textures/mechanic-face.jpg'),(0,0))
 d=ImageDraw.Draw(im)
 def font(size):
  for name in ['Arial Bold Italic.ttf','DejaVuSans-BoldOblique.ttf']:
   try:return ImageFont.truetype(name,size)
   except OSError:pass
  return ImageFont.load_default(size)
 for y,bg,fg,word in [(526,'#d6d4c7','#132337','NEXUS'),(605,'#152638','#f3eada','VECTOR'),(684,'#c23e24','#fff9ed','CIRCUIT')]:
  d.rounded_rectangle((8,y,295,y+67),9,fill=bg,outline='#8d8172',width=3)
  for x in range(18,285,8):
   for a in [y+5,y+62]:d.line((x,a,x+3,a+1),fill='#938e85',width=1)
  d.text((153,y+35),word,font=font(46),anchor='mm',fill=fg)
 # Diffuse weave and fine diagonal quilting on the suit panels.
 rng=random.Random(1826);pixels=im.load()
 for y in range(524,755):
  for x in range(306,502):
   fibre=4.4*math.sin(x*2.9+.7*(y%2))+3.2*math.sin(y*2.7)+rng.uniform(-4,4)
   seam=min((x+2*y)%87,87-(x+2*y)%87,(x-2*y)%87,87-(x-2*y)%87)
   value=int(230+fibre-(13 if seam<1.9 else 0))
   pixels[x,y]=(value,value,min(255,value+2))
 im.save(root/'textures/crew-atlas.jpg',quality=88,subsampling=0)
if __name__=='__main__':build()
