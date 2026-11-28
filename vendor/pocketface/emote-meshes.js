import * as T from 'three';
import {headMount,surfaceAtUV} from './head-attachments.js';
import {snoutGeometry} from './dog-snout.js';
import {tongueGeometry,tongueSites} from './tongue.js';
import {presets} from './presets.js';

function heart(){
  const s=new T.Shape();s.moveTo(0,-.90);
  s.bezierCurveTo(-.34,-.56,-1.04,.00,-1.02,.47);
  s.bezierCurveTo(-1.00,.98,-.35,1.12,0,.60);
  s.bezierCurveTo(.35,1.12,1.00,.98,1.02,.47);s.bezierCurveTo(1.04,0,.34,-.56,0,-.90);
  return new T.ExtrudeGeometry(s,{depth:.22,bevelEnabled:true,bevelSegments:4,steps:1,bevelSize:.105,bevelThickness:.10,curveSegments:12});
}
function tube(points,radius){
  const path=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));
  return new T.TubeGeometry(path,Math.max(12,points.length*3),radius,8,false);
}

export function makeEmoteMeshes(head){
  const mount=headMount(head,'ExpressionSymbols'),effects=new Map(),materials=new Map(),geometries=new Set();
  function mesh(name,geometry,color,metal=0){
    if(!materials.has(color))materials.set(color,new T.MeshPhysicalMaterial({
      color,metalness:metal,roughness:metal?.29:.32,clearcoat:.48,clearcoatRoughness:.21}));
    geometries.add(geometry);const m=new T.Mesh(geometry,materials.get(color));m.name=name;return m;
  }
  function ball(name,color,sx,sy,sz,x=0,y=0,z=0){
    const m=mesh(name,new T.SphereGeometry(1,22,14),color);m.scale.set(sx,sy,sz);m.position.set(x,y,z);return m;
  }
  function assemble(effect){
    const parts=[];
    function part(site,tag){
      const g=new T.Group();g.name='Symbol_'+effect.replaceAll(' ','_')+'_'+tag;
      mount.add(g);parts.push({site,g});return g;
    }
    if(['hearts','coins','spirals','ink','cat'].includes(effect)){
      for(const [i,side] of [-1,1].entries()){
        const g=part(i?'rightEye':'leftEye',i?'R':'L');
        if(effect==='hearts')g.add(mesh('Rounded heart',heart(),'#e9335f'));
        if(effect==='coins'){
          const coin=mesh('Coin edge',new T.CylinderGeometry(.95,.95,.30,40),'#e09d16',.34);
          coin.rotation.x=Math.PI/2;g.add(coin);
          const rim=mesh('Raised coin rim',new T.TorusGeometry(.82,.070,10,40),'#ffd659',.22);rim.position.z=.15;g.add(rim);
          const letter=tube([[.32,.35,.20],[.07,.48,.20],[-.28,.32,.20],[-.27,.12,.20],[.01,-.02,.20],[.28,-.16,.20],[.23,-.36,.20],[-.04,-.43,.20],[-.33,-.29,.20]],.085);
          g.add(mesh('Dollar curve',letter,'#95631a'),mesh('Dollar stem',tube([[0,-.59,.19],[0,.61,.19]],.051),'#95631a'));
        }
        if(effect==='spirals'){
          const eye=ball('Spiral eye','#ffebcb',1.06,.88,.245);eye.position.z=.015;g.add(eye);
          const points=[];
          for(let j=0;j<=52;j++){
            const t=j/52,angle=13.6*t,r=.055+.79*t;
            points.push([r*Math.cos(angle),.85*r*Math.sin(angle),.052+.245*Math.sqrt(1-r*r)]);
          }
          g.add(mesh('Coiled spiral',tube(points,.071),'#493a49'));
        }
        if(effect==='ink'){const slash=ball('Determined brow','#352d32',1.16,.34,.20);slash.rotation.z=side*.38;g.add(slash);}
        if(effect==='cat')g.add(ball('Cat pupil','#4d3429',.17,.55,.14));
      }
    }
    if(effect in tongueSites){
      const g=part('mouth','Tongue'),tongue=mesh('Tongue blade',tongueGeometry(effect),'#ffffff');
      tongue.material.vertexColors=true;tongue.material.roughness=.54;tongue.material.clearcoat=.12;
      g.add(tongue);
    }
    if(effect==='dog'){
      const snout=part('snout','Snout');
      const pad=mesh('Full canine muzzle',snoutGeometry(),'#fffefb');
      pad.material.vertexColors=true;pad.material.roughness=.81;pad.material.clearcoat=.04;snout.add(pad);
      const nose=ball('Canine nose leather','#443631',.74,.36,.31,0,-.10,.63);
      const pos=nose.geometry.attributes.position;
      for(let i=0;i<pos.count;i++)pos.setX(i,pos.getX(i)*(.89+.20*pos.getY(i)));
      pos.needsUpdate=true;nose.geometry.computeVertexNormals();nose.material.roughness=.54;nose.material.clearcoat=.16;
      snout.add(nose);
      for(const side of [-1,1]){
        const nostril=ball('Canine nostril','#2e2524',.095,.052,.027,side*.32,-.12,.897);
        nostril.rotation.z=side*.26;snout.add(nostril);
        for(const [x,y,z] of [[.43,-.53,.56],[.60,-.57,.49],[.51,-.68,.48]])
          snout.add(ball('Whisker pore','#8f674e',.026,.021,.014,side*x,y,z));
      }
      snout.add(mesh('Muzzle cleft',tube([[0,-.39,.64],[0,-.50,.57],[0,-.64,.50],[0,-.74,.42]],.014),'#a37860'));
    }
    if(effect==='cat'){
      const g=part('nose','Nose');
      g.add(ball('Cat nose','#bb7e78',.37,.33,.29,0,0,.12));
      if(effect==='cat')for(const side of [-1,1])for(let j=0;j<3;j++){
        g.add(mesh('Whisker',tube([[side*.43,-.30-j*.14,.20],[side*1.23,-.24-j*.27,.21],[side*2.1,-.05-j*.42,.17]],.033),'#684d41'));
      }
    }
    return parts;
  }
  function update(points,weights,tongueAnchors={},noseTip){
    const powers=new Map();
    if(points)for(const [name,w] of Object.entries(weights)){
      const fx=presets[name]?.effect;
      if(!fx||fx==='blank'||fx==='tears'||w<=.005)continue;
      powers.set(fx,w);if(!effects.has(fx))effects.set(fx,assemble(fx));
    }
    for(const [fx,parts] of effects){
      const strength=powers.get(fx)||0;
      for(const {site,g} of parts){
        g.visible=strength>0;if(!g.visible)continue;
        const mouthWidth=points[26].x-points[24].x;
        let x,y,r;
        let snoutHeight;
        if(site==='snout'){
          const tip=noseTip??points[23],top=points[21].y-.014,bottom=points[25].y+.002;
          const width=Math.max(Math.abs(points[22].x-points[20].x),mouthWidth*.61);
          x=.6*tip.x+.2*(points[20].x+points[22].x);y=(top+bottom)*.5;
          r=width*1.2*.84;snoutHeight=Math.max(width*.48,(bottom-top)*.68);
        }else if(site==='nose'){
          const tip=noseTip??points[23];x=tip.x;y=tip.y;r=mouthWidth*.30;
        }
        else if(site==='mouth'){
          const anchor=tongueAnchors[fx];
          if(!anchor||anchor.gap<.001){g.visible=false;continue;}
          x=anchor.x;y=anchor.y;r=1.20*anchor.width;
        }else{
          const i=site==='leftEye'?6:10;x=(points[i].x+points[i+2].x)/2;y=(points[i+1].y+points[i+3].y)/2;
          r=(points[i+2].x-points[i].x)*.73;
        }
        const surface=surfaceAtUV(head.geometry,{x,y},site==='mouth'?0:.012);
        if(!surface){g.visible=false;continue;}
        surface.decompose(g.position,g.quaternion,g.scale);
        if(site==='mouth'){
          const opening=Math.min(1,tongueAnchors[fx].gap/(tongueAnchors[fx].width*.07));
          g.scale.set(r*(.72+.28*strength),r*strength*opening,r*(.55+.45*strength)*opening);
        }else if(site==='snout'){
          // Keep the entire nose covered throughout the active acting loop.
          g.scale.set(r,snoutHeight,Math.max(r*.66,snoutHeight*.46)).multiplyScalar(Math.min(1,strength/.44));
        }else{
          const amount=fx==='spirals'?Math.min(1,strength/.40):Math.sqrt(strength);
          g.scale.setScalar(r*amount);
          if(fx==='spirals')g.rotateZ((site==='leftEye'?1:-1)*.22*(1-strength));
        }
      }
    }
  }
  return {mount,update,dispose(){
    mount.removeFromParent();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
  }};
}
