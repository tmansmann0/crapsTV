"""Periodic, packed micro-patina data for the original clay chip materials.

No source model or logo map is modified. R=handled grime, G=fine scuff traces,
B=burnished handling patches. Single linear 1024 atlas shared by every chip.
"""
from pathlib import Path
import hashlib, json, math
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
N=1024
y,x=np.mgrid[0:N,0:N].astype(np.float64)
u=(x+.5)/N;v=(y+.5)/N
rng=np.random.default_rng(20261107)
# Integer-frequency Fourier components tile exactly in both directions.
macro=np.zeros((N,N));fine=np.zeros_like(macro)
for k in range(22):
    a,b=rng.integers(1,12,2);phase=rng.uniform(0,math.tau)
    macro+=np.sin(math.tau*(a*u+b*v)+phase)/math.sqrt(22)
for k in range(12):
    a,b=rng.integers(35,180,2);phase=rng.uniform(0,math.tau)
    fine+=np.sin(math.tau*(a*u-b*v)+phase)/math.sqrt(12)
dirt=np.clip(.24+macro*.14+fine*.025,0,.85)
polish=np.clip(.35-macro*.14,0,.85)
scuff=np.zeros_like(macro)
for k in range(145):
    cx,cy=rng.uniform(0,1,2);angle=rng.uniform(0,math.tau)
    dx=(u-cx+.5)%1-.5;dy=(v-cy+.5)%1-.5
    along=dx*math.cos(angle)+dy*math.sin(angle)
    across=-dx*math.sin(angle)+dy*math.cos(angle)
    scuff+=np.exp(-(across/rng.uniform(.00035,.0009))**2-(along/rng.uniform(.006,.03))**6)*rng.uniform(.12,.52)
scuff=np.clip(scuff,0,1)
data=np.round(np.stack([dirt,scuff,polish],axis=2)*255).astype(np.uint8)
p=ROOT/'public/assets/chip-patina.png'
Image.fromarray(data).save(p,optimize=True)
(ROOT/'public/assets/chip-patina.json').write_text(json.dumps({
    'size':[N,N], 'seed':20261107, 'colorSpace':'linear',
    'channels':{'R':'periodic handled grime','G':'periodic fine scuff traces','B':'burnished patches'},
    'source':'Original deterministic procedural material data; no logo pixels or original model assets modified',
    'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),
    'channelRange':[[int(data[:,:,c].min()),int(data[:,:,c].max())] for c in range(3)],
},indent=2)+'\n')
print(p, p.stat().st_size)
