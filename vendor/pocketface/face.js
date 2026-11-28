import {projectPortrait} from './projection.js';
// All points are normalized in image space, with the origin at the top left.
import {cheekAction,cheekPins} from './cheeks.js';
import {presets,posedFeatures,isWink} from './presets.js';
import {closeLids,maskPhotoEyes} from './emote-effects.js';
import {paintWink} from './wink.js';
export {emotions} from './presets.js';
export const defaults = () => ({
  eyes:{x:0,y:0,size:1,spacing:1}, brows:{x:0,y:0,size:1,spacing:1,arch:0,tilt:0},
  nose:{x:0,y:0,width:1,length:1,depth:1}, mouth:{x:0,y:0,width:1,height:1,curve:0,depth:0,opening:0,teeth:'Photo',exposure:1},
  height:1,weight:1,headShape:'Auto',shirtLength:0,shirt:'#e74933',skin:'#f9dfc3',hair:'Crop',hairColor:'#433027',fit:{scale:1,x:0,y:0},emotion:'Neutral',strength:1,tearMode:'Stay'
});
const point=(x,y)=>({x,y});
const ring=(x,y,w,h)=>[point(x-w,y),point(x,y-h),point(x+w,y),point(x,y+h)];
export const groups = {leftEye:[6,7,8,9],rightEye:[10,11,12,13],leftBrow:[14,15,16],rightBrow:[17,18,19],nose:[20,21,22,23],mouth:[24,25,26,27]};
export const groupLabels = ['Left eye','Right eye','Left brow','Right brow','Nose','Mouth'];
export function landmarks(config=defaults(), animate=false) {
  const {eyes,brows,nose,mouth}=config;
  const e=animate?config.emotion:'Neutral', t=config.strength;
  const blend=(a,b)=>a+(b-a)*t;
  const comedy=e==='Laughing crying',worried=e==='Worried',skeptical=e==='Skeptical',laughing=e==='Joy tears'||comedy, happy=e==='Happy'||laughing, sad=e==='Sad', angry=e==='Angry', surprise=e==='Surprised';
  const points=[point(.50,.08),point(.90,.35),point(.90,.64),point(.50,.94),point(.10,.64),point(.10,.35)];
  for(const sign of [-1,1]){
    const x=.50+sign*.176*eyes.spacing+eyes.x, y=.525+eyes.y;
    points.push(...ring(x,y,.070*eyes.size,.056*eyes.size*blend(1,comedy?.28:laughing?.70:worried?1.08:skeptical&&sign>0?.72:happy?.90:angry?.80:surprise?1.14:1)));
  }
  for(const sign of [-1,1]){
    const x=.5+sign*.18*brows.spacing+brows.x, y=.439+brows.y+blend(0,skeptical?(sign<0?-.047:.012):worried?-.020:surprise?-.025:happy?-.008:angry?.015:0);
    const slope=sign*(brows.tilt+blend(0,worried?.033:sad?.017:angry?-.022:0));
    points.push(point(x-.078*brows.size,y-slope),point(x,y-.022-brows.arch),point(x+.078*brows.size,y+slope));
  }
  points.push(...ring(.5+nose.x,.620+nose.y,.050*nose.width,.054*nose.length));
  const mx=.5+mouth.x,my=.770+mouth.y, mw=.086*mouth.width*blend(1,worried?.90:skeptical?.95:surprise?.86:comedy?1.13:laughing?1.075:happy?1.035:sad?.98:1);
  const h=.020*mouth.height*blend(1,comedy?1.42:worried?1.15:laughing?1.15:surprise?1.35:happy?1.08:1);
  const lift=mouth.curve+blend(0,comedy?-.022:laughing?-.013:happy?-.009:worried?.013:sad?.013:0);
  points.push(point(mx-mw,my+lift+(skeptical?.023*t:0)),point(mx,my-h),point(mx+mw,my+lift-(skeptical?.014*t:0)),point(mx,my+h));
  return points;
}
function expressionPoints(config,portrait){
  const p=fittedLandmarks(portrait,landmarks(config,true));
  if(config.emotion==='Blink')return posedFeatures(p,{eyes:[.08,.08]},config.strength);
  const profile=presets[config.emotion];
  if(profile?.eyes||profile?.smile!==undefined||profile?.width||profile?.effect||profile?.brows||profile?.gap!==undefined)
    return posedFeatures(p,isWink(config.emotion)?{...profile,eyes:[1,1]}:profile,config.strength);
  // Bend the existing lip line in proportion to the recorded expression. A
  // photographed smile needs more corner displacement than a resting mouth.
  const t=config.strength, mouth=p.slice(24,28), mid=(mouth[1].y+mouth[3].y)/2;
  const width=mouth[2].x-mouth[0].x;
  if(config.emotion==='Sad'||config.emotion==='Angry'){
    const sad=config.emotion==='Sad',goal=mid+width*(sad?.085:.018);
    for(const corner of [mouth[0],mouth[2]])corner.y+=Math.max(0,Math.min(width*.12,goal-corner.y))*t;
    const closing=t*(sad?.13:.09);
    for(const lip of [mouth[1],mouth[3]])lip.y+=(mid-lip.y)*closing;
  }else if(['Happy','Joy tears','Laughing crying'].includes(config.emotion)){
    const goal=mid-width*(config.emotion==='Happy'?.10:.14);
    for(const corner of [mouth[0],mouth[2]])corner.y+=Math.min(0,Math.max(-width*.10,goal-corner.y))*t;
  }
  return p;
}
export function paintFace(canvas,config,portrait,weights=null){
  const ctx=canvas.getContext('2d',{willReadFrequently:true}),size=canvas.width;
  ctx.setTransform(size,0,0,size,0,0);ctx.fillStyle=config.skin;ctx.fillRect(0,0,1,1);
  if(!portrait?.fitted)return;
  weights??=config.emotion==='Neutral'?{}:{[config.emotion]:config.strength};
  const neutral=expressionPoints({...config,emotion:'Neutral',strength:0},portrait),p=neutral.map(q=>({...q}));
  for(const [emotion,weight] of Object.entries(weights)){
    if(!weight||emotion==='Neutral'||emotion==='WinkLid')continue;
    const target=expressionPoints({...config,emotion,strength:1},portrait);
    for(let i=6;i<p.length;i++){p[i].x+=(target[i].x-neutral[i].x)*weight;p[i].y+=(target[i].y-neutral[i].y)*weight;}
  }
  const action=cheekAction(weights,config.mouth.opening,portrait.smileScore);
  const pins=cheekPins(portrait.fitted),span=Math.abs(p[26].x-p[24].x);
  for(const [i,q] of pins.entries()){
    const side=i<3?-1:1,amount=[.092,.062,.035][i%3];
    p.push({x:q.x+side*span*amount*.44*action.lift,y:q.y-span*amount*action.lift});
  }
  const place=q=>({x:.5+config.fit.x+(q.x-.5)*config.fit.scale,y:.5+config.fit.y+(q.y-.5)*config.fit.scale});
  for(let i=6;i<p.length;i++)p[i]=place(p[i]);
  const dentalFrame=neutral.slice(24,28).map(place);
  projectPortrait(ctx,portrait,p,{...config,weights},dentalFrame,portrait.fitted.concat(pins),action.relax);
  const closures=[0,1].map(side=>Object.entries(weights).reduce((sum,[name,w])=>{
    if(isWink(name))return sum;
    const eye=name==='Blink'?.08:presets[name]?.eyes?.[side]??1;
    return sum+w*Math.max(0,(.6-eye)/.5);
  },0));
  const projected=q=>{const [dx,dy]=portrait.forward(q.x,q.y);return {x:q.x+dx,y:q.y+dy};};
  const visible=portrait.fitted.map(projected);
  portrait.posedNoseTip=projected(portrait.noseTip??portrait.fitted[23]);
  closeLids(ctx,neutral.map(place),visible,closures);
  paintWink(ctx,portrait.wink,projected,weights.WinkLid??((weights['Wink 1']||0)+(weights['Wink 2']||0)));
  maskPhotoEyes(ctx,visible,(weights.Confused||0)+(weights.Love||0)+(weights.Money||0)+(weights.Resolve||0));
  if(weights.Blank){
    ctx.save();ctx.globalAlpha=weights.Blank;ctx.fillStyle=config.skin;ctx.fillRect(0,0,1,1);ctx.restore();
    if(weights.Blank>=.999)portrait.dentalLayer=null;
  }
  return visible;
}
function fittedLandmarks({fitted,reference},template){
  const result=fitted.map(p=>({...p}));
  for(const ids of Object.values(groups)){
    for(const axis of ['x','y']){
      const coords=ps=>ids.map(i=>ps[i][axis]);
      const extent=values=>Math.max(...values)-Math.min(...values);
      const mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
      const ref=coords(reference), target=coords(template);
      const shift=mean(target)-mean(ref);
      const scale=Math.max(.30,Math.min(2,extent(coords(fitted))/Math.max(.01,extent(ref))));
      ids.forEach((i,j)=>result[i][axis]+=shift+scale*(target[j]-ref[j]-shift));
    }
  }
  return result;
}
