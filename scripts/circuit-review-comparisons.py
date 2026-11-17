from pathlib import Path
from PIL import Image,ImageDraw,ImageOps
import sys
root=Path('artifacts/circuits-v2');rnd=sys.argv[1]
for circuit in ['monza','las-vegas']:
 folder=root/rnd/circuit;files=['straight-chase','signature-onboard','aerial','pit-grandstand']
 sheet=Image.new('RGB',(1440,4*390),(18,21,27));draw=ImageDraw.Draw(sheet)
 for row,name in enumerate(files):
  refs=(['monza-stand-photo.jpg','monza-modern-parabolica.jpg','monza-modern-parabolica.jpg','monza-paddock-photo.jpg'] if circuit=='monza' else ['vegas-pit-photo.jpg','vegas-sphere.jpg','vegas-sphere.jpg','vegas-pit-photo.jpg'])
  for col,p in enumerate([Path('reference/circuits')/refs[row],folder/(name+'.png')]):
   if not p.exists():continue
   im=ImageOps.contain(Image.open(p).convert('RGB'),(710,350));sheet.paste(im,(col*720+(710-im.width)//2,row*390+28+(350-im.height)//2));draw.text((col*720+10,row*390+8),('PHOTO: location/detail reference (not matched camera)' if col==0 else rnd+' / '+name),fill='white')
 sheet.save(folder/'photo-comparisons.jpg',quality=88)
