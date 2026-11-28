import {defaults,landmarks} from './face.js';
import {portraitTransform} from './projection.js';
import {winkContours} from './wink.js';
import {detectMouth} from './mouth.js';
const ovalIndices=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
const indices=[10,356,361,152,132,127,33,159,133,145,362,386,263,374,70,105,107,336,334,300,98,6,327,2,61,0,291,17];
const engines=new Map();
async function getEngine(assets){
  if(!engines.has(assets)){
    const pending=(async()=>{
      const {FilesetResolver,FaceLandmarker}=await import('@mediapipe/tasks-vision');
      const wasm=await FilesetResolver.forVisionTasks(assets+'wasm');
      return FaceLandmarker.createFromOptions(wasm,{baseOptions:{modelAssetPath:assets+'face_landmarker.task',delegate:'CPU'},runningMode:'IMAGE',numFaces:1,outputFaceBlendshapes:true});
    })();
    engines.set(assets,pending);pending.catch(()=>engines.delete(assets));
  }
  return engines.get(assets);
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export async function matchPortrait(image,assets){
  const engine=await getEngine(assets), result=engine.detect(image),mesh=result.faceLandmarks[0];
  if(!mesh)return null;
  const points=indices.map(i=>({x:mesh[i].x,y:mesh[i].y}));
  let canvas=image;
  if(!image.getContext){canvas=document.createElement('canvas');canvas.width=image.naturalWidth||image.width;canvas.height=image.naturalHeight||image.height;canvas.getContext('2d').drawImage(image,0,0);}
  const scores=result.faceBlendshapes?.[0]?.categories.filter(c=>['mouthSmileLeft','mouthSmileRight'].includes(c.categoryName));
  const smileScore=scores?.length?scores.reduce((v,c)=>v+c.score,0)/scores.length:null;
  return prepareFit(points,canvas,ovalIndices.map(i=>({x:mesh[i].x,y:mesh[i].y})),mesh,smileScore);
}
export function fallbackPoints(){return landmarks(defaults());}

function fitProportions(points){
  const cfg=defaults(), h=Math.max(.01,points[3].y-points[0].y),w=Math.max(.01,points[1].x-points[5].x);
  const px=x=>.50+(x-(points[1].x+points[5].x)/2)*.80/w;
  const py=y=>.08+(y-points[0].y)*.86/h;
  const center=(i,j,axis)=>(points[i][axis]+points[j][axis])/2;
  const eyeX=center(7,11,'x'), eyeY=center(6,12,'y');
  cfg.eyes.x=clamp(px(eyeX)-.5,-.07,.07);cfg.eyes.y=clamp((py(eyeY)-.481)*.48,-.075,.075);
  cfg.eyes.spacing=clamp((px(points[11].x)-px(points[7].x))/.352,.72,1.27);
  cfg.eyes.size=clamp((points[8].x-points[6].x)*.80/w/.14,.68,1.4);
  cfg.brows.x=cfg.eyes.x;cfg.brows.y=clamp((py(center(14,19,'y'))-.358)*.48,-.07,.07);
  cfg.brows.spacing=clamp((points[18].x-points[15].x)*.8/w/.36,.72,1.27);
  cfg.brows.size=clamp((points[16].x-points[14].x)*.80/w/.156,.65,1.4);
  cfg.brows.arch=clamp((center(14,16,'y')-points[15].y)*.86/h-.022,-.025,.035);
  cfg.brows.tilt=clamp((points[14].y-points[16].y)*.43/h,-.035,.035);
  cfg.nose.x=clamp(px(center(20,22,'x'))-.5,-.07,.07);
  cfg.nose.y=clamp((py(center(20,22,'y'))-.558)*.48,-.068,.068);
  cfg.nose.width=clamp((points[22].x-points[20].x)*.8/w/.10,.65,1.5);
  cfg.nose.length=clamp((points[23].y-points[21].y)*.86/h/.108,.65,1.45);
  cfg.mouth.x=clamp(px(center(24,26,'x'))-.5,-.07,.07);
  cfg.mouth.y=clamp((py(center(24,26,'y'))-.683)*.48,-.085,.085);
  cfg.mouth.width=clamp((points[26].x-points[24].x)*.80/w/.206,.65,1.45);
  cfg.mouth.height=clamp((points[27].y-points[25].y)*.86/h/.04,.6,1.6);
  return cfg;
}
export function prepareFit(points,image,outline=null,mesh=null,smileScore=null){
  const config=fitProportions(points),transform=portraitTransform(points,image,outline);
  const fitted=points.map(transform.map),reference=landmarks(config);
  // Sample small cheek patches at native resolution. Medians suppress highlights and glasses frames.
  const ctx=image.getContext('2d',{willReadFrequently:true}),channels=[[],[],[]];
  for(const [outer,inner] of [[4,20],[2,22]]){
    const p=points[outer],q=points[inner],x=Math.round(image.width*(p.x*.46+q.x*.54)),y=Math.round(image.height*(p.y*.44+q.y*.56));
    const radius=Math.max(1,Math.round(Math.abs(points[1].x-points[5].x)*image.width*.024));
    const data=ctx.getImageData(x-radius,y-radius,2*radius+1,2*radius+1).data;
    for(let k=0;k<data.length;k+=4)if(data[k+3])for(let c=0;c<3;c++)channels[c].push(data[k+c]);
  }
  if(channels[0].length)config.skin='#'+channels.map(ch=>ch.sort((a,b)=>a-b)[Math.floor(ch.length/2)].toString(16).padStart(2,'0')).join('');
  const contour=(outline??points.slice(0,6)).map(transform.local);
  const width=Math.max(...contour.map(p=>p.x))-Math.min(...contour.map(p=>p.x));
  const height=Math.max(...contour.map(p=>p.y))-Math.min(...contour.map(p=>p.y));
  const jaw=transform.row(.78).width/Math.max(1,transform.row(.47).width);
  const profile={width:clamp((width/Math.max(1,height))/.78,.88,1.17),jaw:clamp((jaw-.73)*.78,-.13,.17),height:1};
  // Carry the measured nose tip through manual landmark edits as well as matching.
  let noseTip={x:(points[20].x+points[22].x)/2,y:points[21].y*.23+points[23].y*.77};
  if(mesh){
    const u=(mesh[1].x-mesh[98].x)/Math.max(.001,mesh[327].x-mesh[98].x);
    const v=(mesh[1].y-mesh[6].y)/Math.max(.001,mesh[2].y-mesh[6].y);
    noseTip={x:points[20].x+u*(points[22].x-points[20].x),y:points[21].y+v*(points[23].y-points[21].y)};
  }
  const mouthState=detectMouth(image,mesh,points,transform,smileScore);
  return {points,config,fitted,wink:winkContours(points,mesh,transform.map),transform,reference,outline,profile,mesh,noseTip:transform.map(noseTip),mouthState,smileScore};
}
