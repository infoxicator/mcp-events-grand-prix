"""Reference and before/after sheets for this round; source photos stay local."""
from PIL import Image,ImageOps,ImageDraw
from pathlib import Path
import sys
root=Path('artifacts/realism-v7');iteration=sys.argv[1] if len(sys.argv)>1 else 'after'
folder=root/iteration
refs={'front-beauty':'frames/second-01.png','wheel-closeup':'detail-04-07/frame-01.png','steering-closeup':'detail-04-07/frame-05.png','rear-three-quarter':'frames/second-18.png','showroom-clay':'frames/second-02.png','showroom-wireframe':'frames/second-03.png'}
def compare(paths,labels,out):
 sheet=Image.new('RGB',(1800,720),'#121922');d=ImageDraw.Draw(sheet)
 for i,(p,label) in enumerate(zip(paths,labels)):
  im=ImageOps.contain(Image.open(p).convert('RGB'),(890,660));sheet.paste(im,(900*i+(890-im.width)//2,45+(660-im.height)//2));d.text((900*i+16,16),label,fill='white')
 sheet.save(out,quality=88)
for name,ref in refs.items():
 compare([Path('reference')/ref,folder/'cars'/f'{name}.png'],['SF-26 VIDEO / '+ref,'JGP-26 / '+iteration],folder/'cars'/f'reference-{name}.jpg')
 compare([root/'before/cars'/f'{name}.png',folder/'cars'/f'{name}.png'],['BEFORE (feb5baa)','AFTER / '+iteration],folder/'cars'/f'before-after-{name}.jpg')
compare([root/'before/cars/cockpit-onboard.png',folder/'cars/cockpit-onboard.png'],['BEFORE ONBOARD','AFTER ONBOARD (video contains no driving onboard)'],folder/'cars/before-after-onboard.jpg')
for circuit in ['monza','las-vegas']:
 photos=['monza-stand-photo.jpg','monza-modern-parabolica.jpg','monza-modern-parabolica.jpg','monza-paddock-photo.jpg'] if circuit=='monza' else ['vegas-pit-photo.jpg','vegas-sphere.jpg','vegas-sphere.jpg','vegas-pit-photo.jpg']
 for name,photo in zip(['straight-chase','signature-onboard','aerial','pit-grandstand'],photos):
  compare([Path('reference/circuits')/photo,folder/circuit/f'{name}.png'],['REAL LOCATION / '+photo,'RENDER / '+iteration+' (camera not matched)'],folder/circuit/f'reference-{name}.jpg')
  compare([root/'before'/circuit/f'{name}.png',folder/circuit/f'{name}.png'],['BEFORE (feb5baa)','AFTER / '+iteration],folder/circuit/f'before-after-{name}.jpg')
for kind,names in [('cars',['front-beauty','rear-three-quarter','side-profile','wheel-closeup','steering-closeup','airbox-closeup','sidepod-closeup','halo-closeup','cockpit-onboard','onboard-left-lock','onboard-right-lock','tcam','chase','showroom-colour','showroom-clay','showroom-wireframe']),('monza',['straight-chase','signature-onboard','aerial','pit-grandstand']),('las-vegas',['straight-chase','signature-onboard','aerial','pit-grandstand'])]:
 cols=3 if kind=='cars' else 2
 sheet=Image.new('RGB',(cols*600,((len(names)+cols-1)//cols)*470),'#121922');d=ImageDraw.Draw(sheet)
 for i,name in enumerate(names):
  im=ImageOps.contain(Image.open(folder/kind/(name+'.png')).convert('RGB'),(600,440))
  x=(i%cols)*600;y=(i//cols)*470
  sheet.paste(im,(x+(600-im.width)//2,y+26+(440-im.height)//2));d.text((x+12,y+7),name,fill='white')
 sheet.save(folder/kind/'all-views.jpg',quality=88)

if (folder/'las-vegas/strip-aerial.png').exists():
 compare([Path('reference/circuits/vegas-strip.jpg'),folder/'las-vegas/strip-aerial.png'],['REAL STRIP / camera not matched','JGP LAS VEGAS / '+iteration],folder/'las-vegas/reference-strip-aerial.jpg')
 compare([root/'before/las-vegas/strip-aerial.png',folder/'las-vegas/strip-aerial.png'],['BEFORE feb5baa','AFTER / '+iteration],folder/'las-vegas/before-after-strip-aerial.jpg')

if (folder/'las-vegas/strip-landmarks.png').exists():
 compare([Path('reference/circuits/vegas-strip.jpg'),folder/'las-vegas/strip-landmarks.png'],['REAL STRIP / camera not matched','JGP LAS VEGAS / full viewport'],folder/'las-vegas/reference-strip-landmarks.jpg')

# Matching onboard crops make cuff/seam/control changes inspectable without enlarging pixels.
for phase in [root/'before',folder]:
 source=phase/'cars/cockpit-onboard.png'
 if source.exists():Image.open(source).crop((380,510,1040,930)).save(phase/'cars/onboard-gloves-detail.png')
compare([root/'before/cars/onboard-gloves-detail.png',folder/'cars/onboard-gloves-detail.png'],['BEFORE / onboard crop','AFTER / onboard crop'],folder/'cars/before-after-gloves-detail.jpg')
