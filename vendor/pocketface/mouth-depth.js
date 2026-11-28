import * as T from 'three';

// The row follows the existing cheek curvature. Its setback is one translation
// of the entire mesh, independent of enamel colour or individual tooth edges.
export function toothSetback(width,amount){
  return 1.2*width*.12*amount;
}

function mouthPatch(head,bounds){
  const {uv,position}=head.attributes,ids=[],indices=[],lookup=new Map();
  for(let i=0;i<head.index.count;i+=3){
    const triangle=[0,1,2].map(k=>head.index.getX(i+k));
    const u=triangle.map(j=>uv.getX(j)),v=triangle.map(j=>uv.getY(j));
    if(triangle.every(j=>position.getZ(j)<=0)||Math.max(...u)<bounds.left||Math.min(...u)>bounds.right||
       Math.max(...v)<bounds.top||Math.min(...v)>bounds.bottom)continue;
    for(const j of triangle){
      if(!lookup.has(j)){lookup.set(j,ids.length);ids.push(j);}
      indices.push(lookup.get(j));
    }
  }
  const geometry=new T.BufferGeometry();
  for(const [key,components] of [['position',3],['normal',3],['uv',2]])
    geometry.setAttribute(key,new T.Float32BufferAttribute(ids.length*components,components));
  geometry.setIndex(indices);
  return {ids,geometry,bounds};
}

export function createMouthDepth(head){
  const bone=head.skeleton.getBoneByName('Head'),mount=new T.Group();
  mount.name='DentalMount';mount.matrixAutoUpdate=false;
  mount.matrix.copy(head.skeleton.boneInverses[head.skeleton.bones.indexOf(bone)]).multiply(head.bindMatrix);
  bone.add(mount);
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  const texture=new T.CanvasTexture(canvas);texture.flipY=false;texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;
  const material=head.material.clone();material.name='DentalRow';material.map=texture;material.alphaTest=0;
  const row=new T.Mesh(new T.BufferGeometry(),material);row.name='DentalRow';row.visible=false;mount.add(row);
  let patch,lastImage;
  function apply(layer,amount){
    row.visible=!!layer&&amount>0;
    if(!row.visible)return;
    const {image,left,top,size,width}=layer;
    const inset=toothSetback(width,amount);
    const x=left/size,y=top/size,w=image.width/size,h=image.height/size;
    // Overscan gives the lip opening a dark backing even at glancing angles.
    const margin=.11,box={left:x-margin,right:x+w+margin,top:y-margin,bottom:y+h+margin};
    const cached=patch?.bounds;
    if(!cached||box.left<cached.left||box.right>cached.right||box.top<cached.top||box.bottom>cached.bottom){
      row.geometry.dispose();
      patch=mouthPatch(head.geometry,{left:box.left-.025,right:box.right+.025,top:box.top-.025,bottom:box.bottom+.025});
      row.geometry=patch.geometry;
    }
    const src=head.geometry.attributes,dest=row.geometry.attributes;
    for(const [i,j] of patch.ids.entries()){
      dest.position.setXYZ(i,src.position.getX(j),src.position.getY(j),src.position.getZ(j));
      dest.normal.setXYZ(i,src.normal.getX(j),src.normal.getY(j),src.normal.getZ(j));
      dest.uv.setXY(i,(src.uv.getX(j)-x)/w,(src.uv.getY(j)-y)/h);
    }
    for(const attr of Object.values(dest))attr.needsUpdate=true;
    row.geometry.computeBoundingSphere();row.position.z=-inset;
    if(image!==lastImage){
      if(canvas.width!==image.width||canvas.height!==image.height){canvas.width=image.width;canvas.height=image.height;}
      ctx.putImageData(image,0,0);texture.needsUpdate=true;lastImage=image;
    }
  }
  return {apply,dispose(){mount.removeFromParent();row.geometry.dispose();material.dispose();texture.dispose();}};
}
