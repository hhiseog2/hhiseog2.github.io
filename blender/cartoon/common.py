"""Shared tools for the screening-room cartoon trio (rq: screening section): paint materials, mesh helpers, the character body + rig,
the three actions, toon export and preview renders. Started from the hologram trio's tools (git febf8db:blender/common.py).

Run through export_all.py:  blender --background --factory-startup --python blender/cartoon/export_all.py
Blender is Z up and the characters face -Y; the glTF exporter turns that into +Y up, facing +Z (toward a three.js camera).
Everything is modelled in true colours from the character sheets (reference/sax.png, bass.png, frontman.png); finalize_toon() then
keeps those colours as a vertex colour (for colorReveal) and swaps the materials for three tiers: toon_white, toon_grey, toon_black.
"""
import math
import os
import json
import struct

import bpy
import bmesh
from mathutils import Matrix, Vector, Quaternion
from mathutils.kdtree import KDTree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
MODELS = os.path.join(ROOT, "public", "models", "cartoon")
PREVIEWS = os.path.join(HERE, "previews")

FPS = 30
BPM = 160
EMERGE_FRAMES = 30        # 1.0s
SOLO_FRAMES = 90          # 8 beats at 160 BPM = 3.0s, loops
RETURN_FRAMES = 30        # 1.0s
SOLO_BEATS = 8
LOOP_FRAMES = SOLO_FRAMES
BEATS = SOLO_BEATS

V = Vector
rad = math.radians


# ---------------------------------------------------------------- scene

def reset_scene():
    """Every build starts from an empty file, so re-running gives the same result."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 0
    scene.frame_end = LOOP_FRAMES
    scene.frame_set(0)
    return scene


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def update():
    bpy.context.view_layer.update()


def activate(obj, others=()):
    bpy.ops.object.select_all(action="DESELECT")
    for o in others:
        o.select_set(True)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


# ---------------------------------------------------------------- materials

def material(name, color, metallic=0.0, roughness=0.5, alpha=1.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None) or nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        nt.links.new(bsdf.outputs[0], out.inputs[0])
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        try:
            m.blend_method = "BLEND"
        except Exception:
            pass
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            pass
    m.diffuse_color = (*color, alpha)
    return m


# paint name -> (linear-ish sRGB colour picked from the sheets, toon tier). The tier decides the black-and-white look on the site;
# the colour only comes back when colorReveal is on.
PAINT = {
    "skin": ((0.94, 0.84, 0.74), "white"),
    "cream": ((0.93, 0.90, 0.80), "white"),
    "white": ((0.97, 0.96, 0.93), "white"),
    "beige": ((0.86, 0.78, 0.64), "white"),
    "tan": ((0.80, 0.68, 0.47), "grey"),
    "brass": ((0.78, 0.62, 0.34), "grey"),
    "wood": ((0.86, 0.64, 0.38), "grey"),
    "green": ((0.38, 0.48, 0.38), "grey"),
    "darkgreen": ((0.26, 0.34, 0.28), "black"),
    "silver": ((0.70, 0.70, 0.70), "grey"),
    "black": ((0.07, 0.07, 0.08), "black"),
}
TIERS = {"white": (0.96, 0.95, 0.92), "grey": (0.55, 0.55, 0.55), "black": (0.08, 0.08, 0.09)}


def paint(name):
    col, tier = PAINT[name]
    m = material("paint_" + name, tuple(c ** 2.2 for c in col), roughness=0.7)
    m["tier"] = tier
    m["srgb"] = col
    return m


def character_materials():
    return {k: paint(k) for k in PAINT}


# ---------------------------------------------------------------- mesh helpers

def shade(obj, angle=40.0):
    me = obj.data
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    if angle is not None and hasattr(me, "set_sharp_from_angle"):
        me.set_sharp_from_angle(angle=rad(angle))
    me.update()


def fix_normals(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(obj.data)
    bm.free()


def mesh_obj(name, bm, mat=None, smooth=40.0, normals=True):
    if normals:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = link(bpy.data.objects.new(name, me))
    if mat:
        me.materials.append(mat)
    if smooth is not False:
        shade(obj, smooth)
    return obj


def z_to(vec):
    """Rotation that points the local Z axis along vec."""
    return V(vec).to_track_quat("Z", "Y").to_matrix().to_4x4()


def seg_matrix(p0, p1):
    p0, p1 = V(p0), V(p1)
    return Matrix.Translation((p0 + p1) / 2) @ z_to(p1 - p0)


def cyl(name, r1, r2, depth, matrix, mat, seg=16, caps=True, smooth=40.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=depth, matrix=matrix)
    return mesh_obj(name, bm, mat, smooth)


def rod(name, p0, p1, r, mat, seg=10, r2=None):
    p0, p1 = V(p0), V(p1)
    return cyl(name, r, r if r2 is None else r2, (p1 - p0).length, seg_matrix(p0, p1), mat, seg)


def box(name, center, size, mat, rot=None, bevel=0.0, segments=2, smooth=40.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=V(size), verts=bm.verts[:])
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=segments, profile=0.5, affect="EDGES")
    m = Matrix.Translation(V(center)) @ (rot if rot is not None else Matrix.Identity(4))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts[:])
    return mesh_obj(name, bm, mat, smooth)


def sphere(name, matrix, mat, u=16, v=10, smooth=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1.0, matrix=matrix)
    return mesh_obj(name, bm, mat, smooth)


def apply_modifiers(obj):
    """Bake the modifier stack into the mesh (only used before an object is skinned)."""
    update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = obj.data
    obj.modifiers.clear()
    obj.data = me
    me.name = obj.name
    bpy.data.meshes.remove(old)
    return obj


def lathe(name, profile, mat, steps=24, matrix=None, smooth=40.0):
    """Profile curve + Screw modifier. profile = [(radius, height), ...] in the XZ plane, turned around Z."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([(r, 0.0, z) for r, z in profile], [(i, i + 1) for i in range(len(profile) - 1)], [])
    obj = link(bpy.data.objects.new(name, me))
    mod = obj.modifiers.new("Screw", "SCREW")
    mod.axis = "Z"
    mod.angle = math.tau
    mod.steps = mod.render_steps = steps
    mod.use_merge_vertices = True
    mod.merge_threshold = 1e-5
    mod.use_normal_calculate = True
    apply_modifiers(obj)
    fix_normals(obj)
    if matrix is not None:
        obj.data.transform(matrix)
    if mat:
        obj.data.materials.append(mat)
    if smooth is not False:
        shade(obj, smooth)
    return obj


def tube(name, pts, radii, mat, bevel_res=2, res=6, caps=True, smooth=None):
    """Bezier curve with a round bevel; the per-point radius is the taper. Returned as a mesh."""
    pts = [V(p) for p in pts]
    cu = bpy.data.curves.new(name + "_curve", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 1.0
    cu.bevel_resolution = bevel_res
    cu.resolution_u = res
    cu.use_fill_caps = caps
    sp = cu.splines.new("BEZIER")
    sp.bezier_points.add(len(pts) - 1)
    for i, bp in enumerate(sp.bezier_points):
        prev_p = pts[max(i - 1, 0)]
        next_p = pts[min(i + 1, len(pts) - 1)]
        tan = (next_p - prev_p)
        if tan.length < 1e-9:
            tan = V((0, 0, 1))
        tan.normalize()
        bp.co = pts[i]
        bp.handle_left_type = bp.handle_right_type = "FREE"
        bp.handle_left = pts[i] - tan * ((pts[i] - prev_p).length / 3.0 if i > 0 else 0.01)
        bp.handle_right = pts[i] + tan * ((next_p - pts[i]).length / 3.0 if i < len(pts) - 1 else 0.01)
        bp.radius = radii[i] if hasattr(radii, "__len__") else radii
    cobj = link(bpy.data.objects.new(name + "_curve", cu))
    update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(cobj.evaluated_get(dg), depsgraph=dg)
    me.name = name
    bpy.data.objects.remove(cobj)
    bpy.data.curves.remove(cu)
    obj = link(bpy.data.objects.new(name, me))
    me.materials.clear()
    if mat:
        me.materials.append(mat)
    shade(obj, smooth)
    return obj


def join(objs, name):
    objs = [o for o in objs if o is not None]
    first = objs[0]
    if len(objs) > 1:
        activate(first, objs[1:])
        bpy.ops.object.join()
    first.name = name
    first.data.name = name
    return first


def set_group(obj, group, weight=1.0):
    vg = obj.vertex_groups.get(group) or obj.vertex_groups.new(name=group)
    vg.add(range(len(obj.data.vertices)), weight, "REPLACE")
    return obj


def material_by(obj, pick):
    """pick(face centre) -> material slot index."""
    me = obj.data
    for p in me.polygons:
        p.material_index = pick(p.center)


def tri_count(objs):
    total = 0
    for o in objs:
        if o.type == "MESH":
            total += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return total


def decimate_to(obj, ratio):
    """Collapse-decimate a (possibly skinned) mesh; vertex groups are kept."""
    mod = obj.modifiers.new("Decimate", "DECIMATE")
    mod.ratio = ratio
    activate(obj)
    bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)
    bpy.ops.object.modifier_apply(modifier=mod.name)


# ---------------------------------------------------------------- character body

def body_joints(s=1.0, shoulder=0.185, hip=0.095, stance=0.11, arm_angle=40.0, upper=0.29, fore=0.26):
    """Joint positions of a 1.75m figure (head 1 : height 6.5), scaled by s. A-pose, facing -Y, left = +X."""
    J = {
        "hips": V((0, 0, 0.97)), "spine": V((0, 0, 1.10)), "chest": V((0, 0, 1.25)), "upper_chest": V((0, 0, 1.39)),
        "neck": V((0, 0, 1.47)), "head": V((0, 0, 1.53)), "head_top": V((0, 0, 1.75)),
    }
    a = rad(arm_angle)
    for side, sx in (("L", 1.0), ("R", -1.0)):
        d = V((sx * math.sin(a), 0, -math.cos(a)))
        sh = V((sx * shoulder, 0, 1.41))
        el = sh + d * upper + V((0, 0.03, 0))
        wr = el + d * fore + V((0, -0.03, 0))
        palm = wr + d * 0.075
        J["shoulder_" + side] = sh
        J["elbow_" + side] = el
        J["wrist_" + side] = wr
        J["palm_" + side] = palm
        J["tip_" + side] = palm + d * 0.095
        J["thumb_" + side] = palm + V((0, -0.06, 0)) + d * 0.015
        J["hip_" + side] = V((sx * hip, 0, 0.92))
        J["knee_" + side] = V((sx * stance, -0.03, 0.50))
        J["ankle_" + side] = V((sx * stance * 1.1, 0.025, 0.085))
        J["ball_" + side] = V((sx * stance * 1.15, -0.10, 0.042))
        J["toe_" + side] = V((sx * stance * 1.2, -0.185, 0.036))
    return {k: v * s for k, v in J.items()}


BASE_RADII = {
    "hips": 0.146, "spine": 0.136, "chest": 0.156, "upper_chest": 0.142, "neck": 0.062, "head": 0.058,
    "shoulder": 0.076, "elbow": 0.056, "wrist": 0.040, "palm": 0.046, "tip": 0.032, "thumb": 0.021,
    "hip": 0.112, "knee": 0.075, "ankle": 0.056, "ball": 0.052, "toe": 0.044,
}       # Skin radii; Subdivision pulls the surface in by about a fifth

SKIN_ORDER = ["hips", "spine", "chest", "upper_chest", "neck", "head"] + [
    part + "_" + side for side in ("L", "R")
    for part in ("shoulder", "elbow", "wrist", "palm", "tip", "thumb", "hip", "knee", "ankle", "ball", "toe")]

SKIN_EDGES = [("hips", "spine"), ("spine", "chest"), ("chest", "upper_chest"), ("upper_chest", "neck"), ("neck", "head")] + [
    (a.replace("#", side), b.replace("#", side)) for side in ("L", "R") for a, b in (
        ("upper_chest", "shoulder_#"), ("shoulder_#", "elbow_#"), ("elbow_#", "wrist_#"), ("wrist_#", "palm_#"),
        ("palm_#", "tip_#"), ("palm_#", "thumb_#"),
        ("hips", "hip_#"), ("hip_#", "knee_#"), ("knee_#", "ankle_#"), ("ankle_#", "ball_#"), ("ball_#", "toe_#"))]


def skin_body(name, joints, edges, radii, root_index=0, levels=2):
    """Skeleton mesh -> Skin modifier (radius per joint) -> Subdivision, applied."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(joints, edges, [])
    obj = link(bpy.data.objects.new(name, mesh))
    skin = obj.modifiers.new("Skin", "SKIN")
    skin.use_smooth_shade = True
    for i, (v, r) in enumerate(zip(obj.data.skin_vertices[0].data, radii)):
        v.radius = (r, r)
        v.use_root = (i == root_index)
    obj.modifiers.new("Subsurf", "SUBSURF").levels = levels
    apply_modifiers(obj)
    return obj


def build_body(name, J, s, mat, build=1.0, radii=None, depth=0.78):
    r = dict(BASE_RADII)
    r.update(radii or {})
    joints = [J[n] for n in SKIN_ORDER]
    rr = [r[n.split("_")[0] if n[-2:] in ("_L", "_R") else n] * s * build for n in SKIN_ORDER]
    edges = [(SKIN_ORDER.index(a), SKIN_ORDER.index(b)) for a, b in SKIN_EDGES]
    obj = skin_body(name, joints, edges, rr)
    # the Skin hull is round in section: press the torso front-to-back so it reads as a chest, not a barrel
    lo, hi, wide = 0.84 * s, 1.50 * s, 0.26 * s
    for v in obj.data.vertices:
        z, x = v.co.z, abs(v.co.x)
        if lo < z < hi and x < wide:
            w = min(1.0, (z - lo) / (0.08 * s), (hi - z) / (0.08 * s)) * min(1.0, (wide - x) / (0.06 * s))
            v.co.y *= 1.0 - (1.0 - depth) * w
    fix_normals(obj)
    obj.data.materials.append(mat)
    shade(obj, None)
    return obj


def build_head(J, s, mat, width=0.09, jaw=0.22):
    """Head with only the outline of a nose and ears. All of it follows the head bone."""
    c = J["head_top"] - V((0, 0, 0.135 * s))
    rx, ry, rz = width * s, 0.105 * s, 0.135 * s
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=14, radius=1.0)
    for v in bm.verts:
        if v.co.z < 0:                                   # narrower toward the chin, chin a little forward
            t = -v.co.z
            v.co.x *= 1.0 - jaw * t
            v.co.y = v.co.y * (1.0 - 0.10 * t) - 0.07 * t
        v.co = V((v.co.x * rx, v.co.y * ry, v.co.z * rz)) + c
    head = mesh_obj("head", bm, mat, None)
    nose = cyl("nose", 0.021 * s, 0.006 * s, 0.05 * s,
               Matrix.Translation(c + V((0, -ry - 0.006 * s, -0.022 * s))) @ z_to((0, -1, -0.45)), mat, seg=8, smooth=None)
    parts = [head, nose]
    for sx in (1, -1):
        parts.append(sphere("ear", Matrix.Translation(c + V((sx * rx * 0.99, 0.012 * s, -0.005 * s))) @
                            Matrix.Diagonal((0.012 * s, 0.022 * s, 0.034 * s, 1)), mat, u=8, v=6))
    obj = join(parts, "head")
    set_group(obj, "head")
    return obj, c


# ---------------------------------------------------------------- rig

VERTICAL = ("hips", "spine", "chest", "neck", "head")
EULER_BONES = ("cap", "sax_lo", "sax_hi", "bass_spin", "root")


class Rig:
    def __init__(self, arm):
        self.arm = arm
        self.rest = {b.name: b.matrix_local.copy() for b in arm.data.bones}
        for pb in arm.pose.bones:
            pb.rotation_mode = "XYZ" if pb.name in VERTICAL or pb.name.startswith("fingers") or pb.name.endswith("_hold") or pb.name in EULER_BONES else "QUATERNION"

    def pb(self, name):
        return self.arm.pose.bones[name]

    # --- targets: a world-space hand matrix -> the target bone's local values (its parent taken at rest)
    def hand_matrix(self, side, wrist, fingers, palm):
        """wrist position, direction the fingers point, direction the palm faces."""
        y = V(fingers).normalized()
        x = V(palm) * (1.0 if side == "L" else -1.0)
        x = (x - y * x.dot(y)).normalized()
        z = x.cross(y).normalized()
        m = Matrix((x, y, z)).transposed().to_4x4()
        m.translation = V(wrist)
        return m

    def grip_matrix(self, side, grip, fingers, palm, palm_len):
        """Same, but given the point the palm should rest on."""
        d = V(fingers).normalized()
        return self.hand_matrix(side, V(grip) - d * palm_len, d, palm)

    def basis(self, bone, world):
        m = self.rest[bone].inverted() @ world
        return m.to_translation(), m.to_quaternion()

    def basis_in(self, bone, world, parent):
        """basis() for a bone whose parent is posed: world (armature space, as posed now) is first taken back to the parent's rest."""
        return self.basis(bone, self.rest[parent] @ self.posed(parent).inverted() @ world)

    def offset(self, bone, d, pitch=0.0):
        """Move a bone by d (armature space) from its rest place, tipping it by pitch degrees about X (feet: + points the toes down)."""
        m = self.rest[bone]
        w = Matrix.Translation(m.translation + V(d)) @ Matrix.Rotation(rad(pitch), 4, "X") @ m.to_3x3().to_4x4()
        loc, quat = self.basis(bone, w)
        pb = self.pb(bone)
        pb.location = loc
        if pb.rotation_mode == "QUATERNION":
            pb.rotation_quaternion = quat

    def set_target(self, bone, loc, quat, frame=None):
        pb = self.pb(bone)
        pb.location = loc
        pb.rotation_quaternion = quat
        if frame is not None:
            pb.keyframe_insert("location", frame=frame)
            pb.keyframe_insert("rotation_quaternion", frame=frame)

    def key_rot(self, bone, frame, x=0.0, y=0.0, z=0.0):
        pb = self.pb(bone)
        pb.rotation_euler = (rad(x), rad(y), rad(z))
        pb.keyframe_insert("rotation_euler", frame=frame)

    def key_loc(self, bone, frame, loc):
        pb = self.pb(bone)
        pb.location = loc
        pb.keyframe_insert("location", frame=frame)

    def posed(self, bone):
        update()
        dg = bpy.context.evaluated_depsgraph_get()
        return self.arm.evaluated_get(dg).pose.bones[bone].matrix.copy()

    def name_action(self, name="play"):
        ad = self.arm.animation_data
        ad.action.name = name
        return ad.action


def build_rig(name, J, s, hand_parents=None, extra_bones=None):
    """Bones at the joints. Legs and arms are solved by IK toward target bones, so feet stay planted and hands stay on the instrument."""
    hand_parents = hand_parents or {}
    ad = bpy.data.armatures.new(name)
    arm = link(bpy.data.objects.new(name, ad))
    activate(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = ad.edit_bones
    fwd, up = V((0, -1, 0)), V((0, 0, 1))

    def bone(bname, head, tail, parent=None, connect=False, roll=fwd, deform=True):
        b = eb.new(bname)
        b.head, b.tail = V(head), V(tail)
        b.align_roll(roll)
        if parent:
            b.parent = eb[parent]
            b.use_connect = connect
        b.use_deform = deform
        return b

    bone("root", (0, 0, 0), (0, 0, 0.12 * s), deform=False)
    bone("hips", J["hips"], J["spine"], "root")
    bone("spine", J["spine"], J["chest"], "hips", True)
    bone("chest", J["chest"], J["neck"], "spine", True)
    bone("neck", J["neck"], J["head"], "chest", True)
    bone("head", J["head"], J["head_top"], "neck", True)
    for side in ("L", "R"):
        k = lambda n: J[n + "_" + side]
        bone("upper_arm_" + side, k("shoulder"), k("elbow"), "chest")
        bone("forearm_" + side, k("elbow"), k("wrist"), "upper_arm_" + side, True)
        bone("hand_" + side, k("wrist"), k("palm"), "forearm_" + side, True)
        bone("fingers_" + side, k("palm"), k("tip"), "hand_" + side, True)
        bone("thigh_" + side, k("hip"), k("knee"), "hips")
        bone("shin_" + side, k("knee"), k("ankle"), "thigh_" + side, True)
        bone("foot_" + side, k("ankle"), k("toe"), "shin_" + side, True, roll=up)
    for spec in (extra_bones or []):
        bname, head, tail, parent = spec[:4]
        bone(bname, head, tail, parent, deform=spec[4] if len(spec) > 4 else False)
    for side in ("L", "R"):
        k = lambda n: J[n + "_" + side]
        bone("ik_foot_" + side, k("ankle"), k("toe"), "root", roll=up, deform=False)
        bone("ik_hand_" + side, k("wrist"), k("palm"), hand_parents.get(side, "chest"), deform=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    for side in ("L", "R"):
        for chain_tip, target, follower in (("shin_", "ik_foot_", "foot_"), ("forearm_", "ik_hand_", "hand_")):
            ik = arm.pose.bones[chain_tip + side].constraints.new("IK")
            ik.target, ik.subtarget, ik.chain_count = arm, target + side, 2
            ik.iterations = 200
            cr = arm.pose.bones[follower + side].constraints.new("COPY_ROTATION")
            cr.target, cr.subtarget = arm, target + side
    return Rig(arm)


def bind(body, rig):
    """Automatic (bone heat) weights; nearest-bone weights for anything the solver left out."""
    arm = rig.arm
    activate(arm, [body])
    try:
        bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    except Exception as e:
        print("   auto weights raised:", e)
    deform = [b for b in arm.data.bones if b.use_deform]
    missing = [v.index for v in body.data.vertices if not any(g.weight > 1e-4 for g in v.groups)]
    if missing:
        print("   auto weights left %d of %d vertices unweighted: nearest-bone weights for those" % (len(missing), len(body.data.vertices)))
        if body.parent is not arm:
            body.parent = arm
        if not any(m.type == "ARMATURE" for m in body.modifiers):
            body.modifiers.new("Armature", "ARMATURE").object = arm
        groups = {b.name: (body.vertex_groups.get(b.name) or body.vertex_groups.new(name=b.name)) for b in deform}
        for i in missing:
            p = body.data.vertices[i].co
            ds = []
            for b in deform:
                a, c = b.head_local, b.tail_local
                t = max(0.0, min(1.0, (p - a).dot(c - a) / (c - a).length_squared))
                ds.append(((p - (a + (c - a) * t)).length, b.name))
            ds.sort()
            w = [1.0 / (d + 1e-4) ** 4 for d, _ in ds[:2]]
            for (d, bname), wi in zip(ds[:2], w):
                groups[bname].add([i], wi / sum(w), "REPLACE")
    return body


def dominant_bones(obj):
    names = [g.name for g in obj.vertex_groups]
    out = []
    for v in obj.data.vertices:
        best = max(v.groups, key=lambda g: g.weight, default=None)
        out.append(names[best.group] if best else "")
    return out


def transfer_weights(src, dst):
    """Copy skin weights to a garment from the nearest body vertex."""
    kd = KDTree(len(src.data.vertices))
    for v in src.data.vertices:
        kd.insert(v.co, v.index)
    kd.balance()
    names = [g.name for g in src.vertex_groups]
    dst.vertex_groups.clear()
    groups = {n: dst.vertex_groups.new(name=n) for n in names}
    for v in dst.data.vertices:
        _, idx, _ = kd.find(v.co)
        for g in src.data.vertices[idx].groups:
            if g.weight > 1e-4:
                groups[names[g.group]].add([v.index], g.weight, "REPLACE")


ARM_BONES = ("upper_arm", "forearm", "hand", "fingers")


def garment(name, body, keep_vertex, mats, puff=0.015, thickness=0.006, widen=1.0, bands=None, clips=None, tail=None):
    """Shirt: a copy of the body's faces, pushed out along the normals and given thickness with Solidify.

    keep_vertex(index, co) -> bool picks (generously) the body vertices the garment covers.
    clips = [(point, normal, region(co, arm) -> bool), ...] then cuts the hem, collar, armholes and cuffs as clean edges:
            whatever lies past the plane, among the geometry inside region, is removed. arm = how much of that point's skin
            weight belongs to the arm bones (0..1): what is sleeve and what is torso is read from the weights, not guessed from
            the distance to the arm (that guess took the sides of the waist for sleeve and left the hem cut ragged).
    bands = [(z0, z1, material index), ...] cuts clean horizontal stripes into it.
    tail = (hem height, how far the cloth hangs below it, flare, reach) lets the shirt hang straight below the hem;
           reach = how far above the hem the shirt starts to leave the body for that straight fall (long = boxy, oversized).
    """
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    keep = [keep_vertex(v.index, v.co) for v in bm.verts]
    layer = bm.verts.layers.deform.verify()
    names = [g.name for g in body.vertex_groups]
    arm_groups = {i for i, n in enumerate(names) if n.rsplit("_", 1)[0] in ARM_BONES}
    hips = names.index("hips")

    def arm(v):
        d = v[layer]
        total = sum(d.values())
        return sum(w for k, w in d.items() if k in arm_groups) / total if total > 0 else 0.0

    # push out first, along the smooth normals of the whole body: the cuts below then leave straight, clean edges
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * puff
        if widen != 1.0:
            v.co.x *= widen
            v.co.y *= widen
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not all(keep[v.index] for v in f.verts)], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    for co, no, region in (clips or []):
        inside = {v for v in bm.verts if region(v.co, arm(v))}
        geom = list(inside) + [e for e in bm.edges if all(v in inside for v in e.verts)] + [f for f in bm.faces if all(v in inside for v in f.verts)]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, clear_outer=True, dist=1e-5)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    if tail:
        # A long shirt does not follow the legs: it is cut where the body is still one loop (the waist) and the cloth hangs straight
        # down from that edge, as part of the same surface.
        hem_z, drop, flare, reach = tail
        hem_edges = [e for e in bm.edges if len(e.link_faces) == 1 and all(abs(v.co.z - hem_z) < 1e-4 for v in e.verts)]
        loop = {v for e in hem_edges for v in e.verts}
        # the cut must be one closed loop: every point on it has exactly two hem edges
        degree = {v: 0 for v in loop}
        for e in hem_edges:
            for v in e.verts:
                degree[v] += 1
        if len(loop) < 8 or len(hem_edges) != len(loop) or any(d != 2 for d in degree.values()):
            raise RuntimeError("%s: the hem at z = %.3f is not one closed loop (%d edges, %d points)" % (name, hem_z, len(hem_edges), len(loop)))
        # Pushing out along the normals folds the surface where the body is concave. The lower part of the shirt is rounded toward
        # an ellipse the size of the waist (fully so at the hem), so it falls straight and the loop has no folds in it.
        cx = 0.0
        cy = (max(v.co.y for v in loop) + min(v.co.y for v in loop)) / 2
        rx = max(abs(v.co.x - cx) for v in loop)
        ry = max(abs(v.co.y - cy) for v in loop)

        def onto(v, grow=1.0, w=1.0):
            a = math.atan2((v.co.y - cy) / ry, (v.co.x - cx) / rx)
            v.co.x += (cx + rx * grow * math.cos(a) - v.co.x) * w
            v.co.y += (cy + ry * grow * math.sin(a) - v.co.y) * w

        torso = [v for v in bm.verts if v.co.z < hem_z + reach and arm(v) < 0.5]
        for v in torso:
            w = min(1.0, 2.0 * (hem_z + reach - v.co.z) / reach)
            onto(v, 1.0, w * w * (3.0 - 2.0 * w))
        # the tail: the hem loop itself drawn down in two steps (welded to the shirt: one surface, no second piece)
        hanging, edges = [], hem_edges
        for dz, grow in ((-drop * 0.5, (1.0 + flare) / 2), (-drop, flare)):
            made = bmesh.ops.extrude_edge_only(bm, edges=edges)["geom"]
            new = [g for g in made if isinstance(g, bmesh.types.BMVert)]
            edges = [g for g in made if isinstance(g, bmesh.types.BMEdge) and all(abs(v.co.z - hem_z) < 1.0 and v in new for v in g.verts)]
            for v in new:
                onto(v, grow)
                v.co.z = hem_z + dz
            hanging += new
        bm.normal_update()
        # the hanging cloth follows the hips only. Left with the body's weights, neighbouring points follow the left thigh, the
        # right thigh or the hips, and the hem breaks into a fringe as soon as the knees bend.
        for v in torso + hanging:
            w = min(1.0, max(0.0, (hem_z + reach - v.co.z) / reach) ** 1.5 * 1.6)
            d = v[layer]
            for k in list(d.keys()):
                d[k] = d[k] * (1.0 - w)
            d[hips] = d.get(hips, 0.0) + w
    for z0, z1, _ in (bands or []):
        for z in (z0, z1):
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, z), plane_no=(0, 0, 1), dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = link(bpy.data.objects.new(name, me))
    for m in mats:
        me.materials.append(m)
    for p in me.polygons:
        p.material_index = 0
        for z0, z1, idx in (bands or []):
            if z0 < p.center.z < z1:
                p.material_index = idx
    # the copy carries the body's own skin weights (cut edges get interpolated ones), so the cloth moves exactly with the body under it.
    # Looking weights up by nearest vertex after the push-out gave a saw-toothed hem: neighbours picked hip or thigh at random.
    for n in names:
        obj.vertex_groups.new(name=n)
    sol = obj.modifiers.new("Solidify", "SOLIDIFY")
    sol.thickness = thickness
    sol.offset = -1.0
    apply_modifiers(obj)
    shade(obj, None)
    if [g.name for g in obj.vertex_groups] != names or not any(v.groups for v in obj.data.vertices):
        print("   %s: skin weights were lost on the way, copying from the nearest body vertex" % name)
        transfer_weights(body, obj)
    return obj


def parent_to_bone(obj, rig, bone, pose_matrix):
    """Bone-parent an object modelled in world space at the pose where that bone's matrix is pose_matrix."""
    arm = rig.arm
    obj.parent = arm
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    length = arm.data.bones[bone].length
    obj.matrix_parent_inverse = (arm.matrix_world @ pose_matrix @ Matrix.Translation((0, length, 0))).inverted()


# ---------------------------------------------------------------- hats and props (from the character sheets)

def _crown(name, profile, k, mats_list, pick, steps=28, smooth=None):
    obj = lathe(name, [(r * k, z * k) for r, z in profile], None, steps=steps, smooth=smooth)
    for m in mats_list:
        obj.data.materials.append(m)
    material_by(obj, pick)
    return obj


def _visor(k, inner, outer, z0, z1, mat, name="visor", front=-1.0, spread=0.84):
    """A flat half ring, pointing forward (front = -1: toward -Y) and a little down, thickened with Solidify."""
    bm = bmesh.new()
    n = 12
    rows = []
    for i in range(n + 1):
        a = math.pi * (i / n) * spread + math.pi * (1 - spread) / 2
        cx, cy = math.cos(a), front * math.sin(a)
        reach = inner + (outer - inner) * math.sin(math.pi * i / n) ** 0.6
        rows.append((bm.verts.new((cx * inner, cy * inner * 1.10, z0 * k)), bm.verts.new((cx * reach * 0.92, cy * reach * 1.10, z1 * k))))
    for a_, b_ in zip(rows, rows[1:]):
        bm.faces.new((a_[0], a_[1], b_[1], b_[0]))
    visor = mesh_obj(name, bm, mat, None, normals=False)
    sol = visor.modifiers.new("Solidify", "SOLIDIFY")
    sol.thickness = 0.007 * k
    apply_modifiers(visor)
    fix_normals(visor)
    return visor


def _profile_radius(profile, z):
    for (r0, z0), (r1, z1) in zip(profile, profile[1:]):
        if min(z0, z1) <= z <= max(z0, z1):
            return r0 + (r1 - r0) * (z - z0) / (z1 - z0 if abs(z1 - z0) > 1e-9 else 1e-9)
    return None


def hat_newsboy(J, s, mats, center, group="head"):
    """Saxophonist: a puffy flat cap in cream with black dots, a short visor and a button on top, tipped forward."""
    k = s
    profile = [(0.100, 0.000), (0.106, 0.018), (0.128, 0.040), (0.150, 0.060), (0.152, 0.078), (0.132, 0.094), (0.090, 0.104), (0.040, 0.109), (0.0, 0.110)]
    crown = _crown("newsboy", profile, k, [mats["cream"], mats["black"]], lambda c: 1 if c.z < 0.012 * k else 0, steps=32)
    puff = lambda y, z: 1.0 + (0.22 if y < 0 else 0.0) * min(1.0, max(0.0, z) / (0.06 * k))
    for v in crown.data.vertices:                     # the puff hangs over the forehead
        v.co.y *= puff(v.co.y, v.co.z)
    visor = _visor(k, 0.100 * k, 0.150 * k, 0.004, -0.012, mats["black"])
    button = sphere("cap_button", Matrix.Translation((0, -0.01 * k, 0.110 * k)) @ Matrix.Diagonal((0.014 * k, 0.014 * k, 0.008 * k, 1)), mats["black"], u=8, v=5)
    parts = [crown, visor, button]
    # the print: small black dots over the crown (flat discs, a few triangles each)
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(52):
        z = 0.024 + 0.080 * (i / 51)
        r = _profile_radius(profile, z)
        if r is None or r < 0.05:
            continue
        a = i * golden
        y = math.sin(a) * r
        p = V((math.cos(a) * r, y * puff(y, z * k), z)) * k
        n = V((math.cos(a), math.sin(a), 1.2 * (z - 0.07) / 0.04)).normalized()
        parts.append(cyl("dot", 0.0085 * k, 0.0085 * k, 0.003 * k, Matrix.Translation(p + n * 0.001 * k) @ z_to(n), mats["black"], seg=6, smooth=None))
    obj = join(parts, "newsboy")
    obj.data.transform(Matrix.Translation(center + V((0, -0.008 * k, 0.050 * k))) @ Matrix.Rotation(rad(10), 4, "X") @ Matrix.Rotation(rad(-8), 4, "Y"))
    shade(obj, None)
    return set_group(obj, group)


def hat_porkpie(J, s, mats, center, group="head"):
    """Bassist: a cream hat with a short crown, a flat top, a black band and a turned-up brim."""
    k = s
    profile = [(0.165, 0.004), (0.172, -0.004), (0.160, -0.010), (0.120, -0.004), (0.104, 0.004), (0.102, 0.030), (0.100, 0.070), (0.098, 0.088),
               (0.088, 0.098), (0.060, 0.100), (0.0, 0.098)]
    obj = _crown("porkpie", profile, k, [mats["cream"], mats["black"]],
                 lambda c: 1 if 0.006 * k < c.z < 0.036 * k and (c.x * c.x + c.y * c.y) < (0.11 * k) ** 2 else 0, steps=32, smooth=35.0)
    for v in obj.data.vertices:
        v.co.y *= 1.10
        if (v.co.x ** 2 + v.co.y ** 2) > (0.13 * k) ** 2:        # brim snapped down at the front and back
            v.co.z -= 0.022 * k * (abs(v.co.y) / (0.18 * k)) ** 2
    obj.data.transform(Matrix.Translation(center + V((0, 0.004 * k, 0.060 * k))) @ Matrix.Rotation(rad(-4), 4, "X"))
    return set_group(obj, group)


def hat_captain(J, s, mats, center, group="head"):
    """Frontman: white captain's cap, crown wider than the band, black band and black visor at the front, a small badge."""
    k = s
    profile = [(0.100, 0.000), (0.102, 0.040), (0.112, 0.058), (0.140, 0.082), (0.146, 0.096), (0.136, 0.106), (0.080, 0.112), (0.0, 0.113)]
    crown = _crown("captain", profile, k, [mats["white"], mats["black"]], lambda c: 1 if c.z < 0.040 * k else 0, steps=32)
    for v in crown.data.vertices:
        v.co.y *= 1.08
    visor = _visor(k, 0.100 * k, 0.175 * k, 0.004, -0.026, mats["black"], spread=0.80)
    badge = cyl("badge", 0.012 * k, 0.012 * k, 0.004 * k, Matrix.Translation((0, -0.112 * k, 0.026 * k)) @ z_to((0, -1, 0)), mats["beige"], seg=10)
    cord = rod("cord", (-0.09 * k, -0.098 * k, 0.046 * k), (0.09 * k, -0.098 * k, 0.046 * k), 0.004 * k, mats["beige"], seg=6)
    obj = join([crown, visor, badge, cord], "captain_cap")
    obj.data.transform(Matrix.Translation(center + V((0, 0.0, 0.052 * k))) @ Matrix.Rotation(rad(-3), 4, "X"))
    shade(obj, None)
    return set_group(obj, group)


def sunglasses(J, s, mats, center, group="head"):
    """Two dark round lenses, a bridge and thin arms back to the ears."""
    k = s
    eye_z, front = center.z + 0.012 * k, center.y - 0.100 * k
    parts = []
    for sx in (1, -1):
        m = Matrix.Translation((sx * 0.038 * k, front - 0.004 * k, eye_z)) @ z_to((sx * 0.22, -1, 0))
        parts.append(cyl("lens", 0.030 * k, 0.026 * k, 0.010 * k, m, mats["black"], seg=16))
        parts.append(rod("arm", (sx * 0.066 * k, front + 0.004 * k, eye_z + 0.008 * k), (sx * 0.093 * k, center.y + 0.010 * k, eye_z + 0.004 * k), 0.0035 * k, mats["black"], seg=6))
    parts.append(rod("bridge", (-0.012 * k, front - 0.010 * k, eye_z + 0.010 * k), (0.012 * k, front - 0.010 * k, eye_z + 0.010 * k), 0.004 * k, mats["black"], seg=6))
    obj = join(parts, "sunglasses")
    return set_group(obj, group)


def mustache(J, s, mats, center, group="head"):
    k = s
    y, z = center.y - 0.100 * k, center.z - 0.046 * k
    pts = [(-0.040 * k, y + 0.022 * k, z - 0.012 * k), (-0.020 * k, y + 0.003 * k, z), (0.0, y - 0.003 * k, z + 0.003 * k),
           (0.020 * k, y + 0.003 * k, z), (0.040 * k, y + 0.022 * k, z - 0.012 * k)]
    obj = tube("mustache", [V(p) for p in pts], [0.004 * k, 0.010 * k, 0.011 * k, 0.010 * k, 0.004 * k], mats["black"], bevel_res=1, res=3)
    return set_group(obj, group)


def cigar(J, s, mats, center, group="head"):
    k = s
    a = center + V((-0.022 * k, -0.098 * k, -0.064 * k))
    b = a + V((-0.10, -0.07, -0.05)).normalized() * 0.13 * k
    body = rod("cigar", a, b, 0.0085 * k, mats["tan"], seg=8)
    ash = rod("cigar_ash", b, b + (b - a).normalized() * 0.012 * k, 0.0085 * k, mats["black"], seg=8)
    obj = join([body, ash], "cigar")
    return set_group(obj, group)


def bow_tie(J, s, mats, center, group="chest"):
    k = s
    c = J["neck"] + V((0, -0.100 * k, -0.040 * k))
    parts = [sphere("knot", Matrix.Translation(c) @ Matrix.Diagonal((0.012 * k, 0.010 * k, 0.012 * k, 1)), mats["black"], u=8, v=5)]
    for sx in (1, -1):
        parts.append(sphere("wing", Matrix.Translation(c + V((sx * 0.030 * k, 0.004 * k, 0))) @ Matrix.Rotation(rad(sx * 8), 4, "Y") @
                            Matrix.Diagonal((0.026 * k, 0.010 * k, 0.020 * k, 1)), mats["black"], u=10, v=6))
    obj = join(parts, "bow_tie")
    return set_group(obj, group)


# ---------------------------------------------------------------- the character

def base_bone(name):
    return name[:-2] if name[-2:] in ("_L", "_R") else name


def face_paint(obj, pick):
    """pick(face centre, base name of the face's dominant bone) -> material slot index."""
    dom = dominant_bones(obj)
    for p in obj.data.polygons:
        names = [dom[i] for i in p.vertices]
        bone = max(set(names), key=names.count)
        p.material_index = pick(p.center, base_bone(bone))


def make_character(tag, s=1.0, build=1.0, joints=None, radii=None, head_width=0.09, hat=None, head_props=(), chest_props=(),
                   paint_body=None, garments=(), hand_parents=None, extra_bones=None, hat_group="head"):
    """Body + rig + clothes, named by the model contract: <tag>_root, <tag>_rig, <tag>_body.

    paint_body(centre, bone) -> paint name for each face of the skin body (trousers, shoes, hands, shirt under the jacket).
    garments = [dict(name, sleeve, hem, tail, flare, reach, puff, thickness, widen, paint=(centre) -> paint name), ...]
    """
    mats = character_materials()
    names = list(PAINT)
    slot = {n: i for i, n in enumerate(names)}
    J = body_joints(s, **(joints or {}))
    body = build_body(tag + "_body", J, s, mats["skin"], build, radii)
    body.data.materials.clear()
    for n in names:
        body.data.materials.append(mats[n])
    rig = build_rig(tag + "_rig", J, s, hand_parents, extra_bones(J) if extra_bones else None)
    bind(body, rig)
    if paint_body:
        face_paint(body, lambda c, bone: slot[paint_body(c, bone)])

    parts = []
    arm_line = {sx: (J["shoulder_" + side], J["wrist_" + side]) for side, sx in (("L", 1.0), ("R", -1.0))}

    def along_arm(co):
        a, b = arm_line[1.0 if co.x > 0 else -1.0]
        t = (co - a).dot(b - a) / (b - a).length_squared
        return t, (co - (a + (b - a) * t)).length

    for g in garments:
        dom = dominant_bones(body)
        hem, sleeve = g.get("hem", 0.90) * s, g.get("sleeve")

        def keep(i, co, sleeve=sleeve, hem=hem, dom=dom):
            base = base_bone(dom[i])
            if base in ("upper_arm", "forearm", "hand"):
                return along_arm(co)[0] < (sleeve if sleeve is not None else 0.45) + 0.35
            return base in ("hips", "spine", "chest", "neck", "thigh") and co.z > hem - 0.25 * s

        up = V((0, 0, 1))
        clips = [(V((0, 0, hem)), -up, lambda co, arm: arm < 0.5),
                 (V((0, 0, J["neck"].z - g.get("collar", 0.004) * s)), up, lambda co, arm: abs(co.x) < 0.10 * s and co.z > 1.35 * s)]
        for sx in (1.0, -1.0):
            a, b = arm_line[sx]
            if sleeve is None:
                x = abs(a.x) - 0.012 * s
                clips.append((V((sx * x, 0, 0)), V((sx, 0, 0)), lambda co, arm, sx=sx: sx * co.x > 0.08 * s and co.z > 1.0 * s))
            else:
                clips.append((a + (b - a) * sleeve, (b - a).normalized(), lambda co, arm, sx=sx: sx * co.x > 0 and arm >= 0.5))
        gobj = garment(tag + "_" + g["name"], body, keep, [mats[n] for n in names],
                       puff=g.get("puff", 0.015) * s, thickness=g.get("thickness", 0.006) * s, widen=g.get("widen", 1.0), clips=clips,
                       tail=(hem, g["tail"] * s, g.get("flare", 1.03), g.get("reach", 0.14) * s) if g.get("tail") else None)
        pick = g["paint"]
        for p in gobj.data.polygons:
            p.material_index = slot[pick(p.center)]
        parts.append(gobj)
    head, hc = build_head(J, s, mats["skin"], head_width)
    head.data.materials.clear()
    for n in names:
        head.data.materials.append(mats[n])
    for p in head.data.polygons:
        p.material_index = slot["skin"]
    parts.append(head)
    if hat:
        parts.append(hat(J, s, mats, hc, group=hat_group))
    for prop in head_props:
        parts.append(prop(J, s, mats, hc))
    for prop in chest_props:
        parts.append(prop(J, s, mats, hc))
    body = join([body] + parts, tag + "_body")

    root = link(bpy.data.objects.new(tag + "_root", None))
    rig.arm.parent = root
    return dict(tag=tag, s=s, J=J, mats=mats, rig=rig, body=body, root=root, head_center=hc,
                mouth=hc + V((0, -0.100 * s, -0.052 * s)), along_arm=along_arm)


# ---------------------------------------------------------------- toon finish

def finalize_toon(objs):
    """Keep each face's true colour as a corner colour attribute (glTF COLOR_0, for colorReveal) and swap the materials for the
    three tiers. Corner colours keep the edges between colours sharp."""
    tiers = {t: material("toon_" + t, tuple(c ** 2.2 for c in col), roughness=0.8) for t, col in TIERS.items()}
    order = ["white", "grey", "black"]
    for obj in objs:
        if obj.type != "MESH":
            continue
        me = obj.data
        mats = list(me.materials)
        attr = me.color_attributes.get("Col") or me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
        idx = []
        for p in me.polygons:
            m = mats[p.material_index] if p.material_index < len(mats) else None
            col = tuple(m["srgb"]) if (m is not None and "srgb" in m) else (0.5, 0.5, 0.5)
            tier = m["tier"] if (m is not None and "tier" in m) else "grey"
            for li in p.loop_indices:
                attr.data[li].color_srgb = (*col, 1.0)
            idx.append(order.index(tier))
        me.color_attributes.active_color = attr
        me.materials.clear()
        for t in order:
            me.materials.append(tiers[t])
        for p, i in zip(me.polygons, idx):
            p.material_index = i
    return tiers


# ---------------------------------------------------------------- actions

def start_action(rig, name):
    """A fresh action on the armature. Every action keys every bone (key_all), so none leaks a pose into the next."""
    arm = rig.arm
    ad = arm.animation_data or arm.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    ad.action = act
    return act


def reset_pose(rig):
    for pb in rig.arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)


def key_all(rig, frame):
    for pb in rig.arm.pose.bones:
        pb.keyframe_insert("location", frame=frame)
        pb.keyframe_insert("rotation_quaternion" if pb.rotation_mode == "QUATERNION" else "rotation_euler", frame=frame)
        pb.keyframe_insert("scale", frame=frame)


def squash(rig, amount):
    """amount > 0 squashes (wider, shorter), < 0 stretches, volume roughly kept. On the root bone, so the figure and its prop follow.
    The root bone points up, so its local Y is the figure's height."""
    h = 1.0 - amount
    w = 1.0 / math.sqrt(max(h, 0.2))
    rig.pb("root").scale = (w, h, w)


def stash_actions(rig, names):
    """Each action into its own muted NLA track, so the exporter writes all of them."""
    ad = rig.arm.animation_data
    for n in names:
        act = bpy.data.actions[n]
        tr = ad.nla_tracks.new()
        tr.name = n
        st = tr.strips.new(n, 0, act)
        st.name = n
        tr.mute = True
    ad.action = None


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def beat(frame):
    return frame / SOLO_FRAMES * SOLO_BEATS


def off(b):
    return 0.5 - 0.5 * math.cos(math.tau * b)


def on(b):
    return 1.0 - off(b)


def lerp(a, b, t):
    return a + (b - a) * t


# ---------------------------------------------------------------- export

def export_glb(path, objects, animated):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.context.scene.frame_set(0)
    want = dict(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
        export_cameras=False, export_lights=False, export_extras=False,
        export_texcoords=True, export_normals=True, export_vertex_color="ACTIVE", export_colors=True, export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=True, export_materials="EXPORT", export_image_format="JPEG", export_jpeg_quality=82,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12,
        export_draco_generic_quantization=12,
        export_animations=animated, export_animation_mode="ACTIONS", export_force_sampling=True, export_frame_range=True,
        export_frame_step=1, export_skins=True, export_def_bones=False, export_all_influences=False,
        export_optimize_animation_size=True, export_anim_slide_to_zero=True, export_nla_strips=True,
        export_morph=False, export_bake_animation=False, export_reset_pose_bones=True, export_current_frame=False, export_rest_position_armature=True,
    )
    known = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    bpy.ops.export_scene.gltf(**{k: v for k, v in want.items() if k in known})
    return os.path.getsize(path)


def read_glb(path):
    with open(path, "rb") as f:
        magic, version, length = struct.unpack("<III", f.read(12))
        clen, ctype = struct.unpack("<II", f.read(8))
        doc = json.loads(f.read(clen).decode("utf-8"))
    return doc


def describe_glb(path):
    doc = read_glb(path)
    acc = doc.get("accessors", [])
    anims = []
    for a in doc.get("animations", []):
        tmax = max((acc[s["input"]].get("max", [0])[0] for s in a["samplers"]), default=0)
        anims.append("%s %.3fs" % (a.get("name"), tmax))
    return {
        "bytes": os.path.getsize(path),
        "nodes": [n.get("name") for n in doc.get("nodes", [])],
        "materials": [m.get("name") for m in doc.get("materials", [])],
        "animations": anims,
        "extensions": doc.get("extensionsUsed", []),
    }


# ---------------------------------------------------------------- preview renders

def _world(color):
    w = bpy.data.worlds.new("preview_world")
    try:
        w.use_nodes = True
    except Exception:
        pass
    nt = w.node_tree
    bg = next((n for n in nt.nodes if n.type == "BACKGROUND"), None) if nt else None
    if bg is None and nt:
        out = next((n for n in nt.nodes if n.type == "OUTPUT_WORLD"), None) or nt.nodes.new("ShaderNodeOutputWorld")
        bg = nt.nodes.new("ShaderNodeBackground")
        nt.links.new(bg.outputs[0], out.inputs[0])
    if bg:
        bg.inputs[0].default_value = (*color, 1)
        bg.inputs[1].default_value = 1.0
    bpy.context.scene.world = w
    return w


def render_previews(tag, center, radius, views, size=512, frame=0, world=(0.05, 0.055, 0.075)):
    """EEVEE stills for checking the model by eye. views = {suffix: direction from the centre to the camera}."""
    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    try:
        scene.view_settings.view_transform = "Standard"
    except Exception:
        pass
    _world(world)
    made = []
    for lname, kind, loc, energy, scale in (("key", "SUN", (-2.0, -3.0, 4.0), 3.2, 1), ("fill", "SUN", (3.0, -1.5, 1.5), 1.1, 1), ("rim", "SUN", (0.5, 3.0, 2.5), 1.6, 1)):
        ld = bpy.data.lights.new("preview_" + lname, kind)
        ld.energy = energy
        lo = link(bpy.data.objects.new("preview_" + lname, ld))
        lo.rotation_euler = (-V(loc)).to_track_quat("-Z", "Y").to_euler()
        made.append(lo)
    cd = bpy.data.cameras.new("preview_cam")
    cd.lens = 60
    cam = link(bpy.data.objects.new("preview_cam", cd))
    made.append(cam)
    scene.camera = cam
    dist = radius / math.tan(cd.angle / 2) * 1.12
    os.makedirs(PREVIEWS, exist_ok=True)
    scene.frame_set(frame)
    out = []
    for suffix, direction in views.items():
        d = V(direction).normalized()
        cam.location = V(center) + d * dist
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(PREVIEWS, "%s_%s.png" % (tag, suffix))
        bpy.ops.render.render(write_still=True)
        out.append(scene.render.filepath)
    for o in made:
        data = o.data
        bpy.data.objects.remove(o)
    return out
