#!/usr/bin/env python3
"""Original vector craps layouts with continuous line lanes and dice pictograms."""
from pathlib import Path
import base64
import svgwrite
import cairosvg
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/assets'
GOLD,IVORY,GREEN='#b5a375','#efe8d3','#073a31'
SCALE=1588/1776
PIPS={1:[(0,0)],2:[(-1,-1),(1,1)],3:[(-1,-1),(0,0),(1,1)],4:[(-1,-1),(1,-1),(-1,1),(1,1)],5:[(-1,-1),(1,-1),(0,0),(-1,1),(1,1)]}

def make(mode):
 d=svgwrite.Drawing(str(OUT/f'board-{mode}.svg'),size=('2048px','1024px'),viewBox='0 0 2048 1024')
 d.set_desc(title=f'crapsTV {mode} felt',desc='Original wraparound pass lanes, hardway dice faces, and profit payouts. Surface fibers are supplied by a separate PBR normal map.')
 d.add(d.rect((0,0),(2048,1024),fill=GREEN,rx=160))
 d.add(d.rect((36,30),(1976,964),rx=138,fill='none',stroke=GOLD,stroke_width=1.4,opacity=.65))
 # Preserve wagering Y coordinates while making room for the continuous side lanes.
 inner=d.g(transform=f'translate({1024*(1-SCALE)},0) scale({SCALE},1)')
 d.add(inner)
 def txt(value,x,y,size=28,fill=IVORY,weight=500,tracking=1,target=inner):
  family='Georgia, Times New Roman, serif' if size>=30 else 'Arial, Helvetica, sans-serif'
  attrs={'transform':f'translate({x},0) scale({1/SCALE},1) translate({-x},0)'} if target is inner else {}
  target.add(d.text(value,insert=(x,y*.82),text_anchor='middle',font_family=family,font_size=size*.86,font_weight=min(weight,700),fill=fill,letter_spacing=tracking*.82,**attrs))
 def box(x,y,w,h,r=10,target=inner):
  target.add(d.rect((x,y*.82),(w,h*.82),rx=r,fill='none',stroke=GOLD,stroke_width=1.65))
 def die(x,y,value,size=30):
  cy=y*.82
  face=d.g(transform=f'translate({x},0) scale({1/SCALE},1) translate({-x},0)');inner.add(face)
  face.add(d.rect((x-size/2,cy-size/2),(size,size),rx=4,fill=IVORY,stroke=GOLD,stroke_width=1))
  for px,py in PIPS[value]: face.add(d.circle((x+px*size*.245,cy+py*size*.245),size*.071,fill=GREEN))
 def pair(x,y,total,size=30):
  die(x-size*.62,y,total//2,size);die(x+size*.62,y,total//2,size)
 # Actual transparent logo, embedded so SVG and PNG are self contained.
 logo='data:image/png;base64,'+base64.b64encode((OUT/'brand-logo.png').read_bytes()).decode()
 d.add(d.image(href=logo,insert=(879,9),size=(290,124)))
 txt('CRAPLESS CRAPS' if mode=='crapless' else 'CLASSIC CRAPS',1024,189,15,IVORY,600,5)
 txt('PLACE BETS',1024,220,17,GOLD,700,5)
 nums=[2,3,4,5,6,8,9,10,11,12] if mode=='crapless' else [4,5,6,8,9,10]
 ratios={2:'11:2',3:'11:4',4:'9:5',5:'7:5',6:'7:6',8:'7:6',9:'7:5',10:'9:5',11:'11:4',12:'11:2'}
 bw=1776/len(nums)
 for i,n in enumerate(nums):
  x=136+i*bw;box(x,242,bw,158,r=0)
  txt(str(n),x+bw/2,319,56,IVORY,700,0);txt(ratios[n],x+bw/2,369,20,GOLD,600,1)
 if mode=='classic':
  box(136,424,320,110);txt('DON’T COME',296,474,23,IVORY,700);txt('BAR 12',296,506,14,GOLD,600,2)
  box(136,548,320,246);txt('HARDWAYS',296,593,23,IVORY,700)
  for total,x,y,odds in [(4,216,650,'7:1'),(6,376,650,'9:1'),(8,216,738,'9:1'),(10,376,738,'7:1')]:
   pair(x,y,total);txt(odds,x,y+40,16,GOLD)
  center_x,center_w=476,1100
  box(1596,424,316,370);txt('ONE ROLL',1754,472,24,IVORY,700)
  for i,(label,odds) in enumerate([('ANY 7','4:1'),('ANY CRAPS','7:1'),('2 or 12','30:1'),('3 or 11','15:1')]):
   txt(label,1754,531+i*67,21,IVORY,600);txt(odds,1754,556+i*67,16,GOLD)
 else:
  center_x,center_w=136,1440
  box(1596,424,150,370);box(1762,424,150,370)
  txt('HARDWAYS',1671,467,16,IVORY,700,0);txt('ONE ROLL',1837,467,16,IVORY,700,0)
  for i,(total,odds) in enumerate([(4,'7:1'),(6,'9:1'),(8,'9:1'),(10,'7:1')]):
   pair(1671,524+i*67,total,25);txt(odds,1671,568+i*67,15,GOLD)
  for i,(label,odds) in enumerate([('ANY 7','4:1'),('CRAPS','7:1'),('2 / 12','30:1'),('3 / 11','15:1')]):
   txt(label,1837,529+i*67,16,IVORY,600,0);txt(odds,1837,551+i*67,15,GOLD)
 cx=center_x+center_w/2
 box(center_x,424,center_w,132);txt('COME',cx,507,65,IVORY,700,12)
 box(center_x,572,center_w,222);txt('FIELD',cx,623,27,IVORY,700,8)
 for i,n in enumerate([2,3,4,9,10,11,12]):
  x=center_x+center_w*(i+.5)/7
  if n in(2,12):inner.add(d.circle((x,677*.82),27,fill='none',stroke=GOLD,stroke_width=1.65))
  txt(str(n),x,690,34,IVORY,700,0)
 txt('2 PAYS DOUBLE  ·  12 PAYS TRIPLE',cx,750,17,GOLD,600,2)
 for x,n in [(720,6),(1320,8)]:
  box(x-100,762,200,32,5);txt(f'BIG {n} · 1:1',x,785,14,GOLD,600,1)
 # The line areas are single continuous U shapes, not disconnected boxes.
 path='M68 190 H126 V720 Q126 728 134 728 H1914 Q1922 728 1922 720 V190 H1980 V750 Q1980 786 1944 786 H104 Q68 786 68 750 Z' if mode=='classic' else 'M68 190 H195 V658 Q195 668 205 668 H1843 Q1853 668 1853 658 V190 H1980 V750 Q1980 786 1944 786 H104 Q68 786 68 750 Z'
 d.add(d.path(d=path,fill='none',stroke=GOLD,stroke_width=2))
 txt('PASS LINE',1024,932,32,IVORY,700,8,target=d)
 for x,angle in ([(99,-90),(1949,90)] if mode=='classic' else [(132,-90),(1917,90)]):
  t=d.text('PASS LINE',insert=(x,476),text_anchor='middle',font_family='Georgia, serif',font_size=25,font_weight=700,letter_spacing=4,fill=IVORY,transform=f'rotate({angle} {x} 476)');d.add(t)
 if mode=='classic':
  d.add(d.path(d='M145 195 H195 V660 Q195 668 203 668 H1845 Q1853 668 1853 660 V195 H1903 V683 Q1903 718 1868 718 H180 Q145 718 145 683 Z',fill='none',stroke=GOLD,stroke_width=1.7))
  txt('DON’T PASS BAR 12',1024,854,24,IVORY,600,4,target=d)
  for x,angle in [(170,-90),(1878,90)]:
   d.add(d.text('DON’T PASS · BAR 12',insert=(x,472),text_anchor='middle',font_family='Arial, sans-serif',font_size=17,letter_spacing=2,fill=IVORY,transform=f'rotate({angle} {x} 472)'))
 else:
  txt('7 WINS ON THE COME-OUT  ·  EVERY OTHER TOTAL BECOMES A POINT',1024,844,17,GOLD,600,2,target=d)
 d.save(pretty=True)
 cairosvg.svg2png(url=str(OUT/f'board-{mode}.svg'),write_to=str(OUT/f'board-{mode}.png'))
for mode in ('classic','crapless'):make(mode)
