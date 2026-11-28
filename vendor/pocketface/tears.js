import * as T from 'three';
import {headMount,surfaceAtUV} from './head-attachments.js';

export const tearModes=Object.freeze(['Stay','Once','Repeat']);
const flightTime=.82, repeatTime=1.16, launchDelay=.20;
export function makeTears(head,model){
  const mount=headMount(head,'TearMount');
  const outline=[[0,-.205],[.022,-.201],[.047,-.187],[.061,-.166],[.064,-.145],[.060,-.123],[.050,-.099],[.037,-.075],[.022,-.048],[.010,-.024],[0,0]];
  const geometry=new T.LatheGeometry(outline.map(([x,y])=>new T.Vector2(x,y)),24);
  geometry.scale(1,1,.70);
  const colors=[],top=new T.Color('#71e8ff'),bottom=new T.Color('#188aca');
  for(let i=0;i<geometry.attributes.position.count;i++){
    const color=top.clone().lerp(bottom,Math.min(1,-geometry.attributes.position.getY(i)/.205));
    colors.push(color.r,color.g,color.b);
  }
  geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  const material=new T.MeshPhysicalMaterial({vertexColors:true,roughness:.19,clearcoat:1,clearcoatRoughness:.11});
  material.name='Glossy water';
  const localZ=new T.Vector3(0,0,1);
  const drops=['LeftTear','RightTear'].map((name,i)=>{
    const anchor=new T.Group();mount.add(anchor);
    const drop=new T.Mesh(geometry,material);drop.name=name;drop.visible=false;anchor.add(drop);
    return {anchor,drop,side:i===0?-1:1,origin:new T.Vector3(),rotation:new T.Quaternion(),velocity:new T.Vector3()};
  });
  let mode='Stay',elapsed=0,launched=false,power=0;

  function restart(){
    elapsed=0;launched=false;
    for(const {anchor,drop,side} of drops){
      anchor.add(drop);drop.position.set(0,0,0);drop.rotation.set(0,0,side*.31);
    }
  }
  function flightPose(drop,origin,rotation,velocity,side,time){
    drop.position.copy(origin).addScaledVector(velocity,time);
    drop.position.y-=1.35*time*time;
    drop.quaternion.copy(rotation);drop.rotateZ(side*time*1.6);
    drop.scale.setScalar(power*T.MathUtils.smoothstep(flightTime-time,0,.18));
  }
  function update(dt=0){
    if(!power){for(const {drop} of drops)drop.visible=false;return;}
    elapsed+=Math.max(0,dt);
    if(mode==='Repeat' && elapsed>=repeatTime){const phase=elapsed%repeatTime;restart();elapsed=phase;}
    const time=elapsed-launchDelay;
    if(mode!=='Stay' && time>=0 && !launched){
      model.updateWorldMatrix(true,true);
      for(const {drop,side,origin,rotation,velocity} of drops){
        // Capture the launch pose so turning the head cannot steer airborne water.
        const local=new T.Matrix4().copy(model.matrixWorld).invert().multiply(drop.matrixWorld);
        local.decompose(origin,rotation,new T.Vector3());
        const outward=new T.Vector3(side*.76,.62,.39);
        velocity.copy(outward).applyQuaternion(rotation);
        model.add(drop);drop.quaternion.copy(rotation);
      }
      launched=true;
    }
    for(const {anchor,drop,origin,rotation,side,velocity} of drops){
      drop.visible=anchor.userData.onCheek && (!launched || time<flightTime);
      if(!drop.visible)continue;
      if(launched)flightPose(drop,origin,rotation,velocity,side,time);
      else drop.scale.setScalar(power);
    }
  }
  function setFace(points,weights,nextMode){
    const joy=(weights['Joy tears']||0)+(weights.Cry||0),laugh=weights['Laughing crying']||0;
    const strength=points?joy+1.24*laugh:0;
    if(nextMode!==mode||(!power && strength)||!strength){mode=nextMode;restart();}
    power=strength;
    if(power)for(const [i,{anchor,side}] of drops.entries()){
      const eye=points[i===0?6:12];
      const surface=surfaceAtUV(head.geometry,{x:eye.x-side*.016,y:eye.y+.022});
      anchor.userData.onCheek=!!surface;
      if(surface)surface.decompose(anchor.position,anchor.quaternion,anchor.scale);
    }
    update();
  }
  function exportClip(copy){
    if(!power || mode==='Stay')return null;
    const parent=copy.getObjectByName(mount.name),tracks=[];
    const duration=mode==='Repeat'?repeatTime:launchDelay+flightTime;
    for(const {anchor,drop,side} of drops){
      if(!anchor.userData.onCheek)continue;
      const node=copy.getObjectByName(drop.name);
      parent.add(node);node.visible=true;
      const origin=anchor.position,rotation=anchor.quaternion.clone()
        .multiply(new T.Quaternion().setFromAxisAngle(localZ,side*.31));
      const velocity=new T.Vector3(side*.76,.62,.39).applyQuaternion(rotation);
      const pose=new T.Object3D(),times=[0,launchDelay],positions=[],rotations=[],scales=[];
      for(let i=1;i<=24;i++)times.push(launchDelay+flightTime*i/24);
      if(mode==='Repeat')times.push(duration);
      for(const t of times){
        flightPose(pose,origin,rotation,velocity,side,Math.max(0,t-launchDelay));
        positions.push(...pose.position.toArray());rotations.push(...pose.quaternion.toArray());scales.push(...pose.scale.toArray());
      }
      flightPose(node,origin,rotation,velocity,side,0);
      tracks.push(new T.VectorKeyframeTrack(node.name+'.position',times,positions),
        new T.QuaternionKeyframeTrack(node.name+'.quaternion',times,rotations),
        new T.VectorKeyframeTrack(node.name+'.scale',times,scales));
    }
    return tracks.length?new T.AnimationClip('TearBurst',duration,tracks):null;
  }
  return {setFace,update,exportClip,replay(){restart();update();},dispose(){
    for(const {drop} of drops)drop.removeFromParent();
    mount.removeFromParent();geometry.dispose();material.dispose();
  }};
}
