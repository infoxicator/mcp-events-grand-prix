"""Build source-frame comparison sheets and quantitative checks from the optics captures."""
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path("artifacts/optics-review")
AFTER = ROOT / "after"
STAGES = ("before", "after")
FONT = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 17)


def frame(stage, name):
    return Image.open(ROOT / stage / (name + ".jpg")).convert("RGB")


def sheet(name, images, cols, width, height):
    rows = (len(images) + cols - 1) // cols
    page = Image.new("RGB", (cols * width, rows * (height + 31)), "#17191c")
    draw = ImageDraw.Draw(page)
    for i, (label, img) in enumerate(images):
        x, y = (i % cols) * width, (i // cols) * (height + 31)
        img = ImageOps.contain(img, (width, height))
        page.paste(img, (x + (width - img.width) // 2, y))
        draw.text((x+8, y+height+4), label, fill="white", font=FONT)
    page.save(ROOT / (name + ".jpg"), quality=95)


def json_view(path):
    return json.loads(path.read_text())


stats = {"shoulderPercent": {}, "loadedPeaks": {}, "projectedWidths": {}}
for seat in "ab":
    for stage in STAGES:
        percents = []
        for f in (60, 120, 180):
            crop = frame(stage, f"{seat}-onboard-{f}").crop((60, 603, 152, 629))
            count = sum(min(rgb) >= 230 for rgb in crop.getdata())
            percents.append(round(100 * count / (crop.width * crop.height), 2))
        stats["shoulderPercent"][seat + "-" + stage] = percents
    sheet(("mercedes" if seat == "b" else "ferrari") + "-light-peak",
          [(stage + "  /  " + view, frame(stage, seat+"-"+view+"-120"))
           for view in ("onboard", "exterior") for stage in STAGES], 2, 800, 450)

sheet("markings", [(stage + "  /  Monza  f101", frame(stage, "front-101").crop(rect))
                   for rect in ((875,435,1100,586),(1055,690,1315,872)) for stage in STAGES], 2, 520, 320)
sheet("corridors", [(stage + "  /  " + circuit, frame(stage, circuit+"-110"))
                    for circuit in ("monza", "las-vegas") for stage in STAGES], 2, 800, 450)

# Keep unlabelled greyscale at the original pixel scale for the identification check.
for stage in STAGES:
    for name in ("launch-30", "rear-pack-30"):
        ImageOps.grayscale(frame(stage, name)).save(ROOT / stage / (name+"-grey.png"))
projections = json_view(AFTER / "rear-monza-a.json")["stills"]["rear-pack-30"]["projected"]
cars = [(13,"Colapinto"), (14,"Lindblad"), (15,"Bortoleto")]
tiles = []
for stage in STAGES:
    img = ImageOps.grayscale(frame(stage,"rear-pack-30"))
    for i, driver in cars:
        bounds = projections[i]
        w = bounds["right"] - bounds["left"]
        stats["projectedWidths"][driver] = w
        crop = img.crop((bounds["left"]-4,bounds["top"]-4,bounds["right"]+4,bounds["bottom"]+4))
        tiles.append((f"{stage}  /  {driver}  /  {w}px",crop.resize((crop.width*3,crop.height*3), Image.Resampling.NEAREST)))
sheet("overlap",tiles,3,380,205)

transitions = json_view(AFTER / "field-monza-a.json")["stills"]
tiles = []
for f in (144,145,230,231):
    name = f"transition-{f}"
    v = transitions[name]["projected"][0]
    x,y = (v["left"]+v["right"])//2,(v["top"]+v["bottom"])//2
    tiles.append((f"Antonelli   /   frame {f}",frame("after",name).crop((x-160,y-96,x+160,y+96))))
sheet("lod-crossings",tiles,2,320,192)

for seat in "ab":
    tiles = []
    for camera in ("cockpit","tcam"):
        trace = json_view(AFTER / f"{seat}-{camera}-trace.json")
        peaks = [("left",min(trace,key=lambda v:v["steer"])),("right",max(trace,key=lambda v:v["steer"])),
                 ("kerb",max(trace,key=lambda v:v["kerb"]))]
        stats["loadedPeaks"][seat+"-"+camera] = dict(peaks)
        for label, peak in peaks:
            dest = AFTER / f"{seat}-{camera}-{label}.jpg"
            subprocess.run(["ffmpeg","-loglevel","error","-y","-i",str(AFTER/f"{seat}-{camera}.mp4"),
                            "-vf",f"select=eq(n\\,{peak['f']})","-frames:v","1","-q:v","2",str(dest)], check=True)
            tiles.append((f"{camera}  /  {label}  /  f{peak['f']}",Image.open(dest)))
    sheet(seat+"-under-load",tiles,3,460,259)
# Plot quantities from the actual simulation snapshots used for the two films.
chart = Image.new("RGB",(1110,390),"#16191e")
pen = ImageDraw.Draw(chart)
for row,(key,label,limit) in enumerate([("steer","Road wheel (rad)",.45),("g","Lateral load (g)",5.5)]):
    top = 35+row*160
    pen.text((15,top+47),label,font=FONT,fill="white")
    pen.line((190,top+68,1070,top+68),fill="#5c636b")
    for seat,colour,number in [("a","#fa796f","44"),("b","#68cdd0","63")]:
        rows = json_view(AFTER/f"{seat}-cockpit-trace.json")
        points = [(190+880*r["f"]/200,top+68-60*r[key]/limit) for r in rows]
        pen.line(points,fill=colour,width=2)
        if row==0:
            pen.text((750+(0 if seat=="a" else 145),5),"#"+number,font=FONT,fill=colour)
    pen.text((190,top+118),"0 s",font=FONT,fill="#c7cbd2")
    pen.text((1025,top+118),"6.67 s",font=FONT,fill="#c7cbd2")
chart.save(ROOT/"loaded-traces.png")
(ROOT / "readouts.json").write_text(json.dumps(stats, indent=2)+"\n")
