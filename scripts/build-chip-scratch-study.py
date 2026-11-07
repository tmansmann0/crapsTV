"""Deterministic shared chip scratch atlas. Existing production chip maps stay intact.
RGBA: tangent-normal X/Y, exposed-clay scratch mask, abraded roughness mask.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/assets'
n=2048
rng=np.random.default_rng(83756)
scribe=Image.new('L',(n,n));draw=ImageDraw.Draw(scribe)
# Individual dragged chips leave short, mostly directional scoring, occasionally
# crossing older lines. Draw oversize, then antialias into the shared 1K atlas.
for i in range(310):
    x,y=rng.uniform(0,n,2)
    angle=rng.normal(-.33,.23) if i%4 else rng.uniform(.8,2.5)
    length=rng.uniform(18,160) if i%6 else rng.uniform(120,280)
    width=int(rng.choice([2,3,4,5,7],p=[.24,.28,.23,.18,.07]))
    endpoint=(x+np.cos(angle)*length,y+np.sin(angle)*length)
    shade=int(rng.uniform(95,245))
    # Periodic copies avoid a repeated seam after per-chip phase shifts.
    for dx in [-n,0,n]:
        for dy in [-n,0,n]:
            draw.line((x+dx,y+dy,endpoint[0]+dx,endpoint[1]+dy),fill=shade,width=width)
# Small clusters of edge rubs have parallel hairlines rather than brown patches.
abrasion=Image.new('L',(n,n));a=ImageDraw.Draw(abrasion)
for i in range(38):
    x,y=rng.uniform(0,n,2);angle=rng.uniform(-1,1);length=rng.uniform(25,100)
    for j in range(int(rng.integers(3,10))):
        off=j*rng.uniform(2,4)
        p=(x-np.sin(angle)*off,y+np.cos(angle)*off)
        q=(p[0]+np.cos(angle)*length,p[1]+np.sin(angle)*length)
        a.line((*p,*q),fill=int(rng.uniform(45,160)),width=int(rng.integers(2,5)))
mask=np.asarray(scribe.resize((1024,1024),Image.Resampling.LANCZOS),dtype=np.float32)/255
rub=np.asarray(abrasion.filter(ImageFilter.GaussianBlur(1)).resize((1024,1024),Image.Resampling.LANCZOS),dtype=np.float32)/255
# Scribed grooves and their softly raised clay lips share the same silhouette.
core=np.asarray(scribe.filter(ImageFilter.GaussianBlur(.75)).resize((1024,1024),Image.Resampling.LANCZOS),dtype=np.float32)/255
lip=np.asarray(scribe.filter(ImageFilter.GaussianBlur(3)).resize((1024,1024),Image.Resampling.LANCZOS),dtype=np.float32)/255
height=-core*.00048+lip*.00018-rub*.00008
step=.69/1024
dx=(np.roll(height,-1,1)-np.roll(height,1,1))/(2*step)
dy=(np.roll(height,-1,0)-np.roll(height,1,0))/(2*step)
normal=np.stack([-dx,-dy,np.ones_like(height)],axis=2);normal/=np.linalg.norm(normal,axis=2,keepdims=True)
packed=np.stack([normal[:,:,0]*.5+.5,normal[:,:,1]*.5+.5,np.maximum(mask,rub*.65),np.maximum(mask*.85,rub)],axis=2)
pixels=np.clip(np.round(packed*255),0,255).astype(np.uint8)
Image.fromarray(pixels).save(OUT/'chip-scratch-study.png',optimize=True)
metadata={'productionEnabled':True,'seed':83756,'width':1024,'height':1024,'channels':['Tangent normal X','Tangent normal Y','Exposed clay scratch / rub mask','Abraded roughness mask'],'normalConvention':'OpenGL tangent +Y','grooveDepthSceneUnits':.00048,'worldTileSceneUnits':.69,'directionalScores':310,'abrasionClusters':38,'coverageAboveQuarter':round(float((packed[:,:,2]>.25).mean()),5),'sharedTextureCount':1,'productionMapsChanged':False}
(OUT/'chip-scratch-study-metadata.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps(metadata))
