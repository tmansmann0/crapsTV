import * as T from 'three';
import {loopWeights} from './presets.js';

// Core glTF can animate node transforms but cannot key a canvas texture.
// Hold one textured head at a time on the existing head bone. STEP tracks
// survive Blender import and also work in ordinary glTF animation players.
function snapshotMesh(source,image,limit,resources){
  const geometry=source.geometry.clone();
  geometry.deleteAttribute('skinIndex');geometry.deleteAttribute('skinWeight');
  const material=source.material.clone(),canvas=document.createElement('canvas');
  const scale=Math.min(1,limit/Math.max(image.width,image.height));
  canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  const texture=material.map.clone();texture.source=new T.Source(canvas);texture.needsUpdate=true;
  material.map=texture;resources.push(geometry,material,texture);
  return new T.Mesh(geometry,material);
}
export function bakeFacialLoop({copy,head,symbols,row,atlas,loop,name,strength,bodyClip,sample,restore,resources}){
  const mount=copy.getObjectByName('DentalMount'),oldHead=copy.getObjectByName('PortraitHead');
  oldHead.removeFromParent();copy.getObjectByName('DentalRow')?.removeFromParent();
  const duration=loop.duration,count=Math.max(20,Math.min(48,Math.round(duration*12)));
  const tracks=bodyClip?bodyClip.tracks.map(track=>track.clone()):[];
  const movingSymbols=symbols.children.filter(o=>o.visible).map(o=>({o,positions:[],rotations:[],scales:[]}));
  const symbolTimes=[];
  try{
    for(let i=0;i<count;i++){
      sample(loopWeights(name,i/count,strength));
      symbolTimes.push(duration*i/count);
      for(const {o,positions,rotations,scales} of movingSymbols){
        positions.push(...o.position.toArray());rotations.push(...o.quaternion.toArray());scales.push(...o.scale.toArray());
      }
      const frame=new T.Group();frame.name='FaceFrame_'+String(i+1).padStart(2,'0');
      const face=snapshotMesh(head,atlas,768,resources);
      face.name=i?'PortraitFrame_'+i:'PortraitHead';
      frame.add(face);
      if(row.visible){
        const dental=snapshotMesh(row,row.material.map.image,512,resources);
        dental.name=i?'DentalFrame_'+i:'DentalRow';dental.position.copy(row.position);frame.add(dental);
      }
      mount.add(frame);frame.scale.setScalar(i===0?1:0);
      const times=[0],values=[i===0?1:0];
      if(i){times.push(duration*i/count);values.push(1);}
      if(i+1<count){times.push(duration*(i+1)/count);values.push(0);}
      times.push(duration);values.push(i===0?1:0);
      tracks.push(new T.VectorKeyframeTrack(frame.name+'.scale',times,values.flatMap(value=>[value,value,value]),T.InterpolateDiscrete));
    }
  }finally{restore();}
  symbolTimes.push(duration);
  for(const {o,positions,rotations,scales} of movingSymbols){
    positions.push(...positions.slice(0,3));rotations.push(...rotations.slice(0,4));scales.push(...scales.slice(0,3));
    tracks.push(new T.VectorKeyframeTrack(o.name+'.position',symbolTimes,positions),
      new T.QuaternionKeyframeTrack(o.name+'.quaternion',symbolTimes,rotations),
      new T.VectorKeyframeTrack(o.name+'.scale',symbolTimes,scales));
  }
  return new T.AnimationClip((bodyClip?'Full-body loop - ':'Facial loop - ')+name,duration,tracks);
}
