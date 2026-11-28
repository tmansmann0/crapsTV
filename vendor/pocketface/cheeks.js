import {presets} from './presets.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function cheekAction(weights,opening,smileScore){
  const close=Math.max(0,-opening);
  const expressionSmile=Object.entries(weights).reduce((sum,[name,value])=>sum+(presets[name]?.smile||0)*value,0);
  const down=clamp((weights.Sad||0)*.96+(weights.Worried||0)*.55+(weights.Angry||0)*.45+close+Math.max(0,-expressionSmile)*.75,0,1);
  const up=(weights.Happy||0)*.48+(weights['Joy tears']||0)*.65+(weights['Laughing crying']||0)+Math.max(0,expressionSmile)*.65;
  return {lift:up-down,relax:down*clamp(smileScore??.6,.15,1)};
}
export function cheekPins(points){
  const pins=[];
  for(const [eye,nose,corner,sign] of [[6,20,24,-1],[12,22,26,1]]){
    const n=points[nose],m=points[corner],e=points[eye],span=Math.abs(points[26].x-points[24].x);
    pins.push({x:.36*n.x+.64*m.x+sign*span*.16,y:.57*n.y+.43*m.y},
      {x:m.x+sign*span*.10,y:m.y+span*.045},
      {x:.85*e.x+.15*n.x,y:.65*e.y+.35*n.y});
  }
  return pins;
}
// Local shadow attenuation follows the arc from each nose wing to the mouth
// corner. Compare neighbouring cheek pixels to lift the crease, preserving pores.
export function creaseMap(base,points,size){
  const delta=new Uint8Array(size*size),pixels=base.pixels;
  const luma=k=>.299*pixels[k]+.587*pixels[k+1]+.114*pixels[k+2];
  const span=Math.abs(points[26].x-points[24].x);
  for(const [ni,mi,side] of [[20,24,-1],[22,26,1]]){
    const n=points[ni],m=points[mi],start=n.y+.008,stop=m.y+span*.16;
    if(stop<=start)continue;
    for(let y=Math.max(0,Math.ceil(start*size));y<Math.min(size,stop*size);y++){
      const t=(y/size-start)/(stop-start),edge=Math.min(1,t*7,(1-t)*6);
      const mid=(n.x+(m.x-n.x)*t+side*span*(.085+.105*Math.sin(Math.PI*t)))*size;
      const r=Math.max(3,span*size*.13),sample=Math.max(2,Math.round(r*.69));
      for(let x=Math.max(sample,Math.floor(mid-r));x<Math.min(size-sample,mid+r);x++){
        const k=(y*size+x)*4,shadow=.5*(luma(k-4*sample)+luma(k+4*sample))-luma(k);
        delta[k/4]=Math.max(delta[k/4],Math.round(clamp(shadow-3,0,37)*edge*(1-((x-mid)/r)**2)*.91));
      }
    }
  }
  return delta;
}
