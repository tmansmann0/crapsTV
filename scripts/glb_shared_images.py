"""Keep shared PNG images external to GLB without altering geometry/materials.
The original exporter embeds the same six maps in both chip detail levels.
"""
import hashlib,json,struct
from pathlib import Path

def externalize_images(path, asset_dir):
    path=Path(path);data=path.read_bytes();json_size=struct.unpack_from('<I',data,12)[0]
    doc=json.loads(data[20:20+json_size]);binary=data[28+json_size:]
    removed=set()
    for image in doc.get('images',[]):
        file=asset_dir/(image['name']+'.png')
        if not file.exists():continue
        removed.add(image['bufferView'])
        image['uri']=file.name+'?v='+hashlib.sha256(file.read_bytes()).hexdigest()[:12]
        del image['bufferView'];image.pop('mimeType',None)
    views=[];parts=[];offset=0;remap={}
    for index,view in enumerate(doc['bufferViews']):
        if index in removed:continue
        old_offset=view.get('byteOffset',0);chunk=binary[old_offset:old_offset+view['byteLength']]
        padding=(-offset)%4
        if padding:parts.append(b'\0'*padding);offset+=padding
        copy=dict(view);copy['byteOffset']=offset;remap[index]=len(views);views.append(copy)
        parts.append(chunk);offset+=len(chunk)
    for accessor in doc.get('accessors',[]):
        if 'bufferView' in accessor:accessor['bufferView']=remap[accessor['bufferView']]
        if 'sparse' in accessor:
            for kind in ['indices','values']:
                accessor['sparse'][kind]['bufferView']=remap[accessor['sparse'][kind]['bufferView']]
    for image in doc.get('images',[]):
        if 'bufferView' in image:image['bufferView']=remap[image['bufferView']]
    doc['bufferViews']=views;doc['buffers'][0]['byteLength']=offset
    text=json.dumps(doc,separators=(',',':')).encode();text+=b' '*((-len(text))%4)
    blob=b''.join(parts);blob+=b'\0'*((-len(blob))%4)
    result=struct.pack('<III',0x46546c67,2,12+8+len(text)+8+len(blob))+struct.pack('<I4s',len(text),b'JSON')+text+struct.pack('<I4s',len(blob),b'BIN\0')+blob
    temporary=path.with_suffix('.pending.glb');temporary.write_bytes(result);temporary.replace(path)
    return len(removed)
