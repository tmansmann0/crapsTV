"""Derive a monochrome engraved mark directly from the actual brand PNG.
No font substitution or generated artwork. Requires NumPy/Pillow.
"""
from pathlib import Path
import hashlib,json,os,tempfile,argparse
import numpy as np
from PIL import Image,ImageFilter
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'public/assets'
parser=argparse.ArgumentParser()
parser.add_argument('--size',type=int,choices=[1024,2048],default=2048)
parser.add_argument('--rough-size',type=int,choices=[512,1024,2048],default=1024)
args=parser.parse_args();N=args.size;ROUGH_N=args.rough_size
source=OUT/'brand-logo.png';im=Image.open(source).convert('RGBA');a=np.asarray(im,dtype=np.float32)/255
# Gold/ivory logo artwork becomes the cut, while the burgundy backing and
# original dark die pips/counters stay uncut. Preserve photographed edge alpha.
luma=a[:,:,0].astype(np.float64)*.2126+a[:,:,1].astype(np.float64)*.7152+a[:,:,2].astype(np.float64)*.0722;t=np.clip((luma-.24)/.20,0,1)
mask=a[:,:,3]*t*t*(3-2*t)
bbox=Image.fromarray((a[:,:,3]*255).astype('uint8')).getbbox();mask=mask[bbox[1]:bbox[3],bbox[0]:bbox[2]]
mark=Image.fromarray(np.uint8(np.clip(mask*255,0,255)))
def atomic_image(name,image):
    fd,temp=tempfile.mkstemp(suffix='.png',dir=OUT);os.close(fd)
    try:image.save(temp,optimize=True);os.replace(temp,OUT/name)
    finally:
        if os.path.exists(temp):os.unlink(temp)
white=Image.new('RGBA',mark.size,(255,255,255,0));white.putalpha(mark);atomic_image('chip-logo-mark.png',white)
y,x=np.mgrid[:N,:N].astype(np.float32);u=(x+.5)/N;v=1-(y+.5)/N
# Same atlas as original chip: source Blender UV front/back .25/.75,.37.
# glTF/PNG V is inverted; row centers are .25/.75,.63 in the actual files.
ink=np.zeros((N,N),dtype=np.float32);width=.56;height=width*mark.height/mark.width
for center in (.25,.75):
    sx=(u-center)/.45;sy=(v-.37)/.45
    tx=(sx/width+.5)*(mark.width-1);ty=(.5-sy/height)*(mark.height-1)
    valid=(tx>=0)&(tx<mark.width-1)&(ty>=0)&(ty<mark.height-1)
    ix=np.clip(tx.astype(int),0,mark.width-2);iy=np.clip(ty.astype(int),0,mark.height-2)
    fx=tx-ix;fy=ty-iy
    cut=mask[iy,ix]*(1-fx)*(1-fy)+mask[iy,ix+1]*fx*(1-fy)+mask[iy+1,ix]*(1-fx)*fy+mask[iy+1,ix+1]*fx*fy
    ink=np.maximum(ink,np.where(valid,cut,0))
# A shallow, rounded stamp in the clay: not raised gold printing or a decal.
soft=np.asarray(Image.fromarray(np.uint8(ink*255)).filter(ImageFilter.GaussianBlur(1.2*N/1024)),dtype=np.float32)/255
rng=np.random.default_rng(308119);micro=rng.normal(0,.000014,(N,N)).astype(np.float32)
relief=-.0032*soft+micro
# Standard OpenGL (+Y) data; PNG rows run down while source UV V runs up.
gy,gx=np.gradient(relief,1/(N*.45));normal=np.stack((-gx,gy,np.ones_like(gx)),2);normal/=np.linalg.norm(normal,axis=2,keepdims=True)
normal=np.clip(normal*.5+.5,0,1)
base=np.array([.79,.73,.60]);color=base[None,None,:]*(1-.56*soft[:,:,None]);color*=1+rng.normal(0,.008,(N,N,1))
rough_rng=np.random.default_rng(308121)
rough_soft=np.asarray(Image.fromarray(np.uint8(soft*255)).resize((ROUGH_N,ROUGH_N),Image.Resampling.LANCZOS),dtype=np.float32)/255
rough=np.clip(.62+.07*rough_soft+rough_rng.normal(0,.01,(ROUGH_N,ROUGH_N)),.58,.74)
for name,data in [('albedo',color),('normal',normal),('roughness',rough),('height',.5+relief/.008)]:
    atomic_image(f'chip-logo-{name}.png',Image.fromarray(np.uint8(np.clip(data,0,1)*255)))
meta={'version':1,'source':'brand-logo.png','sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sourceCrop':bbox,'maskMethod':'Original alpha times smooth threshold of original gold/ivory luminance; burgundy backing excluded, original wordmark/dice/counters preserved','generatedArtwork':False,'atlasSize':[N,N],'mapSizes':{k:[ROUGH_N,ROUGH_N] if k=='roughness' else [N,N] for k in ['albedo','normal','roughness','height']},'bevelBlurPixels':1.2*N/1024,'bevelReference':{'pixels':1.2,'atlasSize':1024},'logoSceneWidth':width,'logoSceneHeight':height,'cutDepth':.0032,'sourceBlenderUV':{'front':[.25,.37],'back':[.75,.37],'radius':.225},'pngCenters':{'front':[.25,.63],'back':[.75,.63]},'backUV':'Back local Y is reflected before export, making text upright when the chip flips about X','normalConvention':'OpenGL +Y','mapFiles':{k:f'chip-logo-{k}.png' for k in ['albedo','normal','roughness','height','mark']}}
(OUT/'chip-logo-atlas.json').write_text(json.dumps(meta,indent=2)+'\n')
print(json.dumps(meta,indent=2))
