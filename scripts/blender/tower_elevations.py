"""Original night elevations mapped once across each hotel slab or wing."""
from pathlib import Path
import random
from PIL import Image, ImageDraw, ImageColor

out = Path(__file__).resolve().parents[2] / 'src/race/assets/circuits'
for style, bays, floors in [('Curtain', 14, 28), ('Stone', 18, 29), ('Ribbon', 10, 23)]:
    rng = random.Random(style)
    w, h = 576, 696
    img = Image.new('RGB', (w,h), {'Curtain':'#20242c','Stone':'#35302e','Ribbon':'#242b30'}[style])
    draw = ImageDraw.Draw(img)
    for row in range(floors):
        y = row*h//floors
        height = (row+1)*h//floors-y
        mechanical = row in (floors//3, floors*2//3+1)
        if mechanical:
            draw.rectangle((0,y,w,y+height-1), fill='#141a20')
            draw.line((0,y+height-4,w,y+height-4), fill='#343a3c',width=2)
            continue
        suite = 0
        while suite < bays:
            count = rng.choice((1,1,2,2,3)) if style!='Stone' else rng.choice((1,1,2))
            x, end = suite*w//bays, min(bays,suite+count)*w//bays
            core = (style=='Curtain' and suite in (4,9)) or (style=='Stone' and suite in (5,12))
            lit = not core and rng.random() < (.55 if style=='Stone' else .42)
            shade = rng.choice(('#95816e','#ac9678','#737d84','#776a5d','#696c73')) if lit else rng.choice(('#19222b','#222933','#30323b'))
            jamb = 5 if style=='Stone' else 2
            sill = 7 if style=='Ribbon' else 5
            draw.rectangle((x+jamb,y+4,end-jamb-1,y+height-sill),fill=shade)
            if lit:
                left,right=x+jamb,end-jamb-1
                top,bottom=y+4,y+height-sill
                room=ImageColor.getrgb(shade)
                # Recess behind the outer glass: ceiling bounce fades towards the sill.
                for yy in range(top,bottom+1):
                    t=(yy-top)/max(1,bottom-top)
                    draw.line((left,yy,right,yy), fill=tuple(int(c*(.99-.40*t)) for c in room))
                curtain=rng.randint(3,max(4,(end-x)//3))
                for k in range(curtain):
                    draw.line((left+k,top,left+k,bottom), fill=tuple(int(c*(.48+.055*(k%4))) for c in room))
                draw.line((left+curtain,top,right-2,top),fill='#b39b78')
                if right-left>27 and rng.random()<.44:
                    xx=rng.randint(left+curtain+1,right-3)
                    draw.rectangle((xx,bottom-4,xx+2,bottom-1),fill='#514940')
                draw.line((right-1,top,right-1,bottom),fill='#45444a')
            pane_width=w/bays/(2 if style=='Stone' else 3)
            for k in range(1,round((end-x)/pane_width)):
                xx=round(x+k*pane_width)
                draw.line((xx,y+4,xx,y+height-sill),fill='#34373a')
            if style=='Ribbon':draw.rectangle((x,y+height-6,end,y+height-3),fill='#394348')
            suite+=count
    img.save(out/('upper-'+style.lower()+'.jpg'),quality=86,subsampling=0)
