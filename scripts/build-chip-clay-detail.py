"""Rebake original clay grain/scuffs without concentric paint or machining ripples.
Matches the original 512px procedural seeds and physical scratch distribution.
Original chip GLBs/Blender sources remain unchanged; active logo-chip maps update.
"""
from pathlib import Path
import json,math,hashlib
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'public/assets';N=512
y,x=np.mgrid[0:N,0:N].astype(np.float32);u=(x+.5)/N;v=(y+.5)/N
rad1=np.sqrt((u-.25)**2+(v-.37)**2)/.225;rad2=np.sqrt((u-.75)**2+(v-.37)**2)/.225
surface=(rad1<1.015)|(rad2<1.015)|(v>.79)
def save(name,data):
    # Blender's source pixel buffer runs bottom-to-top; PNG arrays run down.
    values=np.flipud(np.clip(np.round(data*255),0,255).astype(np.uint8))
    Image.fromarray(values).save(OUT/(name+'.png'),optimize=True)
rng=np.random.default_rng(801);grain=rng.normal(0,.010,(N,N))
albedo=np.where(surface,np.clip(.92+grain,.80,.97),.92)
save('chip-color',np.repeat(albedo[:,:,None],3,axis=2))
for variant,seed in enumerate([913,721,406],1):
    rng=np.random.default_rng(seed);h=rng.normal(0,.007,(N,N)).astype(np.float32)
    h+=.010*np.sin(2*np.pi*(u*41+v*7))
    # Directional clay handling scars stay; no sin(radius*340) machine rings.
    for k in range(32+variant*8):
        cx=rng.uniform(.03,.97);cy=rng.uniform(.07,.75);theta=rng.uniform(0,2*math.pi);length=rng.uniform(.018,.09)
        along=(u-cx)*math.cos(theta)+(v-cy)*math.sin(theta);across=-(u-cx)*math.sin(theta)+(v-cy)*math.cos(theta)
        h-=np.exp(-(across/.0017)**2-(along/length)**6)*rng.uniform(.018,.055)
    side=.010*np.sin(2*np.pi*(u*33+v*11))+.009*np.sin(2*np.pi*(u*57-v*17))
    for k in range(22):
        cx=rng.uniform(0,1);cy=rng.uniform(.80,.98);du=(u-cx+.5)%1-.5
        side-=np.exp(-(du/.0022)**2-((v-cy)/.028)**4)*.035
    h=np.clip(np.where(v>.79,side,h),-.14,.09)
    gy,gx=np.gradient(h);normal=np.stack([-gx*8,-gy*8,np.ones_like(h)],axis=2);normal/=np.linalg.norm(normal,axis=2,keepdims=True)
    save(f'chip-normal-{variant}',normal*.5+.5)
    rough=np.clip(.54+np.abs(h)*2.4+rng.normal(0,.018,(N,N)),.40,.86)
    save(f'chip-roughness-{variant}',np.repeat(rough[:,:,None],3,axis=2))
    save(f'chip-wear-{variant}',np.repeat((.5+h)[:,:,None],3,axis=2))
meta={'version':1,'size':[N,N],'seeds':[801,913,721,406],'removed':['Painted radial guide circles .75/.82','Circular sin(radius*340) normal/roughness machining ripple'],'preserved':['Geometry profiles and real brass rings','Directional handling scuffs','Clay grain','Side wear','Selected dirt .87 / clear scratches strength2']}
(OUT/'chip-clay-detail.json').write_text(json.dumps(meta,indent=2)+'\n');print(json.dumps(meta))
