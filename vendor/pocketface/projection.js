import {creaseMap} from './cheeks.js';
import {compositeMouth} from './mouth.js';
// Stretch each horizontal slice of the photographed face across the corresponding
// slice of the head. Coordinates stay in the rig's undeformed UV space so a new
// jaw or skull shape carries the same edge-to-edge wrap.
const top=.5-.636/1.28, bottom=.5+.636/1.28;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function headRadius(v){
  const latitude=clamp((.5-v)*1.28/.636,-1,1);
  return .498*(1+.16*latitude)*Math.sqrt(Math.max(.0001,1-latitude*latitude))/1.20;
}
export function portraitTransform(points,image,outline){
  const l=points[6],r=points[8],s=points[10],t=points[12];
  const left={x:(l.x+r.x)*image.width/2,y:(l.y+r.y)*image.height/2};
  const right={x:(s.x+t.x)*image.width/2,y:(s.y+t.y)*image.height/2};
  const cx=(left.x+right.x)/2,cy=(left.y+right.y)/2;
  const dx=right.x-left.x,dy=right.y-left.y,dist=Math.max(1,Math.hypot(dx,dy)),c=dx/dist,sn=dy/dist;
  const local=p=>{const x=p.x*image.width-cx,y=p.y*image.height-cy;return {x:c*x+sn*y,y:-sn*x+c*y};};
  const polygon=(outline||points.slice(0,6)).map(local);
  const low=Math.min(...polygon.map(p=>p.y)),high=Math.max(...polygon.map(p=>p.y)),height=Math.max(1,high-low);
  const eyeFraction=clamp(-low/height,.26,.60),eyeTarget=.475;
  const curve=(eyeFraction-eyeTarget)/(eyeTarget*(1-eyeTarget));
  function limits(y){
    y=clamp(y,low+.002*height,high-.002*height);
    let a=Infinity,b=-Infinity;
    for(let i=0;i<polygon.length;i++){
      const p=polygon[i],q=polygon[(i+1)%polygon.length];
      if((p.y>y)===(q.y>y))continue;
      const x=p.x+(q.x-p.x)*(y-p.y)/(q.y-p.y);a=Math.min(a,x);b=Math.max(b,x);
    }
    if(!Number.isFinite(a)||b<=a)return {mid:0,width:1};
    return {mid:(a+b)/2,width:Math.max(1,(b-a)*.48)};
  }
  function row(y){
    const u=clamp((y-top)/(bottom-top),0,1);
    const sy=low+height*clamp(u+curve*u*(1-u),.012,.982);
    return {...limits(sy),sy,radius:headRadius(y)};
  }
  return {
    row,c,sn,cx,cy,local,
    map(p){
      const {x,y}=local(p),s=clamp((y-low)/height,0,1);
      const u=Math.abs(curve)<.00001?s:2*s/(1+curve+Math.sqrt(Math.max(0,(1+curve)**2-4*curve*s)));
      const v=top+(bottom-top)*u,{mid,width}=limits(y);
      return {x:.5+(x-mid)/width*headRadius(v),y:v};
    }
  };
}
function fitTexture(portrait,size,skinColor){
  const {image,transform}=portrait;
  const source=image.getContext('2d',{willReadFrequently:true}).getImageData(0,0,image.width,image.height).data;
  const surface=document.createElement('canvas');surface.width=surface.height=size;
  const g=surface.getContext('2d',{willReadFrequently:true}),frame=g.createImageData(size,size),out=frame.data;
  const skin=[1,3,5].map(i=>parseInt(skinColor.slice(i,i+2),16));
  for(let j=0;j<size;j++){
    const y=(j+.5)/size,{mid,width,sy,radius}=transform.row(y);
    for(let i=0;i<size;i++){
      const x=(i+.5)/size, f=(x-.5)/radius;
      const sx=mid+width*clamp(f,-1,1);
      const u=clamp(transform.cx+transform.c*sx-transform.sn*sy,0,image.width-1.001);
      const v=clamp(transform.cy+transform.sn*sx+transform.c*sy,0,image.height-1.001);
      const ix=Math.floor(u),iy=Math.floor(v),wx=u-ix,wy=v-iy;
      const a=4*(iy*image.width+ix),b=a+4*image.width,k=4*(j*size+i);
      // The front silhouette is entirely photographic. Beyond it this strip
      // transitions through the temples into the skin tone at the back seam.
      const rear=clamp((Math.abs(x-.5)-radius)/Math.max(.015,.49-radius),0,1);
      for(let ch=0;ch<3;ch++){
        const color=(source[a+ch]*(1-wx)+source[a+4+ch]*wx)*(1-wy)+(source[b+ch]*(1-wx)+source[b+4+ch]*wx)*wy;
        out[k+ch]=color*(1-rear)+skin[ch]*rear;
      }
      out[k+3]=255;
    }
  }
  g.putImageData(frame,0,0);
  return {surface,pixels:out};
}
// A regularized thin-plate spline interpolates the inverse displacement smoothly.
// Fixed outline samples keep cheeks and the edge of the photo attached to the head.
const radial=r=>r>1e-12?r*Math.log(r):0;
function inverseField(src,dst,outline){
  const pins=outline.filter((_,i)=>i%Math.max(1,Math.floor(outline.length/9))===0);
  const ref=src.slice(6).concat(pins), ctrl=dst.slice(6).concat(pins);
  const n=ctrl.length,m=n+3, rows=Array.from({length:m},()=>new Float64Array(m+2));
  for(let i=0;i<n;i++){
    const p=ctrl[i];
    for(let j=0;j<n;j++)rows[i][j]=radial((p.x-ctrl[j].x)**2+(p.y-ctrl[j].y)**2);
    rows[i][i]+=.0008;rows[i][n]=rows[n][i]=1;rows[i][n+1]=rows[n+1][i]=p.x;rows[i][n+2]=rows[n+2][i]=p.y;
    rows[i][m]=ref[i].x-p.x;rows[i][m+1]=ref[i].y-p.y;
  }
  for(let j=0;j<m;j++){
    let pivot=j;for(let i=j+1;i<m;i++)if(Math.abs(rows[i][j])>Math.abs(rows[pivot][j]))pivot=i;
    if(Math.abs(rows[pivot][j])<1e-12)return ()=>[0,0];
    [rows[j],rows[pivot]]=[rows[pivot],rows[j]];
    const div=rows[j][j];for(let k=j;k<m+2;k++)rows[j][k]/=div;
    for(let i=0;i<m;i++)if(i!==j){const f=rows[i][j];for(let k=j;k<m+2;k++)rows[i][k]-=f*rows[j][k];}
  }
  return (x,y)=>{
    let a=rows[n][m]+x*rows[n+1][m]+y*rows[n+2][m],b=rows[n][m+1]+x*rows[n+1][m+1]+y*rows[n+2][m+1];
    for(let i=0;i<n;i++){const k=radial((x-ctrl[i].x)**2+(y-ctrl[i].y)**2);a+=k*rows[i][m];b+=k*rows[i][m+1];}
    return [a,b];
  };
}
function warp(portrait,dest,base,size,reference,relax){
  const field=inverseField(reference,dest,(portrait.outline??portrait.points.slice(0,6)).map(portrait.transform.map));
  const step=16,n=Math.ceil(size/step)+1,grid=new Float32Array(n*n*2);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)grid.set(field(x*step/size,y*step/size).map(v=>v*size),2*(y*n+x));
  const layer=portrait.warped??=document.createElement('canvas');
  if(layer.width!==size||layer.height!==size)layer.width=layer.height=size;
  const ctx=layer.getContext('2d');const image=portrait.output??=ctx.createImageData(size,size),out=image.data,src=base.pixels;
  for(let y=0;y<size;y++){
    const j=Math.floor(y/step),fy=y/step-j;
    for(let x=0;x<size;x++){
      const i=Math.floor(x/step),fx=x/step-i,k=2*(j*n+i),below=k+2*n;
      const offset=c=>(grid[k+c]*(1-fx)+grid[k+2+c]*fx)*(1-fy)+(grid[below+c]*(1-fx)+grid[below+2+c]*fx)*fy;
      const sx=clamp(x+offset(0),0,size-1.001),sy=clamp(y+offset(1),0,size-1.001),ix=Math.floor(sx),iy=Math.floor(sy),d=4*(y*size+x);
      if(ix<0||iy<0||ix>=size-1||iy>=size-1){out[d+3]=0;continue;}
      const s=4*(iy*size+ix),t=s+4*size, wx=sx-ix,wy=sy-iy;
      for(let c=0;c<4;c++)out[d+c]=(c<3 && relax ? relax*base.crease[s/4] : 0)+(src[s+c]*(1-wx)+src[s+4+c]*wx)*(1-wy)+(src[t+c]*(1-wx)+src[t+4+c]*wx)*wy;
    }
  }
  ctx.putImageData(image,0,0);return layer;
}
export function projectPortrait(ctx,portrait,dest,config,dentalFrame,reference,relax){
  const skinColor=config.skin;
  const size=ctx.canvas.width;
  if(!portrait.texture||portrait.skinColor!==skinColor){
    portrait.texture=fitTexture(portrait,size,skinColor);portrait.skinColor=skinColor;portrait.warpKey=null;
  }
  const base=portrait.texture;
  if(relax && !base.crease)base.crease=creaseMap(base,portrait.fitted,size);
  const key=relax.toFixed(4)+'/'+dest.map(p=>p.x.toFixed(5)+','+p.y.toFixed(5)).join('/');
  if(key!==portrait.warpKey){
    const neutral=dest.every((p,i)=>Math.abs(p.x-reference[i].x)+Math.abs(p.y-reference[i].y)<1e-6);
    portrait.forward=neutral?()=>[0,0]:inverseField(dest,reference,(portrait.outline??portrait.points.slice(0,6)).map(portrait.transform.map));
    portrait.rendered=neutral?base.surface:warp(portrait,dest,base,size,reference,relax);portrait.warpKey=key;
  }
  ctx.drawImage(portrait.rendered,0,0,1,1);
  compositeMouth(ctx,portrait,base,dentalFrame,portrait.forward,config);
}
