from PIL import Image,ImageOps,ImageDraw
from pathlib import Path
import sys
root=Path('artifacts/realism-v3')/sys.argv[1]
refs={'front-beauty':'second-01.png','wheel-closeup':'../detail-04-07/frame-01.png','steering-closeup':'../detail-04-07/frame-05.png','rear-three-quarter':'second-18.png'}
# Actual filenames from the approved extracted reference frames.
frames=Path('reference/frames')
for name,ref in refs.items():
 if not (frames/ref).exists():
  ref='second-04.png' if name=='wheel-closeup' else 'second-05.png' if name=='steering-closeup' else ref
 out=Image.new('RGB',(1600,660),'#121922');d=ImageDraw.Draw(out)
 for i,(path,label) in enumerate([(frames/ref,'REFERENCE / '+ref),(root/(name+'.png'),'RENDER / '+sys.argv[1])]):
  im=Image.open(path).convert('RGB');im.thumbnail((800,610));out.paste(im,(i*800+(800-im.width)//2,40));d.text((i*800+20,14),label,fill='white')
 out.save(root/('comparison-'+name+'.jpg'),quality=88)
# Onboard comparison to the preceding implementation (the reference clip has no onboard footage).
out=Image.new('RGB',(1600,660),'#121922')
for i,path in enumerate([Path('artifacts/realism-v3/before/cockpit-onboard.png'),root/'cockpit-onboard.png']):
 im=Image.open(path).convert('RGB');im.thumbnail((800,610));out.paste(im,(i*800,40))
ImageDraw.Draw(out).text((20,14),'ONBOARD: PREVIOUS / CURRENT (not a real onboard reference)',fill='white');out.save(root/'comparison-onboard.jpg',quality=88)
