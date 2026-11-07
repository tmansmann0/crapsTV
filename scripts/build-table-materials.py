"""Casino PBR maps. Requires NumPy and Pillow. Wood derives from bundled CC0 Poly Haven scans.
Albedo PNGs are sRGB; normal/roughness PNGs are linear data (not gamma corrected).
Run: python scripts/build-table-materials.py
"""
from pathlib import Path
import json
import os
import tempfile
import numpy as np
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/assets'
OUT.mkdir(parents=True,exist_ok=True)
RANGES={}

def atomic_write(path, writer):
    """Publish a complete sibling file, keeping the old asset on failure."""
    path=Path(path)
    fd, temporary=tempfile.mkstemp(prefix=f'.{path.stem}-',suffix=path.suffix,dir=path.parent)
    os.close(fd)
    temporary=Path(temporary)
    try:
        writer(temporary)
        os.replace(temporary,path)
    finally:
        temporary.unlink(missing_ok=True)

def noise(w,h,gx,gy,seed):
    rng=np.random.default_rng(seed)
    grid=rng.random((gy,gx)).astype(np.float32)
    x=np.arange(w,dtype=np.float32)/w*gx;y=np.arange(h,dtype=np.float32)/h*gy
    ix=x.astype(int);iy=y.astype(int);tx=x-ix;ty=y-iy
    tx=tx*tx*(3-2*tx);ty=ty*ty*(3-2*ty)
    a=grid[iy[:,None]%gy,ix[None,:]%gx]*(1-tx)+grid[iy[:,None]%gy,(ix[None,:]+1)%gx]*tx
    b=grid[(iy[:,None]+1)%gy,ix[None,:]%gx]*(1-tx)+grid[(iy[:,None]+1)%gy,(ix[None,:]+1)%gx]*tx
    return a*(1-ty[:,None])+b*ty[:,None]

def save(name,data):
    data=np.clip(data,0,1)
    img=Image.fromarray(np.round(data*255).astype(np.uint8))
    if name=='material-table-walnut-albedo':
        atomic_write(OUT/(name+'.jpg'),lambda p: img.save(p,quality=94,subsampling=0,optimize=True))
        (OUT/(name+'.png')).unlink(missing_ok=True)
    else:atomic_write(OUT/(name+'.png'),lambda p: img.save(p,optimize=True))
    RANGES[name]={'file':name+('.jpg' if name=='material-table-walnut-albedo' else '.png'),'width':img.width,'height':img.height,'min':round(float(data.min()),4),'max':round(float(data.max()),4),'mean':round(float(data.mean()),4)}
    return img

def albedo(name,base,variation,tint=None):
    rgb=np.array(base,dtype=np.float32)/255
    out=rgb[None,None,:]*variation[:,:,None]
    if tint is not None:out+=tint
    return save(name,out)

def normal(name,height,world=.8):
    h,w=height.shape
    dx=(np.roll(height,-1,1)-np.roll(height,1,1))/(2*world/w)
    dy=(np.roll(height,-1,0)-np.roll(height,1,0))/(2*world/h)
    n=np.stack((-dx,-dy,np.ones_like(height)),axis=2)
    n/=np.linalg.norm(n,axis=2,keepdims=True)
    return save(name,n*.5+.5)

# Scanned, matched 2m wood tile from Poly Haven, stained to deeper walnut.
# Keep the photograph's grain/pore variation: only a per-channel stain multiplier.
source=ROOT/'assets/source/materials/dark-wood'
wood=np.asarray(Image.open(source/'dark_wood_diff_2k.jpg').convert('RGB'),dtype=np.float32)/255
save('material-table-walnut-albedo',wood*np.array([.76,.95,1.12]))
woodnormal=np.asarray(Image.open(source/'dark_wood_nor_gl_1k.png').convert('RGB'),dtype=np.float32)/255
save('material-table-walnut-normal',woodnormal)
woodrough=np.asarray(Image.open(source/'dark_wood_rough_1k.png').convert('L'),dtype=np.float32)/255
# A cured satin finish, retaining photographed grain-dependent roughness.
save('material-table-walnut-roughness',.29+.34*woodrough)

w,h=1024,512
leathercloud=noise(w,h,14,10,60)-.5
albedo('material-table-leather-albedo',(80,21,33),1+.13*leathercloud)
n=1024
pebble=noise(n,n,180,180,61)
seams=np.clip((.37-pebble)/.37,0,1)
leatherheight=pebble*.00032-seams*.00015+(noise(n,n,11,11,62)-.5)*.00005
normal('material-table-leather-normal',leatherheight)
save('material-table-leather-roughness',np.clip(.69+.055*seams+.018*(noise(n,n,9,9,63)-.5),.66,.77))

# Preserve the separately baked rubber pyramid normal. This colour/roughness
# pair only adds fine material variation to its existing UV1 .2 × .72 tile.
w,h=256,1024
rubbergrain=noise(w,h,70,250,70)-.5
albedo('material-table-rubber-albedo',(10,30,24),1+.06*rubbergrain)
save('material-table-rubber-roughness',np.clip(.88+.035*rubbergrain,.85,.91))

n=512
weave=(noise(n,n,130,160,80)-.5)*.035+(noise(n,n,7,7,81)-.5)*.06
albedo('material-table-felt-albedo',(17,64,47),1+weave)

brush=noise(n,n,4,400,90)-.5
albedo('material-table-brass-albedo',(168,128,66),1+.025*brush+.035*(noise(n,n,8,8,91)-.5))
normal('material-table-brass-normal',brush*.00009)
save('material-table-brass-roughness',np.clip(.53+brush*.04,.49,.57))

micro=noise(n,n,120,120,100)-.5
albedo('material-table-black-albedo',(8,16,14),1+.06*micro)
normal('material-table-black-normal',micro*.00008)
save('material-table-black-roughness',np.clip(.75+micro*.025,.72,.78))
atomic_write(OUT/'material-table-metadata.json',lambda p: p.write_text(json.dumps({'generated':'Scanned CC0 Poly Haven wood; original procedural other materials','woodSource':'https://polyhaven.com/a/dark_wood','woodLicense':'CC0-1.0','woodMapping':{'uvChannel':1,'tileSceneUnits':6,'repeat':[.8/6,.8/6],'albedoFormat':'JPEG quality94 subsampling0','normalScale':1.1,'clearcoat':.1,'clearcoatRoughness':.5,'environmentIntensity':.6},'normalConvention':'OpenGL +Y tangent-space','albedoColorSpace':'sRGB','dataColorSpace':'linear/NoColorSpace','roughnessScalar':1,'maps':RANGES},indent=2)+'\n',encoding='utf-8'))

# Readable proof sheet. It is not a material input.
labels=['walnut','leather','rubber','brass','black']
canvas=Image.new('RGB',(990,5*170),(237,231,216));draw=ImageDraw.Draw(canvas)
for row,label in enumerate(labels):
    draw.text((12,row*170+10),label.title(),fill=(30,42,34))
    for col,kind in enumerate(['albedo','normal','roughness']):
        p=OUT/f'material-table-{label}-{kind}.png'
        if label=='walnut' and kind=='albedo':p=p.with_suffix('.jpg')
        if not p.exists() and label=='rubber' and kind=='normal':p=OUT/'table-rubber-normal.png'
        if p.exists():
            im=Image.open(p).convert('RGB');im=im.resize((290,130))
            canvas.paste(im,(12+col*330,row*170+30))
            draw.text((12+col*330,row*170+153),kind,fill=(35,44,35))
atomic_write(OUT/'material-table-contact-sheet.png',lambda p: canvas.save(p))
print(json.dumps({'mapCount':len(RANGES),'roughnessMeans':{k:v['mean'] for k,v in RANGES.items() if 'roughness' in k}},indent=2))
