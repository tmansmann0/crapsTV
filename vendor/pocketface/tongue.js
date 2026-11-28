import * as T from 'three';

// Sections are expressed in mouth widths. Each path begins behind the lip
// surface, rounds over the lower lip, then takes the shape of the emote.
const paths={
  'tongue':[[0,.014,-.060],[0,.010,-.012],[0,-.010,.063],[.005,-.070,.115],[.010,-.16,.121],[.01,-.202,.095]],
  'side tongue':[[0,.011,-.053],[.017,.005,-.008],[.053,-.012,.051],[.103,-.036,.090],[.145,-.068,.090],[.170,-.085,.071]],
  'lick':[[0,.008,-.051],[-.012,.004,-.006],[-.049,-.008,.052],[-.116,.006,.077],[-.164,.062,.078],[-.177,.105,.051]],
  'dog':[[0,.012,-.061],[0,.004,-.011],[.006,-.022,.064],[.018,-.098,.115],[.023,-.191,.121],[.018,-.247,.101]]
};
export const tongueSites=Object.freeze({'tongue':.50,'side tongue':.66,'lick':.40,'dog':.50});

export function tongueGeometry(effect){
  const path=new T.CatmullRomCurve3(paths[effect].map(p=>new T.Vector3(...p)),false,'centripetal');
  const positions=[],colors=[],indices=[],rings=30,sections=24;
  const base=new T.Color('#65313c'),tip=new T.Color('#c9757d'),color=new T.Color();
  const wide=effect==='lick'?.092:effect==='side tongue'?.116:effect==='dog'?.135:.158;
  const side=new T.Vector3(1,0,0),normal=new T.Vector3(),turn=new T.Quaternion(),vertex=new T.Vector3();
  let previous=path.getTangentAt(0);
  side.addScaledVector(previous,-side.dot(previous)).normalize();
  for(let i=0;i<=rings;i++){
    const t=i/rings,center=path.getPointAt(t),tangent=path.getTangentAt(t);
    side.applyQuaternion(turn.setFromUnitVectors(previous,tangent)).normalize();
    normal.crossVectors(tangent,side).normalize();previous=tangent;
    const tipFraction=Math.max(0,(t-.68)/.32);
    const cap=Math.sqrt(Math.max(.0001,1-tipFraction*tipFraction));
    const shoulders=.64+.36*Math.sin(Math.PI*Math.min(1,t*.98));
    const radius=wide*shoulders*cap;
    const thickness=(.018+.010*Math.sin(Math.PI*t))*cap;
    for(let j=0;j<sections;j++){
      const angle=2*Math.PI*j/sections,u=Math.cos(angle),v=Math.sin(angle);
      // A shallow depression in the dorsal surface tapers before the tip.
      const dorsal=Math.max(0,v);
      const crease=.015*Math.exp(-u*u/.066)*dorsal*Math.sin(Math.PI*t);
      const grain=.013*Math.sin(46*t+13*u)*Math.sin(19*u-27*t)*dorsal;
      vertex.copy(center).addScaledVector(side,u*radius).addScaledVector(normal,v*thickness-crease);
      positions.push(...vertex.toArray());
      color.copy(base).lerp(tip,Math.min(1,t*1.26)).multiplyScalar(.89+.11*Math.max(0,v)-crease*5.5+grain);
      colors.push(color.r,color.g,color.b);
      if(i<rings){
        const a=i*sections+j,b=i*sections+(j+1)%sections;
        indices.push(a,b,a+sections,b,b+sections,a+sections);
      }
    }
  }
  for(let j=1;j<sections-1;j++){
    indices.push(0,j+1,j,rings*sections,rings*sections+j,rings*sections+j+1);
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  return geometry;
}
