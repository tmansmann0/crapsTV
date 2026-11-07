"""Render a real casino interior to a scene-linear equirectangular EXR.

blender --background --python scripts/build-environment.py
The room geometry and lighting are original; no photo or LDR image is used.
"""
import math
from pathlib import Path
import bpy
from mathutils import Vector

OUT = Path(__file__).resolve().parents[1] / "public/assets"
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def mat(name, color, rough=.5, metal=0, noise=0):
    m=bpy.data.materials.new(name); m.use_nodes=True
    n=m.node_tree.nodes; l=m.node_tree.links; b=n.get('Principled BSDF')
    b.inputs['Base Color'].default_value=(*color,1)
    b.inputs['Roughness'].default_value=rough
    b.inputs['Metallic'].default_value=metal
    if noise:
        tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=30
        tex.inputs['Detail'].default_value=3
        bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=noise
        bump.inputs['Distance'].default_value=.035
        l.new(tex.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs['Normal'],b.inputs['Normal'])
    return m

wood=mat('Dark oiled walnut',(.072,.023,.014),.3,0,.14)
wood2=mat('Walnut wall inset',(.115,.044,.024),.38,0,.11)
brass=mat('Antique brass',(.57,.34,.105),.3,.8)
cream=mat('Warm ivory plaster',(.49,.41,.31),.72,0,.06)
dark=mat('Blackened bronze',(.015,.013,.011),.3,.6)
red=mat('Oxblood velvet',(.16,.012,.018),.83,0,.22)
green=mat('Jade felt',(.012,.105,.071),.92,0,.12)
glass=mat('Smoky gold glass',(.085,.067,.037),.16,.58)
floor=mat('Burgundy patterned carpet',(.061,.009,.015),.95,0,.26)
black=mat('Black lacquer',(.007,.008,.008),.22,.2)
blue=mat('Midnight window',(.007,.017,.035),.26,.25)

# Woven, subtle alternating bands make the floor read as a carpet at grazing angles.
n=floor.node_tree.nodes;l=floor.node_tree.links;b=n.get('Principled BSDF')
tex=n.new('ShaderNodeTexVoronoi');tex.distance='EUCLIDEAN';tex.feature='DISTANCE_TO_EDGE'
tex.inputs['Scale'].default_value=2.4
r=n.new('ShaderNodeValToRGB');r.color_ramp.elements[0].position=.007
r.color_ramp.elements[0].color=(.10,.042,.019,1)
r.color_ramp.elements[1].position=.015;r.color_ramp.elements[1].color=(.060,.008,.014,1)
coord=n.new('ShaderNodeTexCoord');l.new(coord.outputs['Object'],tex.inputs['Vector'])
l.new(tex.outputs['Distance'],r.inputs[0]);l.new(r.outputs['Color'],b.inputs['Base Color'])

def emit(name, color, power):
    m=bpy.data.materials.new(name);m.use_nodes=True
    b=m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value=(*color,1)
    b.inputs['Emission Color'].default_value=(*color,1)
    b.inputs['Emission Strength'].default_value=power
    b.inputs['Roughness'].default_value=.6
    return m

lamp=emit('Warm opal shades', (1.,.69,.36),7)
cove=emit('Concealed amber lighting',(1.,.42,.14),9)
window=emit('Distant night windows',(.13,.23,.39),.65)

def finish(obj,name,m,bev=0):
    obj.name=name;obj.data.materials.append(m)
    if bev:
        mod=obj.modifiers.new('Soft edges','BEVEL');mod.width=bev;mod.segments=2
        obj.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return obj

def box(name, loc, scale, m, bev=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    o=bpy.context.object;o.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,name,m,bev)

def cyl(name,loc,radius,depth,m,vertices=48):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=loc)
    o=bpy.context.object
    for p in o.data.polygons:p.use_smooth=True
    return finish(o,name,m)

def sphere(name,loc,scale,m):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=1,location=loc)
    o=bpy.context.object;o.scale=scale
    for p in o.data.polygons:p.use_smooth=True
    return finish(o,name,m)

def area(name,loc,power,size,color,target):
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;d.color=color
    o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);o.location=loc
    o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
    return o

def torus(name,loc,major,minor,m):
    bpy.ops.mesh.primitive_torus_add(major_radius=major,minor_radius=minor,major_segments=64,minor_segments=10,location=loc)
    return finish(bpy.context.object,name,m)

# Enclosing architecture: meters, Z up. Camera and playing table are at the origin.
box('Carpet floor',(0,0,-.11),(24.4,18.4,.2),floor)
box('Ivory ceiling',(0,0,5.55),(24.4,18.4,.15),cream)
for y in [-9,9]:
    box('Upper plaster wall',(0,y,3.3),(24,.24,4.4),cream)
    box('Walnut wainscoting',(0,y,1.15),(24,.29,2.3),wood)
    for z,h,m in [(0.15,.28,wood),(2.28,.10,brass),(2.4,.18,wood),(5.17,.26,wood),(5.37,.07,cove)]:
        box('Continuous cornice',(0,y-.18*math.copysign(1,y),z),(24,.20,h),m,.015)
    for x in range(-11,12,2):
        box('Raised wall panel',(x,y-.18*math.copysign(1,y),1.20),(1.70,.06,1.65),wood2,.025)
        for off in [-.88,.88]:box('Panel brass bead',(x+off,y-.22*math.copysign(1,y),1.2),(.018,.025,1.77),brass)
for x in [-12,12]:
    box('Side plaster wall',(x,0,3.3),(.24,18,4.4),cream)
    box('Side walnut wall',(x,0,1.15),(.28,18,2.3),wood)
    for z,h,m in [(0.15,.28,wood),(2.28,.10,brass),(2.4,.18,wood),(5.17,.26,wood),(5.37,.07,cove)]:
        box('Side cornice',(x-.18*math.copysign(1,x),0,z),(.20,18,h),m,.015)
    for y in range(-8,9,2):
        box('Side raised panel',(x-.18*math.copysign(1,x),y,1.2),(.06,1.7,1.65),wood2,.025)

# Ceiling coffers: large floating inset grid with warm brass pinstripes.
for x in [-8,-4,0,4,8]:
    box('Coffer beam',(x,0,5.31),(.19,17.5,.27),wood,.035)
    box('Coffer brass reveal',(x,0,5.16),(.035,17.5,.02),brass)
for y in [-6,-2,2,6]:
    box('Cross coffer beam',(0,y,5.31),(23.5,.19,.27),wood,.035)
    box('Cross brass reveal',(0,y,5.16),(23.5,.035,.02),brass)

# Pilasters and wall sconces give the room a human scale and bright HDR emitters.
for x in [-10,-6,-2,2,6,10]:
    for y in [-8.78,8.78]:
        box('Fluted pilaster',(x,y,3.0),(.35,.25,4.65),wood,.025)
        for dx in [-.11,0,.11]:box('Pilaster brass flute',(x+dx,y-.15*math.copysign(1,y),3.2),(.025,.04,3.1),brass)
        sy=y-.36*math.copysign(1,y)
        box('Sconce backplate',(x,sy,3.2),(.46,.10,.86),brass,.07)
        box('Opal sconce shade',(x,sy-.12*math.copysign(1,y),3.2),(.25,.17,.65),lamp,.075)
        area('Sconce bounce',(x,sy-.24*math.copysign(1,y),3.15),45,1.,(1,.62,.31),(x,0,2.))

# Tall night windows on the side walls, with original fan-shaped Art Deco mullions.
for side in [-1,1]:
    x=side*11.82
    for y in [-5,0,5]:
        box('Window dark frame',(x,y,3.53),(.08,2.72,2.63),wood,.05)
        box('Night glass',(x-side*.06,y,3.53),(.03,2.5,2.4),blue)
        for off in [-1.21,0,1.21]:box('Window upright',(x-side*.09,y+off,3.53),(.045,.035,2.46),brass)
        for z in [2.34,3.25,4.72]:box('Window horizontal',(x-side*.09,y,z),(.045,2.47,.035),brass)
        for off in [-.74,-.34,.34,.74]:
            rib=box('Window deco fan',(x-side*.105,y+off,4.08),(.035,.028,1.27),brass)
            rib.rotation_euler.x=off*.47
        for off,z in [(-.8,2.7),(.65,3.),(.9,4.1),(-.45,4.3)]:
            box('Distant city glow',(x-side*.08,y+off,z),(.008,.10,.18),window)

# Five-tier chandeliers, individual opal shades with brass rims and radial stems.
def chandelier(x,y,large=False):
    radius=1.0 if large else .72
    cyl('Chandelier ceiling rose',(x,y,5.15),.22,.10,brass)
    cyl('Suspension',(x,y,4.65),.026,1.0,brass)
    cyl('Central opal drum',(x,y,4.16),radius,.37,lamp,64)
    for z in [3.96,4.34]:torus('Chandelier brass rim',(x,y,z),radius,.037,brass)
    cyl('Chandelier base',(x,y,3.91),radius*.54,.08,brass)
    sphere('Chandelier drop',(x,y,3.77),(.12,.12,.18),lamp)
    for a in range(0,360,45):
        ang=math.radians(a);dx=math.cos(ang);dy=math.sin(ang)
        o=box('Drum brass rib',(x+dx*radius,y+dy*radius,4.15),(.028,.028,.38),brass)
    area('Chandelier illumination',(x,y,3.90),300 if large else 210,2.,(1.,.73,.43),(x,y,0))
for x,y in [(-7,-4),(0,-5),(7,-4),(-7,4),(0,4),(7,4)]:chandelier(x,y,x==0)

# The far wall is a polished bar with glassware and individual original bottles.
box('Bar cabinet',(0,7.20,.57),(9.5,1.,1.14),wood,.08)
box('Stone bar top',(0,7.12,1.18),(9.8,1.25,.12),black,.07)
box('Bar brass edging',(0,6.48,1.18),(9.7,.035,.08),brass,.015)
for x in [-4,-2,0,2,4]:
    box('Bar decorative panel',(x,6.66,.59),(1.66,.06,.77),wood2,.045)
    for dx in [-.76,.76]:box('Bar panel inlay',(x+dx,6.61,.59),(.028,.025,.68),brass)
foot= cyl('Brass foot rail',(0,6.36,.25),.034,9.5,brass)
foot.rotation_euler.y=math.pi/2
for x in [-4,-2,0,2,4]:
    cyl('Bar stool foot',(x,5.8,.06),.28,.10,dark)
    cyl('Bar stool stem',(x,5.8,.42),.04,.68,brass)
    cyl('Burgundy stool seat',(x,5.8,.78),.31,.16,red)
    torus('Stool footrest',(x,5.8,.31),.18,.018,brass)
    box('Stool back',(x,5.5,1.01),(.48,.13,.44),red,.13)
box('Back bar mirror',(0,8.73,2.93),(9.3,.07,2.32),glass,.08)
for x in [-4.6,-2.3,0,2.3,4.6]:box('Back bar brass frame',(x,8.66,2.93),(.07,.13,2.36),brass,.012)
for z in [1.78,2.42,3.14,4.10]:
    box('Bar shelf',(0,8.35,z),(9.4,.65,.065),wood,.02)
    box('Bar shelf light',(0,8.04,z-.04),(9.15,.018,.018),cove)
bottle_mats=[mat('Amber bottle',(.12,.044,.01),.2,.08),mat('Green bottle',(.018,.070,.027),.2,.08),mat('Ruby bottle',(.11,.009,.009),.25,.1)]
for row,z in enumerate([1.84,2.48,3.20]):
    for i in range(25):
        x=-4.2+i*.35;h=.29+(i%4)*.045
        cyl('Bottle body',(x,8.29,z+h/2),.070,h,bottle_mats[(i+row)%3],16)
        cyl('Bottle neck',(x,8.29,z+h+.07),.032,.14,bottle_mats[(i+row)%3],16)
        cyl('Bottle cork',(x,8.29,z+h+.14),.034,.024,brass,12)
        box('Bottle label',(x,8.215,z+h*.50),(.105,.009,.11),cream,.008)

# Surrounding gaming tables. The center remains open for the app's actual craps table.
def gaming_table(x,y,rotation=0):
    o=box('Walnut gaming table',(x,y,.80),(3.15,1.65,.22),wood,.33);o.rotation_euler.z=rotation
    o=box('Padded gaming rail',(x,y,.96),(3.30,1.80,.18),red,.36);o.rotation_euler.z=rotation
    o=box('Jade gaming felt',(x,y,1.06),(2.95,1.43,.045),green,.28);o.rotation_euler.z=rotation
    for dx in [-1.,1.]:
        for dy in [-.49,.49]:box('Gaming table leg',(x+dx,y+dy,.42),(.15,.15,.80),wood,.025)
    for dx in [-1.,0,1.]:
        for dy in [-1.3,1.3]:
            sx=x+dx;sy=y+dy
            cyl('Chair foot',(sx,sy,.04),.20,.07,dark)
            cyl('Chair stem',(sx,sy,.25),.035,.43,brass)
            cyl('Chair seat',(sx,sy,.49),.27,.13,red)
            box('Chair back',(sx,sy+math.copysign(.23,dy),.79),(.45,.11,.5),red,.12)
    for dx in [-1.,-.5,0,.5,1.]:
        for j in range(3):cyl('Casino chip stack',(x+dx,y,.1*j/4+1.107),.047,.020,brass,16)
for x,y,a in [(-7,-4,0),(7,-4,0),(-7,3,0),(7,3,0)]:gaming_table(x,y,a)

# Quiet lounge against the wall behind the viewer, furniture clear of the center.
for x in [-7,0,7]:
    box('Lounge banquette',(x,-7.75,.49),(3.6,1.0,.64),red,.20)
    box('Lounge back',(x,-8.15,1.08),(3.6,.3,1.1),red,.16)
    cyl('Lounge round tabletop',(x,-6.65,.70),.59,.07,wood)
    cyl('Lounge table stem',(x,-6.65,.36),.05,.65,brass)
    cyl('Lounge table base',(x,-6.65,.035),.30,.07,dark)

# Camera: horizontal center looks toward +Y (bar). The seam is on the lounge wall.
bpy.ops.object.camera_add(location=(0,0,1.60))
camera=bpy.context.object;camera.name='Panorama eye at center table'
camera.rotation_euler=(math.pi/2,0,0)
camera.data.type='PANO';camera.data.panorama_type='EQUIRECTANGULAR'
camera.data.longitude_min=-math.pi;camera.data.longitude_max=math.pi
camera.data.latitude_min=-math.pi/2;camera.data.latitude_max=math.pi/2
scene=bpy.context.scene;scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.samples=32
scene.cycles.use_denoising=True;scene.cycles.adaptive_threshold=.035
scene.cycles.max_bounces=8;scene.cycles.diffuse_bounces=4;scene.cycles.glossy_bounces=4
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='METAL';prefs.get_devices()
    for device in prefs.devices:device.use=device.type=='METAL'
    scene.cycles.device='GPU'
except Exception:
    scene.cycles.device='CPU'
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.07,.09,.14,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.045
scene.render.resolution_x=4096;scene.render.resolution_y=2048
scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
scene.view_settings.look='AgX - Medium High Contrast'
scene.view_settings.exposure=0;scene.view_settings.gamma=1
scene.render.image_settings.file_format='OPEN_EXR'
scene.render.image_settings.color_depth='16';scene.render.image_settings.color_mode='RGB'
scene.render.image_settings.exr_codec='ZIP'
scene.render.filepath=str(OUT/'casino-room.exr')
scene.render.film_transparent=False
bpy.ops.render.render(write_still=True)
scene.render.image_settings.file_format='PNG'
scene.render.image_settings.color_mode='RGB';scene.render.image_settings.color_depth='8'
bpy.data.images['Render Result'].save_render(str(OUT/'casino-room-preview.png'),scene=scene)

# Validate the actual linear EXR buffer independently of the AgX preview.
image=bpy.data.images.load(str(OUT/'casino-room.exr'))
import numpy as np
values=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(values)
rgba=values.reshape((scene.render.resolution_y,scene.render.resolution_x,4));rgb=rgba[:,:,:3]
print('CASINO_LINEAR_RANGE',float(rgb.min()),float(rgb.max()),'BRIGHT_PIXELS',int(np.sum(np.max(rgb,axis=2)>1)))
print('CASINO_RENDER',str(OUT/'casino-room.exr'))
print('CASINO_PREVIEW',str(OUT/'casino-room-preview.png'))
