"""Remove unused secondary UV attributes from non-medallion GLB primitives.
No position/normal/index/UV0 payload changes; only live accessor/view compaction.
"""
import json,struct
from pathlib import Path

def compact_medallion_uv(path):
    path=Path(path);raw=path.read_bytes();length=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+length]);binary=raw[28+length:]
    assert not doc.get('animations') and not doc.get('skins')
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            if doc['materials'][primitive['material']]['name']!='ChipEngraving':primitive['attributes'].pop('TEXCOORD_1',None)
    used=sorted({index for m in doc['meshes'] for p in m['primitives'] for index in [*p['attributes'].values(),p['indices']]})
    accessor_map={old:new for new,old in enumerate(used)}
    views=sorted({doc['accessors'][i]['bufferView'] for i in used})
    view_map={old:new for new,old in enumerate(views)};parts=[];offset=0;newviews=[]
    for index in views:
        view=dict(doc['bufferViews'][index]);start=view.get('byteOffset',0)
        pad=(-offset)%4;parts.append(b'\0'*pad);offset+=pad
        parts.append(binary[start:start+view['byteLength']]);view['byteOffset']=offset;offset+=view['byteLength'];newviews.append(view)
    accessors=[]
    for index in used:
        accessor=dict(doc['accessors'][index]);accessor['bufferView']=view_map[accessor['bufferView']];accessors.append(accessor)
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            primitive['indices']=accessor_map[primitive['indices']]
            primitive['attributes']={key:accessor_map[index] for key,index in primitive['attributes'].items()}
    doc['accessors']=accessors;doc['bufferViews']=newviews;doc['buffers'][0]['byteLength']=offset
    text=json.dumps(doc,separators=(',',':')).encode();text+=b' '*((-len(text))%4)
    blob=b''.join(parts);blob+=b'\0'*((-len(blob))%4)
    data=struct.pack('<III',0x46546c67,2,28+len(text)+len(blob))+struct.pack('<I4s',len(text),b'JSON')+text+struct.pack('<I4s',len(blob),b'BIN\0')+blob
    temporary=path.with_suffix('.uv-pending.glb');temporary.write_bytes(data);temporary.replace(path)
