// The fitted contours stay attached to the photographed eye as the surrounding
// face moves. Manual placement uses the same four handles as the matcher.
const upperIndices = [362,398,384,385,386,387,388,466,263];
const lowerIndices = [362,382,381,380,374,373,390,249,263];
const mix = (a,b,t) => a+(b-a)*t;
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

export function winkContours(points,mesh,map) {
  const [inner,upper,outer,lower] = points.slice(10,14);
  const cornerLine = t => mix(inner.y,outer.y,t);
  function trace(indices,anchor,tip) {
    if (!mesh) return Array.from({length:13},(_,i) => {
      const t=i/12, apex=clamp((tip.x-inner.x)/Math.max(.0001,outer.x-inner.x),.2,.8);
      const arc=Math.sin(Math.PI*.5*(t<=apex?t/apex:(1-t)/(1-apex)));
      return map({x:mix(inner.x,outer.x,t),y:cornerLine(t)+arc*(tip.y-cornerLine(apex))});
    });
    const a=mesh[362], b=mesh[263], width=Math.max(.0001,b.x-a.x);
    const ratio=p=>(p.x-a.x)/width;
    const oldRise=p=>p.y-mix(a.y,b.y,ratio(p));
    const oldPeak=clamp(ratio(mesh[anchor]),.08,.92);
    const peak=clamp((tip.x-inner.x)/Math.max(.0001,outer.x-inner.x),.08,.92);
    return indices.map(i=>{
      const t=clamp(ratio(mesh[i]),0,1);
      const u=t<=oldPeak?peak*t/oldPeak:1-(1-peak)*(1-t)/(1-oldPeak);
      const rise=oldRise(mesh[anchor]);
      const h=Math.abs(rise)>.00001?oldRise(mesh[i])/rise:Math.sin(Math.PI*t);
      return map({x:mix(inner.x,outer.x,u),y:cornerLine(u)+h*(tip.y-cornerLine(peak))});
    });
  }
  return [trace(upperIndices,386,upper),trace(lowerIndices,374,lower)];
}

function heightAt(curve,x) {
  let i=1;
  while(i<curve.length-1 && curve[i].x<x)i++;
  const a=curve[i-1],b=curve[i];
  return mix(a.y,b.y,clamp((x-a.x)/Math.max(.001,b.x-a.x),0,1));
}

export function paintWink(ctx,contours,projected,weight) {
  const amount=clamp(weight,0,1);
  if(!amount || !contours)return;
  const size=ctx.canvas.width;
  const [upper,lower]=contours.map(curve=>curve.map(p=>{
    const q=projected(p);
    return {x:q.x*size-.5,y:q.y*size-.5};
  }).sort((a,b)=>a.x-b.x));
  const left=upper[0].x,right=upper.at(-1).x,span=right-left;
  if(span<2)return;
  const corners=upper.concat(lower),margin=span*.25+3;
  const x0=Math.max(0,Math.floor(left-1)),x1=Math.min(size,Math.ceil(right+2));
  const y0=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.y))-margin));
  const y1=Math.min(size,Math.ceil(Math.max(...corners.map(p=>p.y))+margin));
  if(x0>=x1 || y0>=y1)return;
  const image=ctx.getImageData(x0,y0,x1-x0,y1-y0),src=image.data.slice(),w=image.width;

  for(let x=x0;x<x1;x++) {
    const t=(x-left)/span;
    if(t<=0 || t>=1)continue;
    const taper=Math.sin(Math.PI*t)**.65;
    // Include antialiased lashes and the limbus outside the landmark polygon.
    const pad=(1+span*.025)*taper;
    const top=heightAt(upper,x)-pad, bottom=Math.max(top+1,heightAt(lower,x)+pad);
    const outerTop=top-(1+span*.14*taper),outerBottom=bottom+(1+span*.09*taper);
    const seam=mix(top,bottom,.76)+.012*span*taper;
    const topEdge=mix(top,seam,amount),bottomEdge=mix(bottom,seam,amount);
    const lashRadius=(.55+span*.014)*taper;
    // The folded lid reveals skin that was hidden in the source. Estimate its
    // diffuse colour across the orbital area so the open eye's upper shadow
    // doesn't stretch into vertical streaks across the shut lid.
    const skin=[0,0,0];
    for(const offset of [-.12,-.065,0,.065,.12]){
      const sx=clamp(Math.round(x+offset*span),x0,x1-1);
      const above=heightAt(upper,sx)-.10*span;
      const below=heightAt(lower,sx)+.105*span;
      const a=4*(clamp(Math.round(above-y0),0,image.height-1)*w+sx-x0);
      const b=4*(clamp(Math.round(below-y0),0,image.height-1)*w+sx-x0);
      for(let c=0;c<3;c++)skin[c]+=(.35*src[a+c]+.65*src[b+c])/5;
    }
    // Only skin from outside the eye opening is ever drawn on the moving lids.
    function color(y,c) {
      const sy=clamp(y-y0,0,image.height-1),row=Math.floor(sy);
      const k=4*(row*w+x-x0)+c;
      return mix(src[k],src[row+1<image.height?k+4*w:k],sy-row);
    }
    for(let y=Math.max(y0,Math.ceil(outerTop));y<Math.min(y1,Math.ceil(outerBottom));y++) {
      let sample=y,cover=0,unfold=0,rounding=1;
      if(y<=topEdge || (amount<1 && y<topEdge+.5 && y<(topEdge+bottomEdge)*.5)){
        const u=clamp((y-outerTop)/(topEdge-outerTop),0,1);
        sample=mix(outerTop,top-pad*.65*amount,u);
        cover=clamp(topEdge-y+.5,0,1);
        unfold=amount*taper*Math.min(1,u*1.65)*.93;
        rounding=1+.038*Math.sin(Math.PI*u)-.038*u*u;
      }else if(y>bottomEdge-.5 || amount===1){
        const u=clamp((y-bottomEdge)/(outerBottom-bottomEdge),0,1);
        sample=mix(bottom+pad*.6*amount,outerBottom,u);
        cover=clamp(y-bottomEdge+.5,0,1);
        unfold=amount*taper*(1-u)*.32;
      }
      if(amount===1)cover=1;
      const lash=amount*taper*.57*Math.exp(-((y-topEdge)**2)/(2*lashRadius**2));
      const k=4*((y-y0)*w+x-x0);
      for(let c=0;c<3;c++){
        const lid=mix(color(sample,c),skin[c]*rounding,unfold);
        image.data[k+c]=mix(src[k+c],lid,cover)*(1-lash);
      }
    }
  }
  ctx.putImageData(image,x0,y0);
}
