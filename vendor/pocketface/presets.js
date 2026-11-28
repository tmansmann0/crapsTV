import catalog from './presets.json' with {type:'json'};
export const presets=Object.freeze(catalog);
export const emotions=Object.freeze(Object.keys(presets));
export const playbackModes=Object.freeze(['Still expression','Facial loop','Full-body loop']);

export const isWink=name=>name==='Wink 1'||name==='Wink 2';

export function blendExpressionWeights(start,end,t){
  const blended={};
  for(const key of new Set([...Object.keys(start),...Object.keys(end)])){
    // An explicitly open wink has a zero lid weight even when the cheek and
    // smile still have weight. Keep that zero during an interrupted loop.
    blended[key]=(start[key]||0)*(1-t)+(end[key]||0)*t;
  }
  return blended;
}

export function loopWeights(name,phase,strength){
  const p=presets[name],angle=2*Math.PI*(phase-Math.floor(phase));
  let pulse=(1-Math.cos(angle))*.5;
  if(isWink(name)){
    const t=phase-Math.floor(phase);
    const ease=x=>{const u=Math.max(0,Math.min(1,x));return u*u*(3-2*u);};
    const closed=ease((t-.24)/.075)*(1-ease((t-.44)/.16));
    return {[name]:strength*(.72+.28*pulse),WinkLid:strength*closed};
  }
  if(p.rhythm==='double')pulse=.30*pulse+.35*(1-Math.cos(2*angle));
  if(p.rhythm==='hold')pulse=Math.min(1,1.7*pulse);
  if(p.rhythm==='hit')pulse=pulse**3;
  if(p.rhythm==='fidget')pulse=.7*pulse+.15*(1-Math.cos(2*angle));
  const blink=Math.max(0,1-Math.abs(phase%1-.84)/.075);
  if(name==='Blank')return {Blank:strength*(1-.64*pulse**3)};
  return {[name]:strength*(.48+.52*pulse),Blink:strength*.74*blink*blink};
}

export function posedFeatures(points,p,weight){
  for(const [side,start] of [6,10].entries()){
    const top=points[start+1],bottom=points[start+3],mid=(top.y+bottom.y)*.5;
    const aperture=1+weight*((p.eyes?.[side]??1)-1);
    top.y=mid+(top.y-mid)*aperture;bottom.y=mid+(bottom.y-mid)*aperture;
    const offset=14+side*3,sign=side===0?-1:1;
    for(let i=0;i<3;i++)points[offset+i].y-=weight*((p.brows?.[side]||0)*.04-(p.tilt||0)*sign*(i-1)*.038);
  }
  const [left,top,right,bottom]=points.slice(24),width=right.x-left.x,cx=(left.x+right.x)*.5,mid=(top.y+bottom.y)*.5;
  for(const [corner,sign] of [[left,-1],[right,1]]){
    corner.x=cx+(corner.x-cx)*(1+weight*((p.width??1)-1));
    if(p.smile!==undefined)corner.y+=weight*(mid-width*.14*p.smile-corner.y);
    corner.y+=(p.asym||0)*weight*sign*width*.07;
  }
  return points;
}
