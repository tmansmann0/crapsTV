import * as T from 'three';

// Cross-sections run from the upper lip to the bridge. The light muzzle is
// continuous across the nostrils and recedes at the bridge and cheek edges.
export function snoutGeometry(){
  const sections=[
    [-1,.12,.14],[-.94,.49,.29],[-.79,.81,.47],[-.58,.99,.60],
    [-.35,1,.67],[-.12,.92,.72],[.12,.76,.59],[.40,.63,.43],
    [.69,.47,.24],[.90,.32,.13],[1,.11,.045]
  ];
  const pos=[],colors=[],idx=[],n=40;
  const bridge=new T.Color('#a8704e'),jowl=new T.Color('#dfb28a'),color=new T.Color();
  for(const [i,[y,width,depth]] of sections.entries()){
    for(let j=0;j<n;j++){
      const a=2*Math.PI*j/n,u=Math.cos(a),front=Math.sin(a),x=width*u;
      const cleft=Math.exp(-x*x/.027)*Math.max(0,-y)*Math.max(0,front);
      const z=front>=0?depth*front-.12*cleft:-.39*Math.abs(front);
      pos.push(x,y+.12*cleft,z);
      color.copy(bridge).lerp(jowl,T.MathUtils.smoothstep(.32-y,-.24,.90)).multiplyScalar(.95+.05*Math.max(0,front));
      colors.push(color.r,color.g,color.b);
      if(i<sections.length-1){const v=i*n+j,next=i*n+(j+1)%n;idx.push(v,v+n,next,next,v+n,next+n);}
    }
  }
  for(let j=1;j<n-1;j++){idx.push(0,j,j+1);const last=(sections.length-1)*n;idx.push(last,last+j+1,last+j);}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
  g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(idx);g.computeVertexNormals();return g;
}
