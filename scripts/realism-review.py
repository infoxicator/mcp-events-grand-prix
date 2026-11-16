from pathlib import Path
from html import escape
import json
r=Path(__file__).resolve().parents[1]/'artifacts/realism-v2'
parts=['''<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:var(--font-sans);color:var(--foreground)}section{margin:0 0 22px}img{display:block;width:100%;height:auto;border-radius:var(--radius)}summary{cursor:pointer;padding:10px 0;font-weight:600}pre{max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-all;padding:16px;background:var(--code-background);border-radius:var(--radius);font:11px var(--font-mono)}button{font:inherit;background:var(--secondary);color:var(--foreground);border:1px solid var(--border);border-radius:var(--radius);padding:8px 12px;margin:8px 8px 8px 0;cursor:pointer}p{color:var(--muted-foreground);font-size:13px;line-height:1.5}.compare{margin:18px 0}textarea{width:100%;min-height:120px;font:11px var(--font-mono);background:var(--code-background);color:var(--foreground);border:1px solid var(--border);word-break:break-all}a{color:var(--primary)}
</style></head><body>''']
for name,label in [('a-before','A · Before — preserved 5ce603c captures'),('b-after','B · After — chase, onboard, front and rear'),('c-details','C · Details — side, wheel, Clay and Wireframe')]:
 file=f'sheet-{name}.jpg';b64=(r/f'sheet-{name}.base64.txt').read_text().strip();ident=name
 parts.append(f'<section><strong>{label}</strong><img src="{r/file}" alt="{label}"><p>1200 × 560 · JPEG quality 60 · {len(b64):,} base64 characters. Each block decodes directly to its named JPEG.</p><details><summary>{file} — complete base64 fenced block</summary><button data-copy="{ident}">Copy raw base64</button><button data-select="{ident}">Select base64</button><pre>```{file}\n{b64}\n```</pre><textarea id="{ident}" readonly hidden>{b64}</textarea><span id="status-{ident}"></span></details></section>')
for name,label in [('comparison-front.png','Front comparison / reference 00:01'),('comparison-wheel.png','Wheel comparison / reference 00:04.25'),('comparison-steering.png','Steering comparison / reference 00:05.25'),('cockpit-onboard.png','Full onboard capture'),('rear-three-quarter.png','Rear wing, beam wing and diffuser')]:
 parts.append(f'<details class="compare"><summary>{label}</summary><img src="{r/name}" alt="{label}"></details>')
parts.append('''<script>document.querySelectorAll('[data-copy],[data-select]').forEach(b=>b.onclick=async()=>{const id=b.dataset.copy||b.dataset.select,t=document.getElementById(id),s=document.getElementById('status-'+id);if(b.dataset.copy){try{await navigator.clipboard.writeText(t.value);s.textContent='Copied';return}catch{}}t.hidden=false;t.focus();t.select();s.textContent='Selected — press Ctrl+C / ⌘C';});</script></body></html>''')
(r/'remote-review.html').write_text(''.join(parts))
print(r/'remote-review.html')
