"""Uncropped reference comparison and honest before/after driver camera evidence."""
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw
import sys

root=Path('artifacts/onboard-v8')
phase=sys.argv[1] if len(sys.argv)>1 else 'after'
shots=root/phase
if (shots/'cars').exists():shots=shots/'cars'
def compare(paths,labels,name,size=(738,550)):
 w,h=size;out=Image.new('RGB',(w*len(paths),h+34),'#141b24');d=ImageDraw.Draw(out)
 for i,(p,label) in enumerate(zip(paths,labels)):
  im=ImageOps.contain(Image.open(p).convert('RGB'),(w,h))
  out.paste(im,(i*w+(w-im.width)//2,34+(h-im.height)//2));d.text((i*w+12,10),label,fill='white')
 out.save(shots/name,quality=92)

compare([root/'reference-onboard.png',shots/'clean-tcam-a.png'],['USER REFERENCE / 738 x 375','JGP T-CAM / same aspect / no crop'],'reference-vs-tcam.jpg',(738,375))
if (shots/'clean-tcam-turning.png').exists():
 compare([root/'reference-onboard.png',shots/'clean-tcam-turning.png'],['USER REFERENCE / cornering','JGP / steering applied / same straight fixture'],'reference-vs-tcam-turning.jpg',(738,375))
for name in ['tcam','cockpit-onboard','onboard-left-lock','onboard-right-lock']:
 compare([root/'before'/f'{name}.png',shots/f'{name}.png'],['BEFORE / 16be387','AFTER / '+phase],f'before-after-{name}.jpg')
# Same pixel crop from the two 1440x1080 eye-camera captures; no retouching.
for src,dst in [(root/'before/cockpit-onboard.png',root/'before/glove-detail.png'),(shots/'cockpit-onboard.png',shots/'glove-detail.png')]:
 Image.open(src).crop((330,500,1110,1000)).save(dst)
compare([root/'before/glove-detail.png',shots/'glove-detail.png'],['BEFORE GLOVE CROP','AFTER GLOVE CROP'],'before-after-gloves.jpg',(780,500))
if (shots/'steering-closeup.png').exists():
 compare([Path('reference/detail-04-07/frame-05.png'),shots/'steering-closeup.png'],['APPROVED SF-26 WHEEL / 05.25','JGP WHEEL / fictional controls'],'reference-steering.jpg')
names=['clean-tcam-a','clean-cockpit-a','clean-tcam-b','clean-cockpit-b','wide-cockpit-left','wide-cockpit-right']
out=Image.new('RGB',(1476,3*410),'#141b24');d=ImageDraw.Draw(out)
for i,name in enumerate(names):
 im=ImageOps.contain(Image.open(shots/f'{name}.png').convert('RGB'),(738,375));x=i%2*738;y=i//2*410
 d.text((x+12,y+10),name,fill='white');out.paste(im,(x,y+34))
out.save(shots/'camera-contact-sheet.jpg',quality=90)
