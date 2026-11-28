// Closing a photographed eye also has to cover its iris. Stretch a narrow
// strip of the person's upper-lid skin down to the lash line inside each eye.
export function closeLids(ctx,rest,posed,closures){
  const size=ctx.canvas.width;
  for(const [side,start] of [6,10].entries()){
    const amount=Math.min(1,closures[side]);if(amount<.035)continue;
    const left=posed[start].x*size,right=posed[start+2].x*size;
    const center=(posed[start+1].y+posed[start+3].y)*size*.5;
    const radius=Math.max(2,(rest[start+3].y-rest[start+1].y)*size*.5);
    const x0=Math.max(0,Math.floor(left-2)),x1=Math.min(size,Math.ceil(right+2));
    const y0=Math.max(0,Math.floor(center-radius*2.8)),y1=Math.min(size,Math.ceil(center+radius*2));
    if(x1<=x0||y1<=y0)continue;
    const frame=ctx.getImageData(x0,y0,x1-x0,y1-y0),src=frame.data.slice(),w=frame.width;
    for(let x=0;x<w;x++){
      const t=(x+x0-left)/(right-left);if(t<=0||t>=1)continue;
      const arch=Math.sin(Math.PI*t)**.65;
      const top=center-radius*1.06*arch,end=center+radius*.73*arch;
      const seam=top+(end-top)*amount;
      for(let y=Math.max(y0,Math.floor(top));y<Math.min(y1,Math.ceil(seam+1));y++){
        const f=Math.max(0,Math.min(1,(y-top)/Math.max(1,seam-top)));
        const sample=Math.max(0,Math.min(frame.height-1,Math.round(top-y0-radius*(.87-.63*f)*arch)));
        const opacity=Math.min(1,(y-top+1)/2,(seam+1-y)/1.8,arch*3,amount*1.7);
        const d=((y-y0)*w+x)*4,k=(sample*w+x)*4;
        const lash=1-.31*amount*Math.exp(-((y-seam)**2)/Math.max(1,radius*radius*.015));
        for(let c=0;c<3;c++)frame.data[d+c]+=opacity*(src[k+c]*lash-frame.data[d+c]);
      }
    }
    ctx.putImageData(frame,x0,y0);
  }
}

// Fill each eye opening from its orbital boundary. Low-frequency skin tone
// continues across the socket; fine texture comes from the adjacent cheek.
export function maskPhotoEyes(ctx,points,power){
  if(!(power>0))return;
  const size=ctx.canvas.width,alpha=Math.min(1,power/.40);
  for(const i of [6,10]){
    const a=points[i],b=points[i+2],dx=(b.x-a.x)*size,dy=(b.y-a.y)*size;
    const cx=(a.x+b.x)*size/2,cy=(points[i+1].y+points[i+3].y)*size/2;
    const span=Math.max(5,Math.hypot(dx,dy)),rx=span*.69,ry=Math.max(span*.225,(points[i+3].y-points[i+1].y)*size*.94);
    const cos=dx/span,sin=dy/span;
    const x0=Math.max(0,Math.floor(cx-rx-5)),x1=Math.min(size,Math.ceil(cx+rx+5));
    const y0=Math.max(0,Math.floor(cy-rx*.35-ry-7)),y1=Math.min(size,Math.ceil(cy+rx*.35+ry*3.2+7));
    if(x1<=x0||y1<=y0)continue;
    const frame=ctx.getImageData(x0,y0,x1-x0,y1-y0),src=frame.data.slice(),w=frame.width;
    function index(x,y){
      const sx=Math.min(w-1,Math.max(0,Math.round(cx+cos*x-sin*y)-x0));
      const sy=Math.min(frame.height-1,Math.max(0,Math.round(cy+sin*x+cos*y)-y0));return (sy*w+sx)*4;
    }
    for(let j=0;j<frame.height;j++)for(let k=0;k<w;k++){
      const px=x0+k-cx,py=y0+j-cy,x=px*cos+py*sin,y=-px*sin+py*cos;
      const distance=(x/rx)**2+(y/ry)**2;if(distance>=1)continue;
      const edge=ry*Math.sqrt(1-(x/rx)**2),v=(y+edge)/(2*edge);
      const upper=index(x,-edge-2),lower=index(x,edge+3),cheek=index(x,ry*2.0+y*.24);
      const cheekL=index(x-3,ry*2.0+y*.24),cheekR=index(x+3,ry*2.0+y*.24);
      const blend=alpha*Math.min(1,(1-distance)*6),d=4*(j*w+k);
      for(let ch=0;ch<3;ch++){
        const grain=src[cheek+ch]-(src[cheekL+ch]+src[cheekR+ch])*.5;
        const skin=src[upper+ch]*(1-v)+src[lower+ch]*v+Math.max(-7,Math.min(7,grain))*.42;
        frame.data[d+ch]+=blend*(skin-frame.data[d+ch]);
      }
    }
    ctx.putImageData(frame,x0,y0);
  }
}
