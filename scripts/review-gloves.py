"""Unretouched before/after evidence for the glove and aerial refinement."""
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw
r=Path('artifacts/onboard-v9')
def pair(a,b,name,size=(738,375),labels=('BEFORE / 51b88c4','AFTER / tailored glove')):
 w,h=size;o=Image.new('RGB',(w*2,h+32),'#131b24');d=ImageDraw.Draw(o)
 for i,im in enumerate((a,b)):
  if isinstance(im,Path):im=Image.open(im)
  im=ImageOps.contain(im.convert('RGB'),(w,h));o.paste(im,(i*w+(w-im.width)//2,32+(h-im.height)//2));d.text((i*w+12,10),labels[i],fill='white')
 o.save(r/'after/cars'/name,quality=92)
for name in ['clean-cockpit-a','clean-cockpit-b','clean-tcam-a']:
 pair(r/'before'/f'{name}.png',r/'after/cars'/f'{name}.png',f'before-after-{name}.jpg')
# Identical crop and scale. Nothing is retouched or re-lit.
a=Image.open(r/'before/clean-cockpit-a.png').crop((465,450,1015,655))
b=Image.open(r/'after/cars/clean-cockpit-a.png').crop((465,450,1015,655))
pair(a,b,'before-after-gloves.jpg',(825,308))
pair(Path('artifacts/onboard-v8/reference-onboard.png'),r/'after/cars/clean-tcam-a.png','reference-vs-tcam.jpg',labels=('SUPPLIED REAL ONBOARD','JGP / T-CAM RETAINED'))
