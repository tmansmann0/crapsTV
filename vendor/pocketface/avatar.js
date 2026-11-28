import * as THREE from 'three';
import {bakeFacialLoop} from './export-expression.js';
import {presets,playbackModes,loopWeights,isWink,blendExpressionWeights} from './presets.js';
import {createMouthDepth} from './mouth-depth.js';
import {makeEmoteMeshes} from './emote-meshes.js';
import {makeTears,tearModes} from './tears.js';
import {cheekAction,cheekPins} from './cheeks.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {defaults,emotions,paintFace} from './face.js';
import {matchPortrait,fallbackPoints,prepareFit} from './match.js';
export {defaults,emotions,matchPortrait,tearModes,presets,playbackModes};
const headProfiles={
  Oval:{width:1,jaw:0,height:1},Round:{width:1.12,jaw:.09,height:.95},
  Long:{width:.94,jaw:-.015,height:1.075},Square:{width:1.06,jaw:.24,height:.98},
  Heart:{width:1.06,jaw:-.20,height:1},
  Diamond:{width:.98,jaw:-.14,height:1.045,cheek:.085,temple:-.042},
  Pear:{width:.99,jaw:.29,height:1.015,temple:-.085},
  Rectangular:{width:1.05,jaw:.20,height:1.105,temple:.035}
};
export const headShapes=Object.freeze(['Auto',...Object.keys(headProfiles)]);
export async function decodePhoto(source){
  const url=source instanceof Blob?URL.createObjectURL(source):null;
  try{
    const image=url||typeof source==='string'?new Image():source;
    if(url||typeof source==='string'){image.crossOrigin='anonymous';image.src=url||source;await image.decode();}
    const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height;
    if(!w||!h)throw new Error('Choose a readable image.');
    const factor=Math.min(1,1400/Math.max(w,h)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(w*factor));canvas.height=Math.max(1,Math.round(h*factor));
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);return canvas;
  }finally{if(url)URL.revokeObjectURL(url);}
}
const avatarTemplates=new Map();
function avatarTemplate(assetBase){
  if(!avatarTemplates.has(assetBase)){
    const pending=new GLTFLoader().loadAsync(assetBase+'pocketface.glb');
    avatarTemplates.set(assetBase,pending);
    pending.catch(()=>avatarTemplates.delete(assetBase));
  }
  return avatarTemplates.get(assetBase);
}
export async function createAvatar({assetBase='./assets/',image,config={}}={}){
  assetBase=new URL(assetBase,document.baseURI).href.replace(/\/?$/,'/');
  const gltf=await avatarTemplate(assetBase);
  const root=clone(gltf.scene), model=new THREE.Group();model.name='Pocketface';model.add(root);
  const mixer=new THREE.AnimationMixer(root), materials=new Map(), meshes=[];
  root.traverse(o=>{
    if(!o.isMesh)return;
    if(!materials.has(o.material.name))materials.set(o.material.name,o.material.clone());
    o.material=materials.get(o.material.name);
    o.geometry=o.geometry.clone();meshes.push(o);
  });
  const head=root.getObjectByName('PortraitHead'), atlas=document.createElement('canvas');atlas.width=atlas.height=1024;
  const tex=new THREE.CanvasTexture(atlas);tex.flipY=false;tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;
  const hairMeshes=meshes.filter(m=>m.userData.hairstyle).sort((a,b)=>a.userData.hair_order-b.userData.hair_order);
  const hairstyles=['Bald',...hairMeshes.map(m=>m.userData.hairstyle)];
  const face=materials.get('FaceAtlas');face.map=tex;face.alphaTest=.5;face.color.set('#ffffff');face.needsUpdate=true;
  const base=new Map(meshes.map(m=>[m,m.geometry.attributes.position.array.slice()]));
  const baseNormals=new Map(meshes.map(m=>[m,m.geometry.attributes.normal.array.slice()]));
  const shirtWeights=new Map();
  for(const mesh of meshes.filter(mesh=>mesh.isSkinnedMesh&&mesh.material.name==='Shirt'&&!mesh.name.startsWith('Round_hand'))){
    const isArm=mesh.skeleton.bones.map(b=>/^(Arm|Forearm)_/.test(b.name));
    const {skinIndex,skinWeight}=mesh.geometry.attributes;
    const values=new Float32Array(skinIndex.count);
    for(let i=0;i<values.length;i++){
      for(let joint=0;joint<4;joint++){
        if(isArm[skinIndex.getComponent(i,joint)])values[i]+=skinWeight.getComponent(i,joint);
      }
    }
    shirtWeights.set(mesh,values);
  }
  const state=defaults();let portrait=null,pending=0,disposed=false;
  let liveWeights={},transition=null,cheekMask=null,expressionLoop=null;
  const positions=head.geometry.attributes.position,neutralZ=new Float32Array(positions.count);
  const mouthDepth=createMouthDepth(head);
  const emoteMeshes=makeEmoteMeshes(head);
  const tears=makeTears(head,model);let facePoints;
  function weightsFor(emotion,strength){
    if(emotion==='Neutral'||strength===0)return {};
    const weights={[emotion]:strength};
    if(isWink(emotion))weights.WinkLid=strength;
    return weights;
  }
  function applyCheeks(){
    if(!portrait?.fitted){mouthDepth.apply(null,0);emoteMeshes.update(null,{});return;}
    if(!cheekMask){
      cheekMask=new Float32Array(positions.count);
      const pins=cheekPins(portrait.fitted),rest=base.get(head),span=Math.abs(portrait.fitted[26].x-portrait.fitted[24].x);
      for(let i=0;i<positions.count;i++){
        const z=rest[i*3+2];if(z<=0)continue;
        const u=.5+rest[i*3]/1.2,v=.5-(rest[i*3+1]-2.20)/1.28;
        for(const p of [pins[0],pins[3]]){
          const r=((u-p.x)/(span*.34))**2+((v-p.y)/(span*.31))**2;
          cheekMask[i]+=Math.exp(-r*1.4)*Math.min(1,z/.24);
        }
      }
    }
    const {lift}=cheekAction(liveWeights,state.mouth.opening,portrait.smileScore);
    for(let i=0;i<positions.count;i++)positions.setZ(i,neutralZ[i]+.025*lift*cheekMask[i]);
    positions.needsUpdate=true;head.geometry.computeVertexNormals();head.geometry.computeBoundingSphere();
    mouthDepth.apply(portrait.dentalLayer,portrait.dentalLayer?.cavityOnly ? .65 : state.mouth.depth);emoteMeshes.update(facePoints,liveWeights,portrait.tongueAnchors,portrait.posedNoseTip);
  }
  function renderExpression(){facePoints=paintFace(atlas,state,portrait,liveWeights);tex.needsUpdate=true;}
  function setConfig(patch){
    if(patch.mouth?.depth!==undefined&&(!Number.isFinite(patch.mouth.depth)||patch.mouth.depth<0||patch.mouth.depth>1))throw new RangeError('Mouth depth must be between 0 and 1');
    if(patch.tearMode!==undefined&&!tearModes.includes(patch.tearMode))throw new RangeError('Unknown tear mode '+patch.tearMode);
    if(patch.headShape!==undefined&&!headShapes.includes(patch.headShape))throw new RangeError('Unknown head shape '+patch.headShape);
    if(patch.hair!==undefined&&!hairstyles.includes(patch.hair))throw new RangeError('Unknown hairstyle '+patch.hair);
    if(['Joy tears','Laughing crying','Cry'].includes(patch.emotion))tears.replay();
    for(const key of Object.keys(state)){
      if(patch[key]===undefined)continue;
      if(typeof state[key]==='object')Object.assign(state[key],patch[key]);else state[key]=patch[key];
    }
    model.scale.y=state.height;
    const faceChanged=['eyes','brows','nose','mouth','skin','emotion','strength','fit'].some(k=>k in patch);
    if('emotion' in patch){expressionLoop=null;transition=null;liveWeights=weightsFor(state.emotion,state.strength);}
    else if('strength' in patch){transition=null;liveWeights=expressionLoop?loopWeights(state.emotion,expressionLoop.elapsed/expressionLoop.duration,state.strength):weightsFor(state.emotion,state.strength);}
    if(faceChanged)renderExpression();
    let headChanged=false;
    if(patch.weight!==undefined||patch.nose!==undefined||patch.shirtLength!==undefined||patch.fit!==undefined||patch.headShape!==undefined){
      const n=state.nose, rest=portrait?.reference, fitted=portrait?.fitted;
      const sourceX=fitted?(fitted[20].x+fitted[22].x)/2:.5,sourceY=fitted?(fitted[20].y+fitted[22].y)/2:.62;
      const tipX=1.20*(state.fit.x+state.fit.scale*(sourceX-.5+n.x-(rest?rest[21].x-.5:0)));
      const tipY=2.20-1.28*(state.fit.y+state.fit.scale*(sourceY-.5+n.y-(rest?rest[20].y-.62:0)));
      const profile=state.headShape==='Auto'?(portrait?.profile??headProfiles.Oval):headProfiles[state.headShape];
      for(const mesh of meshes){
        if(mesh!==head && !('weight' in patch||'shirtLength' in patch||'headShape' in patch||'skin' in patch))continue;
        const type=mesh.material.name, p=mesh.geometry.attributes.position, original=base.get(mesh);
        if(!mesh.userData.hairstyle&&!['FaceAtlas','Shirt','Skin','Denim','Sneakers','Outsole','Embroidery'].includes(type))continue;
        for(let i=0;i<p.count;i++){
          const x=original[3*i], y=original[3*i+1], z=original[3*i+2];
          if(mesh===head||mesh.userData.hairstyle){
            const lower=Math.max(0,Math.min(1,(2.35-y)/.64));
            const cheek=(profile.cheek||0)*Math.exp(-((y-2.23)**2)/.034);
            const temple=(profile.temple||0)*Math.exp(-((y-2.59)**2)/.065);
            const wide=profile.width*(1+profile.jaw*lower+cheek+temple);
            p.setXYZ(i,x*wide,1.564+(y-1.564)*profile.height,z*(1+(wide-1)*.48));
          }
          if(mesh===head&&z>0){
            const ratio=Math.min(1,z/.39)**3;
            const bump=(dx,dy,rx,ry)=>Math.exp(-((dx/rx)**2+(dy/ry)**2));
            const old=bump(x,y-2.0464,.09,.105);
            const fresh=bump(x-tipX,y-tipY,.09*n.width*state.fit.scale,.105*n.length*state.fit.scale)*(fitted?n.depth:0);
            p.setZ(i,p.getZ(i)+.042*(fresh-old)*ratio);
          }else if(mesh!==head&&!mesh.userData.hairstyle&&y<1.55){
            const delta=state.weight-1;
            const ease=(low,high)=>{
              const t=Math.max(0,Math.min(1,(y-low)/(high-low)));
              return t*t*(3-2*t);
            };
            if(type==='Denim'){
              const hip=ease(.55,.85);
              const legScale=1+delta*(.08+.22*ease(.38,.77));
              const hipScale=1+delta*.46;
              const pivot=(x<0?-1:1)*(.128-.003*ease(.12,.96));
              p.setXYZ(i,(pivot+(x-pivot)*legScale)*(1-hip)+x*hipScale*hip,
                y,z*(legScale*(1-hip)+(1+delta*.48)*hip));
            }else if(type==='Sneakers'){
              const pivot=(x<0?-1:1)*.128;
              p.setXYZ(i,pivot+(x-pivot)*(1+.06*delta),y,z*(1+.06*delta));
            }else{
              const shirtSurface=shirtWeights.get(mesh);
              const hem=shirtSurface?Math.max(0,Math.min(1,(1.48-y)/.54))*state.shirtLength:0;
              const hand=mesh.name.startsWith('Round_hand');
              const sleeve=hand?1:shirtSurface?.[i]??0;
              const sleeveCenter=y>1.19?.365-.175*(y-1.19)/.28:.365+.167*(1.19-y)/.27;
              const center=(x<0?-1:1)*(hand?.555:sleeveCenter);
              const girth=1+delta*(hand?.08:.08+.07*ease(1,1.42));
              const fullness=(.74+.26*ease(.90,1.10))*(1-.98*ease(1.06,1.17));
              const torsoX=x*(1+delta*fullness)*(1+.18*hem);
              const torsoZ=z*(1+delta*fullness*.76)*(1+.08*hem);
              const armX=center+(x-center)*girth;
              p.setXYZ(i,torsoX*(1-sleeve)+armX*sleeve,y-.19*hem*(1-sleeve),torsoZ*(1-sleeve)+z*girth*sleeve);
            }
          }
        }
        p.needsUpdate=true;
        const normal=mesh.geometry.attributes.normal, normalBase=baseNormals.get(mesh);
        if(mesh===head){
          for(let i=0;i<p.count;i++)neutralZ[i]=p.getZ(i);
          headChanged=true;mesh.geometry.computeVertexNormals();
        }else{
          normal.array.set(normalBase);normal.needsUpdate=true;
        }
        mesh.geometry.computeBoundingSphere();
      }
    }
    if(faceChanged||headChanged)applyCheeks();
    if(faceChanged||headChanged||patch.tearMode!==undefined)tears.setFace(facePoints,liveWeights,state.tearMode);
    materials.get('Shirt').color.set(state.shirt);for(const hair of hairMeshes)hair.material.color.set(state.hairColor);
    for(const hair of hairMeshes)hair.visible=state.hair===hair.userData.hairstyle;
    materials.get('Skin').color.set(state.skin);

  }
  function play(name='Idle'){
    mixer.stopAllAction();const clip=gltf.animations.find(a=>a.name===name);
    if(clip)mixer.clipAction(clip).reset().play();else if(name!=='Still')throw new Error('Unknown animation '+name);
    mixer.update(0);
  }
  async function setPhoto(source,{match=true}={}){
    const id=++pending, normalized=await decodePhoto(source);
    let fitted=null, reason='';
    if(match)try{fitted=await matchPortrait(normalized,assetBase);if(!fitted)reason='No face found';}
    catch(err){reason='Automatic matching unavailable';console.warn(reason,err);}
    if(id!==pending||disposed)return {cancelled:true};
    cheekMask=null;transition=null;tears.replay();liveWeights=weightsFor(state.emotion,state.strength);
    portrait={image:normalized,points:fitted?.points??fallbackPoints(),...fitted};
    const {eyes,brows,nose,mouth,skin,fit}=fitted?.config??defaults();setConfig({eyes,brows,nose,mouth,skin,fit});
    return {matched:!!fitted,reason,points:portrait.points};
  }
  const api={
    object:model,hairstyles:Object.freeze(hairstyles),rig:root.getObjectByName('PocketfaceRig'),clips:gltf.animations,atlas,
    get config(){return structuredClone(state);},get portrait(){return portrait;},
    setConfig,setPhoto,play,replayTears:tears.replay,
    playPreset(name,mode='Full-body loop',strength=state.strength){
      if(!emotions.includes(name)||!playbackModes.includes(mode))throw new RangeError('Unknown expression preset or playback mode');
      const clipName='Expression - '+name;
      const clip=gltf.animations.find(c=>c.name===clipName);
      play(mode==='Full-body loop'?clipName:'Still');
      api.setEmotion(name,strength);
      if(mode==='Still expression')return;
      expressionLoop={mode,duration:clip?.duration??presets[name].frames/24,elapsed:0,frame:-1};
      api.update(0);
    },
    update(dt){
      mixer.update(dt);
      if(expressionLoop){
        const loop=expressionLoop;
        loop.elapsed=(loop.elapsed+Math.max(0,dt))%loop.duration;
        const count=Math.max(24,Math.round(loop.duration*24)),frame=Math.floor(loop.elapsed/loop.duration*count+.0000001)%count;
        if(frame!==loop.frame){
          loop.frame=frame;liveWeights=loopWeights(state.emotion,frame/count,state.strength);
          renderExpression();applyCheeks();tears.setFace(facePoints,liveWeights,state.tearMode);
        }
        tears.update(dt);return;
      }
      if(!transition){tears.update(dt);return;}
      transition.elapsed+=Math.max(0,dt);
      const u=Math.min(1,transition.elapsed/transition.duration),t=u*u*(3-2*u);
      liveWeights=blendExpressionWeights(transition.start,transition.end,t);
      renderExpression();applyCheeks();tears.setFace(facePoints,liveWeights,state.tearMode);tears.update(dt);if(u===1)transition=null;
    },
    transitionEmotion(emotion,strength=1,duration=.85){
      if(!emotions.includes(emotion)||!Number.isFinite(strength)||!Number.isFinite(duration))throw new Error('Invalid expression transition');
      if(duration<=0){api.setEmotion(emotion,strength);return;}
      if(['Joy tears','Laughing crying','Cry'].includes(emotion))tears.replay();
      expressionLoop=null;state.emotion=emotion;state.strength=Math.max(0,Math.min(1,strength));
      transition={start:{...liveWeights},end:weightsFor(emotion,state.strength),elapsed:0,duration};
    },
    setEmotion(emotion,strength=1){if(!emotions.includes(emotion))throw new Error('Unknown expression');setConfig({emotion,strength:Math.max(0,Math.min(strength,1))});},
    setPoints(points){if(!portrait||points.length!==28||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw new Error('Expected 28 image landmarks');
      const updated=points.map(p=>({...p}));
      const outlineUnchanged=updated.slice(0,6).every((p,i)=>p.x===portrait.points[i].x&&p.y===portrait.points[i].y);
      const matched=prepareFit(updated,portrait.image,outlineUnchanged?portrait.outline:null,portrait.mesh,portrait.smileScore);
      if(Math.hypot((updated[10].x-updated[8].x)*portrait.image.width,(updated[10].y-updated[8].y)*portrait.image.height)<2 ||
         updated[3].y<=updated[0].y||updated[1].x<=updated[5].x)throw new Error('Place the eyes, temples and chin on the portrait first.');
      cheekMask=null;
      portrait={image:portrait.image,outline:outlineUnchanged?portrait.outline:null,...matched};
      const {eyes,brows,nose,mouth,skin}=matched.config;setConfig({eyes,brows,nose,mouth,skin});},
    clearPhoto(){pending++;portrait=null;cheekMask=null;transition=null;liveWeights=weightsFor(state.emotion,state.strength);const {skin,eyes,brows,nose,mouth,fit}=defaults();setConfig({skin,eyes,brows,nose,mouth,fit});},
    async exportGLB(){
      if(!portrait?.fitted)throw new Error('Fit a portrait before exporting.');
      const running=gltf.animations.map(clip=>mixer.existingAction(clip)).filter(a=>a?.isRunning()).map(a=>[a,a.time]);
      mixer.stopAllAction();model.updateMatrixWorld(true);
      const copy=clone(model), baked=document.createElement('canvas');baked.width=baked.height=atlas.width;baked.getContext('2d').drawImage(atlas,0,0);
      for(const hair of hairMeshes)if(!hair.visible)copy.getObjectByName(hair.name)?.removeFromParent();
      const burst=tears.exportClip(copy),animations=burst?[...gltf.animations,burst]:[...gltf.animations];
      const resources=[];copy.traverse(o=>{if(o.isMesh){o.material=o.material.clone();o.geometry=o.geometry.clone();resources.push(o.material,o.geometry);
        if(o.material.name==='DentalRow'&&o.visible){
          const source=o.material.map.image,canvas=document.createElement('canvas');
          canvas.width=source.width;canvas.height=source.height;canvas.getContext('2d').drawImage(source,0,0);
          o.material.map=o.material.map.clone();o.material.map.source=new THREE.Source(canvas);o.material.map.needsUpdate=true;resources.push(o.material.map);
        }
        if(o.material.name==='FaceAtlas'){o.material.map=tex.clone();o.material.map.source=new THREE.Source(baked);o.material.map.needsUpdate=true;resources.push(o.material.map);}
      }});
      if(expressionLoop){
        const savedWeights=liveWeights;
        const paint=weights=>{liveWeights=weights;renderExpression();applyCheeks();};
        const facial=bakeFacialLoop({copy,head,symbols:emoteMeshes.mount,row:model.getObjectByName('DentalRow'),atlas,loop:expressionLoop,
          name:state.emotion,strength:state.strength,resources,sample:paint,restore:()=>paint(savedWeights),
          bodyClip:expressionLoop.mode==='Full-body loop'?gltf.animations.find(c=>c.name==='Expression - '+state.emotion):null});
        animations.unshift(facial);
      }
      for(const [a,time] of running){a.reset().play();a.time=time;}mixer.update(0);
      try{return new Blob([await new GLTFExporter().parseAsync(copy,{binary:true,animations,onlyVisible:true})],{type:'model/gltf-binary'});}
      finally{resources.forEach(r=>r.dispose());}
    },
    dispose(){disposed=true;pending++;mixer.stopAllAction();mixer.uncacheRoot(root);tears.dispose();emoteMeshes.dispose();mouthDepth.dispose();tex.dispose();for(const m of materials.values())m.dispose();
      for(const mesh of meshes){mesh.geometry.dispose();mesh.skeleton?.dispose();}model.removeFromParent();}
  };
  setConfig({...defaults(),...config});play('Idle');if(image){await setPhoto(image);setConfig(config);}return api;
}
