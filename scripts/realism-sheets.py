"""Assemble original captures into review sheets; no retouching of car renders."""
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw, ImageFont, ImageFilter
import base64,json
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'artifacts/realism-v2'
font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',18)
def comparison(name,left,right,caption):
 im=Image.new('RGB',(1920,770),'#101820');d=ImageDraw.Draw(im)
 for x,path,label in [(0,left,'REFERENCE / '+caption),(960,right,'JGP-26 / BLENDER + THREE.JS')]:
  pic=ImageOps.contain(Image.open(path).convert('RGB'),(960,720));im.paste(pic,(x+(960-pic.width)//2,40+(720-pic.height)//2));d.text((x+20,12),label,font=font,fill='#e4e9ef')
 im.save(OUT/name)
comparison('comparison-front.png',ROOT/'reference/frames/second-01.png',OUT/'front-beauty.png','00:01')
comparison('comparison-wheel.png',ROOT/'reference/detail-04-07/frame-01.png',OUT/'wheel-closeup.png','00:04.25')
comparison('comparison-steering.png',ROOT/'reference/detail-04-07/frame-05.png',OUT/'steering-closeup.png','00:05.25')
sheets={
 'a-before':[('before/front.png','BEFORE / FRONT'),('before/cockpit.png','BEFORE / COCKPIT'),('before/chase.png','BEFORE / BROADCAST'),('before/rear.png','BEFORE / REAR')],
 'b-after':[('chase.png','AFTER / CHASE'),('cockpit-onboard.png','AFTER / ONBOARD'),('front-beauty.png','AFTER / FRONT'),('rear-three-quarter.png','AFTER / REAR')],
 'c-details':[('side-profile.png','SIDE PROFILE'),('wheel-closeup.png','WHEEL CLOSE-UP'),('showroom-clay.png','CLAY'),('showroom-wireframe.png','WIREFRAME')]}
manifest={}
for name,entries in sheets.items():
 # Keep JPEG quality fixed at 60. Reduce source detail only if needed to meet the transport cap.
 for resolution in [320,300,280,260,240,220,200]:
  im=Image.new('RGB',(1200,560),'#101820');d=ImageDraw.Draw(im)
  for i,(file,label) in enumerate(entries):
   x=(i%2)*600;y=(i//2)*280;pic=Image.open(OUT/file).convert('RGB');pic=ImageOps.contain(pic,(resolution,int(resolution*.75)));im.paste(pic,(x+(600-pic.width)//2,y+32+(240-pic.height)//2));d.text((x+190,y+9),label,font=ImageFont.load_default(),fill='#dce5ee')
  path=OUT/f'sheet-{name}.jpg';im.save(path,quality=60,optimize=True,progressive=True,subsampling=2)
  encoded=base64.b64encode(path.read_bytes()).decode()
  if len(encoded)<44000:break
 assert len(encoded)<45000,(name,len(encoded));(OUT/f'sheet-{name}.base64.txt').write_text(encoded+'\n');manifest[name]={'width':1200,'height':560,'quality':60,'sourceDetailWidth':resolution,'bytes':path.stat().st_size,'base64Characters':len(encoded)}
(OUT/'contact-sheets.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest,indent=2))
