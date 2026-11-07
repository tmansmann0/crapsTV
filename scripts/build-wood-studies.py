"""Download CC0 matched walnut scans and bake dark furniture-finish candidates.

python3 scripts/build-wood-studies.py
Preview-only outputs; all existing game maps/models are retained unchanged.
"""
from pathlib import Path
import json,hashlib,subprocess,shutil
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'assets/source/materials/wood-studies';OUT=ROOT/'public/assets/wood-studies'
CANDIDATES={
 'american':{'asset':'american_walnut_veneer','tint':(.40,.18,.09),'roughness':(.26,.25)},
 'smoked':{'asset':'smoked_walnut_veneer','tint':(.16,.105,.065),'roughness':(.25,.23)},
 'natural':{'asset':'natural_walnut_veneer','tint':(.23,.13,.075),'roughness':(.27,.24)},
}

def linear(a):return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)
def srgb(a):return np.where(a<=.0031308,a*12.92,1.055*np.maximum(a,0)**(1/2.4)-.055)
def fetch(url,p):
 if not p.exists():subprocess.run(['curl','-sSL','--fail','-A','crapsTV-material-study/0.12.0 (local game development)',url,'-o',str(p)],check=True)
 return p.read_bytes()
manifest={'license':'CC0-1.0','licenseUrl':'https://polyhaven.com/license','date':'2026-11-07',
  'sceneUnitsPerMetre':3.6,'modelAndUVUnchanged':True,'candidates':{},
  'preservedRuntimeWoodSha256':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest()
    for p in sorted((ROOT/'public/assets').glob('material-table-walnut-*'))}}
for id,spec in CANDIDATES.items():
 folder=SOURCE/id;folder.mkdir(parents=True,exist_ok=True);target=OUT/id;target.mkdir(parents=True,exist_ok=True)
 asset=spec['asset']
 info=json.loads(fetch(f'https://api.polyhaven.com/info/{asset}',folder/'info.json'))
 catalog=json.loads(fetch(f'https://api.polyhaven.com/files/{asset}',folder/'files.json'))
 files={}
 for key,role,res,ext in [('Diffuse','albedo','2k','jpg'),('nor_gl','normal','2k','png'),('Rough','roughness','1k','png'),('AO','ao','1k','png')]:
  entry=catalog[key][res][ext];file=folder/f'{role}-{res}.{ext}'
  data=fetch(entry['url'],file)
  assert hashlib.md5(data).hexdigest()==entry['md5']
  files[role]={'source':entry['url'],'file':str(file.relative_to(ROOT)),'sha256':hashlib.sha256(data).hexdigest()}
  image=Image.open(file)
  raw=np.asarray(image)
  # Poly Haven scalar PNGs are 16-bit. Pillow convert('RGB') clips integer
  # values above 255 instead of normalizing them, destroying roughness/AO.
  denominator=65535 if raw.dtype.itemsize>1 else 255
  a=raw.astype(float)/denominator
  if a.ndim==2:a=np.repeat(a[:,:,None],3,axis=2)
  elif a.shape[2]>3:a=a[:,:,:3]

  if role=='albedo':
   # Transparent dark stain multiplies actual photographed linear reflectance;
   # this retains fine colour variation without inventing dark printed streaks.
   a=srgb(linear(a)*np.array(spec['tint']))
  elif role=='roughness':
   # Fine-pore substrate below an independent smooth, thin varnish layer.
   a=spec['roughness'][0]+a*spec['roughness'][1]
  image=Image.fromarray(np.uint8(np.clip(a*255+.5,0,255)))
  output=target/(role+('.jpg' if role=='albedo' else '.png'))
  if role=='albedo':image.save(output,quality=96,subsampling=0,optimize=True)
  else:image.save(output,optimize=True)
  files[role].update({'runtime':str(output.relative_to(ROOT)),'runtimeSha256':hashlib.sha256(output.read_bytes()).hexdigest(),
     'width':image.width,'height':image.height,'meanRGB':np.mean(a,axis=(0,1)).tolist(),'min':float(a.min()),'max':float(a.max())})
 manifest['candidates'][id]={'asset':asset,'source':f'https://polyhaven.com/a/{asset}',
   'name':info['name'],'authors':info['authors'],'scanDimensionsMillimetres':info['dimensions'],
   'physicalTileWorldUnits':3.6,'stainLinearTransmittance':spec['tint'],'substrateRoughnessTransform':spec['roughness'],
   'files':files}
(SOURCE/'provenance.json').write_text(json.dumps(manifest,indent=2)+'\n')
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({id:{r:v['meanRGB'] for r,v in s['files'].items()}for id,s in manifest['candidates'].items()},indent=2))
