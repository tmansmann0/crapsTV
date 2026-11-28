import {tongueSites} from './tongue.js';
import {presets as profiles} from './presets.js';
// The lip aperture is traced independently of the outer mouth. The dental
// plate is sampled from the original atlas and anchored to the neutral pose.
const upperIDs=[78,191,80,81,82,13,312,311,310,415,308];
const lowerIDs=[78,95,88,178,87,14,317,402,318,324,308];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const luminance=(r,g,b)=>.299*r+.587*g+.114*b;
function lineAt(line,x){
  if(x<=line[0].x)return line[0].y;
  for(let i=1;i<line.length;i++)if(x<=line[i].x){
    const a=line[i-1],b=line[i];return a.y+(b.y-a.y)*(x-a.x)/Math.max(1e-8,b.x-a.x);
  }
  return line.at(-1).y;
}
const order=points=>points.slice().sort((a,b)=>a.x-b.x);
function guessedContour(points,lower){
  const [left,top,right,bottom]=points.slice(24);
  return Array.from({length:11},(_,i)=>{
    const t=.04+.92*i/10,bell=Math.sin(Math.PI*i/10);
    const center=left.y*(1-t)+right.y*t;
    return {x:left.x*(1-t)+right.x*t,y:center+bell*((top.y+bottom.y)*.5-center+(lower?1:-1)*(bottom.y-top.y)*.18)};
  });
}
export function detectMouth(image,mesh,points,transform,smileScore){
  // Manual mouth handles can correct the detected box. Move its dense contours
  // with that correction, preserving the curvature measured in the image.
  function contour(ids,lower){
    if(!mesh)return guessedContour(points,lower);
    const dx=mesh[291].x-mesh[61].x,dy=mesh[17].y-mesh[0].y;
    return ids.map(id=>({x:points[24].x+(mesh[id].x-mesh[61].x)*(points[26].x-points[24].x)/Math.max(.002,dx),
      y:points[25].y+(mesh[id].y-mesh[0].y)*(points[27].y-points[25].y)/Math.max(.002,dy)}));
  }
  const upper=order(contour(upperIDs,false)),lower=order(contour(lowerIDs,true));
  const pixels=image.getContext('2d',{willReadFrequently:true}).getImageData(0,0,image.width,image.height).data;
  function sample(x,y){
    const i=4*(clamp(Math.round(y*image.height),0,image.height-1)*image.width+clamp(Math.round(x*image.width),0,image.width-1));
    return [pixels[i],pixels[i+1],pixels[i+2]];
  }
  const left=upper[0].x,width=Math.max(.001,upper.at(-1).x-left),cx=left+width/2;
  const ratio=(lineAt(lower,cx)-lineAt(upper,cx))*image.height/(width*image.width);
  const lip=sample(points[27].x,points[27].y),threshold=clamp(luminance(...lip)+15,94,168);
  const sampleColors=[];let light=0;
  for(let i=1;i<17;i++){
    const x=left+width*i/17,top=lineAt(upper,x),bottom=lineAt(lower,x);
    for(let j=1;j<6;j++){
      const rgb=sample(x,top+(bottom-top)*j/6);sampleColors.push(rgb);
      if(luminance(...rgb)>threshold&&rgb[1]>rgb[0]*.77&&rgb[2]>rgb[0]*.62)light++;
    }
  }
  sampleColors.sort((a,b)=>luminance(...a)-luminance(...b));
  const ink=sampleColors[Math.floor(sampleColors.length*.07)].map((v,i)=>clamp(v*.55,10,[77,40,45][i]));
  const teethVisible=ratio>.032&&light/sampleColors.length>.22;
  const curved=((points[25].y+points[27].y-points[24].y-points[26].y)*.5)*image.height/(width*image.width);
  const smiling=smileScore==null?curved>.045:smileScore>.33;
  return {upper:order(upper.map(transform.map)),lower:order(lower.map(transform.map)),
    teethVisible,smiling,ratio,threshold,ink,
    label:(smiling?'Smile':ratio>.04?'Open mouth':'Resting mouth')+' · '+(teethVisible?'teeth visible':'teeth covered')};
}
export function openingFor(config,source,width,gap,bell){
  const presets={Neutral:1,Happy:source.teethVisible?1.06:1,Sad:.025,Angry:.12,Surprised:1.18,'Joy tears':1.18,'Laughing crying':1.25,Worried:.14,Skeptical:.63};
  const weights=config.weights??{[config.emotion]:config.strength};
  let opening=gap;
  for(const [e,t] of Object.entries(weights)){
    opening+=((profiles[e]?.gap??presets[e]??1)-1)*gap*t;
    opening+=width*(profiles[e]?.open??({Surprised:.12,'Joy tears':.06,'Laughing crying':.13}[e]||0))*bell*t;
  }
  const adjustment=config.mouth.opening;
  return Math.max(0,adjustment<0?opening*(1+adjustment):opening+width*.19*adjustment*bell);
}
export function compositeMouth(ctx,portrait,base,destFrame,forward,config){
  portrait.dentalLayer=null;portrait.tongueAnchors={};
  const model=portrait.mouthState;if(!model)return;
  const rest=config.weights?!Object.entries(config.weights).some(([name,v])=>name!=='Neutral'&&name!=='Blink'&&v>.00001):config.emotion==='Neutral'||config.strength===0;
  const keepPhoto=rest&&config.mouth.opening===0&&config.mouth.teeth==='Photo'&&config.mouth.exposure===1;
  const useDepth=config.mouth.depth>0;
  const expressionWeights=config.weights??{[config.emotion]:config.strength};
  const tongueWeight=Math.min(1,Object.entries(expressionWeights).reduce((sum,[name,weight])=>
    sum+(profiles[name]?.effect in tongueSites?weight:0),0));
  const tongueSocket=tongueWeight>.005;
  if(keepPhoto&&!useDepth)return;
  const size=ctx.canvas.width,toPixels=p=>({x:p.x*size,y:p.y*size});
  const pose=p=>{const [x,y]=forward(p.x,p.y);return toPixels({x:p.x+x,y:p.y+y});};
  const upper=order(model.upper.map(pose)),lower=order(model.lower.map(pose));
  const su=order(model.upper.map(toPixels)),sl=order(model.lower.map(toPixels));
  const left=upper[0].x,right=upper.at(-1).x,width=right-left;if(width<3)return;
  const pad=Math.max(6,width*.23),x0=clamp(Math.floor(left),0,size-1),x1=clamp(Math.ceil(right),x0+1,size);
  const y0=clamp(Math.floor(Math.min(...upper.map(p=>p.y),...lower.map(p=>p.y))-pad),0,size-1);
  const y1=clamp(Math.ceil(Math.max(...upper.map(p=>p.y),...lower.map(p=>p.y))+pad),y0+1,size);
  const rect=ctx.getImageData(x0,y0,x1-x0,y1-y0),original=rect.data.slice(),w=rect.width;
  const layer=(useDepth||tongueSocket)?ctx.createImageData(w,rect.height):null;
  let cutPixels=0;
  if(layer){
    const ink=model.ink.map(Math.round);
    for(let d=0;d<layer.data.length;d+=4){
      layer.data[d]=ink[0];layer.data[d+1]=ink[1];layer.data[d+2]=ink[2];layer.data[d+3]=255;
    }
  }
  const sourceCenter=(su[0].x+su.at(-1).x)*.5;
  const sourceMouth=portrait.fitted.slice(24),sourceMid=(sourceMouth[1].y+sourceMouth[3].y)*.5;
  const scale=(destFrame[2].x-destFrame[0].x)/(sourceMouth[2].x-sourceMouth[0].x);
  const translationX=size*((destFrame[0].x+destFrame[2].x-sourceMouth[0].x-sourceMouth[2].x)*.5);
  const translationY=size*((destFrame[1].y+destFrame[3].y)*.5-sourceMid);
  const sourceWidth=su.at(-1).x-su[0].x;
  const boundaries=[0,.135,.252,.342,.424,.51];
  const laughWeight=config.weights?.['Laughing crying']??(config.emotion==='Laughing crying'?config.strength:0);
  // A broad laugh opens mostly by lowering the jaw. Keep the upper lip
  // close to the photographed crowns so the teeth stay attached.
  const upperShare=.38-.28*laughWeight;
  const sites=new Map();
  for(const [name,weight] of Object.entries(config.weights??{[config.emotion]:config.strength})){
    const effect=profiles[name]?.effect;
    if(weight>0 && effect in tongueSites){
      const col=clamp(Math.round(left+width*tongueSites[effect]-x0-.5),0,w-1);
      const entries=sites.get(col)??[];entries.push(effect);sites.set(col,entries);
    }
  }
  for(let ix=0;ix<w;ix++){
    const x=x0+ix+.5,t=clamp((x-left)/width,0,1),bell=Math.sin(Math.PI*t);
    const a=lineAt(upper,x),b=Math.max(a,lineAt(lower,x)),gap=b-a;
    const opening=openingFor(config,model,width,gap,bell);
    const newA=a+(gap-opening)*upperShare,newB=newA+opening;
    for(const effect of sites.get(ix)??[]){
      portrait.tongueAnchors[effect]={x:x/size,y:(newA+.59*opening)/size,width:width/size,gap:opening/size};
    }
    const high=Math.min(a,newA)-pad*.57,low=Math.max(b,newB)+pad*.78;
    const tx=sourceCenter+(x-translationX-sourceCenter)/Math.max(.1,scale);
    const toothTop=lineAt(su,tx),toothBottom=lineAt(sl,tx);
    // Teeth are fixed to the maxilla. Newly revealed enamel above the recorded
    // upper edge uses the photographed colour in that same tooth column.
    const crownExtension=Math.min(sourceWidth*.045,Math.max(0,toothBottom-toothTop)*.45);
    for(let iy=0;iy<rect.height;iy++){
      const y=y0+iy+.5;if(y<=high||y>=low)continue;
      const d=4*(iy*w+ix);
      if(keepPhoto&&(y<newA||y>=newB))continue;
      if(y<newA||y>=newB){
        // Move the photographed upper and lower lip margins independently.
        const edgeGuard=Math.min(2,gap*.15)*clamp((gap-opening)/Math.max(1,gap),0,1);
        const sampleY=y<newA?high+(a-edgeGuard-high)*(y-high)/Math.max(.01,newA-high):
          b+edgeGuard+(low-b-edgeGuard)*(y-newB)/Math.max(.01,low-newB);
        const yy=clamp(sampleY-y0-.5,0,rect.height-1.001),j=Math.floor(yy),f=yy-j,k=4*(j*w+ix);
        for(let c=0;c<3;c++)rect.data[d+c]=original[k+c]*(1-f)+original[k+4*w+c]*f;
        continue;
      }
      const ty=(y-translationY-sourceMid*size)/Math.max(.1,scale)+sourceMid*size+(1-config.mouth.exposure)*sourceWidth*.19;
      const cavity=model.ink.map((v,c)=>v*(1+.13*(y-newA)/Math.max(1,opening))+
        tongueWeight*bell*[24,5,7][c]*(.40+.60*(y-newA)/Math.max(1,opening)));
      let color=cavity;
      if(config.mouth.teeth==='Photo'&&model.teethVisible&&config.mouth.exposure>0&&tx>=su[0].x&&tx<=su.at(-1).x&&ty>=toothTop-crownExtension&&ty<=toothBottom){
        const sampleY=clamp(ty,toothTop+Math.min(1.4,(toothBottom-toothTop)*.18),toothBottom);
        const k=4*(clamp(Math.floor(sampleY),0,size-1)*size+clamp(Math.floor(tx),0,size-1));
        color=base.pixels.subarray(k,k+3);
      }else if(config.mouth.teeth==='Simple'&&config.mouth.exposure>0&&Math.abs(tx-sourceCenter)<sourceWidth*.51){
        const u=(tx-sourceCenter)/sourceWidth,mid=sourceMid*size;
        const offset=Math.abs(u),tooth=Math.max(1,boundaries.findIndex(bound=>bound>=offset));
        const across=(offset-boundaries[tooth-1])/(boundaries[tooth]-boundaries[tooth-1]);
        const seam=Math.exp(-(Math.min(across,1-across)**2)/.014);
        const edge=mid+sourceWidth*(.046-.23*u*u-.009*seam+(tooth===1?.003:0));
        const coverage=clamp(edge-ty+.5,0,1)*clamp(ty-mid+sourceWidth*.14,0,1);
        const rootShade=clamp((edge-ty)/(.13*sourceWidth),0,1);
        const shade=1-.24*offset-.12*seam-.13*rootShade;
        color=cavity.map((v,c)=>v+([239,231,217][c]*shade-v)*coverage);
      }
      // The upper incisors stay at their configured setback. Below them an
      // opening reveals the tongue root against the dark inside of the mouth.
      const oralFraction=(y-newA)/Math.max(1,opening);
      const incisorEdge=.31+.07*bell;
      const underTeeth=clamp((oralFraction-incisorEdge)*opening/1.7,0,1);
      if(tongueSocket && underTeeth>0)color=cavity.map((v,c)=>color[c]+tongueWeight*underTeeth*(v-color[c]));
      const edgeAlpha=clamp(Math.min(y-newA,newB-y)+.5,0,1);
      if(!keepPhoto)for(let c=0;c<3;c++)rect.data[d+c]+=edgeAlpha*(color[c]-rect.data[d+c]);
      if(layer&&edgeAlpha>=.5&&(useDepth||underTeeth*tongueWeight>.28)){
        for(let c=0;c<3;c++)layer.data[d+c]=useDepth?rect.data[d+c]:cavity[c];
        rect.data[d+3]=0;cutPixels++;
      }
    }
    // Continue the photographed row under the upper lip. Turning the head
    // can reveal that hidden margin without exposing a black gap above it.
    if(useDepth&&layer&&newB-newA>=3){
      const first=clamp(Math.ceil(newA-y0-.5),0,rect.height-1);
      const inside=Math.min(rect.height-1,first+1);
      const from=4*(inside*w+ix);
      for(let j=Math.max(0,first-Math.ceil(width*.055));j<first;j++){
        const d=4*(j*w+ix);
        for(let c=0;c<3;c++)layer.data[d+c]=layer.data[from+c];
      }
    }
  }
  if(!keepPhoto||cutPixels)ctx.putImageData(rect,x0,y0);
  if(cutPixels)portrait.dentalLayer={image:layer,left:x0,top:y0,size,width:width/size,cavityOnly:!useDepth};
}
