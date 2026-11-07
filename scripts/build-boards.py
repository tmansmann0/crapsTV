#!/usr/bin/env python3
"""Original editable vector felt layouts. Requires svgwrite and cairosvg."""
from pathlib import Path
import svgwrite

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/assets'
OUT.mkdir(parents=True, exist_ok=True)
GOLD, IVORY, GREEN = '#ccab67', '#f9ecd0', '#075247'

def make(mode):
    d = svgwrite.Drawing(str(OUT / f'board-{mode}.svg'), size=('2048px', '1024px'), viewBox='0 0 2048 1024')
    d.set_desc(title=f'crapsTV — {mode} felt', desc='Original vector artwork. Flat table texture, read from the shooter side. Rules printed are profit payouts. Play money only.')
    d.add(d.rect((0,0),(2048,1024),fill=GREEN,rx=160))
    # A restrained woven pattern remains crisp at table-texture scale.
    pattern = d.pattern(id='weave', insert=(0,0), size=(12,12), patternUnits='userSpaceOnUse')
    pattern.add(d.path(d='M0,0 L12,12 M-6,6 L6,18 M6,-6 L18,6', stroke='#a2d7bd', stroke_width=.45, opacity=.055))
    d.defs.add(pattern)
    d.add(d.rect((0,0),(2048,1024),fill='url(#weave)',rx=160))
    def txt(value,x,y,size=28,fill=IVORY,weight=500,tracking=1):
        d.add(d.text(value,insert=(x,y),text_anchor='middle',font_family='Arial, Helvetica, sans-serif',font_size=size,font_weight=weight,fill=fill,letter_spacing=tracking))
    def box(x,y,w,h,r=12,stroke=GOLD,fill='none',sw=3):
        d.add(d.rect((x,y),(w,h),rx=r,fill=fill,stroke=stroke,stroke_width=sw))
    box(44,42,1960,940,140,sw=3)
    box(60,58,1928,908,128,sw=1)
    txt('crapsTV',1024,124,46,GOLD,800,-1)
    txt('CRAPLESS CRAPS' if mode=='crapless' else 'CLASSIC CRAPS',1024,164,16,IVORY,600,6)
    nums=[2,3,4,5,6,8,9,10,11,12] if mode=='crapless' else [4,5,6,8,9,10]
    ratios={2:'11:2',3:'11:4',4:'9:5',5:'7:5',6:'7:6',8:'7:6',9:'7:5',10:'9:5',11:'11:4',12:'11:2'}
    left,width=136,1776
    bw=width/len(nums)
    txt('PLACE BETS',1024,220,17,GOLD,700,5)
    for i,n in enumerate(nums):
        x=left+i*bw
        box(x,242,bw,158,r=0)
        txt(str(n),x+bw/2,319,56,IVORY,800,0)
        txt(ratios[n],x+bw/2,369,20,GOLD,600,1)
    # Contract-bet area. Crapless does not offer the don't side.
    if mode=='classic':
        box(136,424,320,110)
        txt("DON’T COME",296,474,23,IVORY,700)
        txt('BAR 12',296,506,14,GOLD,600,2)
        box(136,548,320,246)
        txt('HARDWAYS',296,598,24,IVORY,700)
        for n,x,y,odds in [(4,216,662,'7:1'),(6,376,662,'9:1'),(8,216,749,'9:1'),(10,376,749,'7:1')]:
            txt(str(n),x,y-15,30,IVORY,800)
            txt(odds,x,y+14,17,GOLD)
        center_x,center_w=476,1100
        box(1596,424,316,370)
        txt('ONE ROLL',1754,472,24,IVORY,700)
        for i,(label,odds) in enumerate([('ANY 7','4:1'),('ANY CRAPS','7:1'),('2 or 12','30:1'),('3 or 11','15:1')]):
            txt(label,1754,531+i*67,21,IVORY,600)
            txt(odds,1754,556+i*67,16,GOLD)
    else:
        center_x,center_w=136,1440
        box(1596,424,316,370)
        txt('HARDWAYS',1754,472,24,IVORY,700)
        for i,(label,odds) in enumerate([('HARD 4','7:1'),('HARD 6','9:1'),('HARD 8','9:1'),('HARD 10','7:1')]):
            txt(label,1754,531+i*67,21,IVORY,600)
            txt(odds,1754,556+i*67,16,GOLD)
    cx=center_x+center_w/2
    box(center_x,424,center_w,132)
    txt('COME',cx,507,65,IVORY,800,12)
    box(center_x,572,center_w,222)
    txt('FIELD',cx,623,27,IVORY,700,8)
    fieldnums=[2,3,4,9,10,11,12]
    for i,n in enumerate(fieldnums):
        x=center_x+center_w*(i+.5)/len(fieldnums)
        if n in (2,12):
            d.add(d.circle((x,677),33,fill='none',stroke=GOLD,stroke_width=2))
        txt(str(n),x,690,34,IVORY,800,0)
    txt('2 PAYS DOUBLE  ·  12 PAYS TRIPLE',cx,753,17,GOLD,600,2)
    if mode=='classic':
        box(136,816,1776,60)
        txt('DON’T PASS BAR 12',1024,856,25,IVORY,700,5)
        box(136,890,1776,60)
        txt('PASS LINE',1024,933,32,IVORY,800,8)
    else:
        box(136,816,1776,134)
        txt('PASS LINE',1024,879,43,IVORY,800,8)
        txt('7 WINS ON THE COME-OUT  ·  EVERY OTHER TOTAL BECOMES A POINT',1024,923,16,GOLD,600,2)
    d.save(pretty=True)
    # PNG is a convenient fallback for engines without SVG decoding.
    import cairosvg
    cairosvg.svg2png(url=str(OUT / f'board-{mode}.svg'),write_to=str(OUT / f'board-{mode}.png'))

for mode in ('classic','crapless'):
    make(mode)
