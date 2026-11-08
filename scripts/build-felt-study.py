"""Preview-only matted wool fibre atlas. Requires numpy/Pillow; no model edits."""
from pathlib import Path
import hashlib,json
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/assets/felt-studies';OUT.mkdir(parents=True,exist_ok=True)
N=1024;rng=np.random.default_rng(735901)
height=np.zeros((N,N),dtype=np.float64)
coverage=np.zeros_like(height)
# Short gently curved fibres have random azimuth: no woven rows or diagonal bands.
for _ in range(19000):
 x,y=rng.uniform(0,N,2);angle=rng.uniform(0,2*np.pi)
 length=rng.uniform(3,21);bend=rng.uniform(-.5,.5);weight=rng.uniform(.25,1)
 for t in np.linspace(0,1,max(7,int(length*1.5))):
  px=x+np.cos(angle)*length*t-np.sin(angle)*bend*length*np.sin(np.pi*t)
  py=y+np.sin(angle)*length*t+np.cos(angle)*bend*length*np.sin(np.pi*t)
  for ox in (-1,0,1):
   for oy in (-1,0,1):
    ix,iy=int(px)+ox,int(py)+oy
    b=np.exp(-((px-ix)**2+(py-iy)**2)/.7)*weight*np.sin(np.pi*t)**.4
    height[iy%N,ix%N]+=b
    coverage[iy%N,ix%N]=max(coverage[iy%N,ix%N],b)
def noise(scale):
 f=np.fft.fftfreq(N);x,y=np.meshgrid(f,f)
 a=np.fft.ifft2(np.fft.fft2(rng.normal(size=(N,N)))*np.exp(-(x*x+y*y)/(scale*scale))).real
 return (a-a.mean())/a.std()
height=(height-height.mean())/height.std()
height=height*.11+noise(.023)*.035+noise(.31)*.013
dx=(np.roll(height,-1,1)-np.roll(height,1,1))*.5
dy=(np.roll(height,-1,0)-np.roll(height,1,0))*.5
normal=np.stack((-dx,-dy,np.ones_like(height)),axis=2)
normal/=np.linalg.norm(normal,axis=2,keepdims=True)
# RG are tangent normal XY, B fine coverage/nap, A broad matted nap variation.
atlas=np.dstack((normal[:,:,:2]*.5+.5,np.clip(coverage,0,1),np.clip(.5+noise(.018)*.14,.05,.95)))
pixels=np.uint8(np.clip(atlas*255+.5,0,255))
path=OUT/'wool-fibres.png';Image.fromarray(pixels,'RGBA').save(path,optimize=True)
meta={'previewOnly':False,'selected':'B material only; no strand geometry','generator':'scripts/build-felt-study.py','seed':735901,
 'size':[N,N],'channels':['normalX','normalY','fibreCoverage','mattedNap'],
 'fibres':19000,'directions':'uniform random azimuth; gently curved short fibres',
 'runtimeSampling':'three independently rotated/offset samples at incommensurate scales plus broad world-space nap',
 'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size,
 'physicalDisplacement':False,'geometryAdded':False}
(OUT/'metadata.json').write_text(json.dumps(meta,indent=2)+'\n')
print(json.dumps(meta))
