"""Bassist (reference/bass.png): medium build, cream porkpie hat with a black band, dark sunglasses, black moustache, beige shirt with
the sleeves rolled up, green waistcoat, dark green trousers, dark shoes, an upright bass in honey wood.
Solo: lets go of the bass and spins it like a top (bass_spin turns about the bass's own long axis, two turns in eight beats),
arms flung wide, catching it again on the last beat."""
import math

import bmesh
from mathutils import Matrix, Vector as V

import common as C
import motion as M

TAG = "bass"
S = 1.0
SCALE = 0.92            # 3/4 size bass
PIN = 0.18              # end pin length (before scale)
FLOOR_POINT = V((0.25, -0.29, 0.0))
YAW, TILT = -40.0, -7.0  # turned toward the player's right hand, neck leaning back to the left shoulder


def bass_matrix():
    rs = Matrix.Rotation(C.rad(YAW), 4, "Z") @ Matrix.Rotation(C.rad(TILT), 4, "X") @ Matrix.Scale(SCALE, 4)
    return Matrix.Translation(FLOOR_POINT - rs @ V((0, 0, -PIN))) @ rs


def build_upright_bass(mats):
    """Modelled upright at the origin (front = -Y, body bottom at z = 0), then set on the floor beside the player."""
    parts = []
    half = [(0.0, 0.0), (0.12, 0.004), (0.22, 0.03), (0.295, 0.10), (0.33, 0.20), (0.325, 0.30), (0.285, 0.40), (0.225, 0.48),
            (0.195, 0.55), (0.185, 0.62), (0.20, 0.69), (0.245, 0.76), (0.262, 0.84), (0.25, 0.92), (0.205, 1.0), (0.13, 1.06), (0.05, 1.095), (0.0, 1.10)]
    outline = half + [(-x, z) for x, z in reversed(half[1:-1])]
    bm = bmesh.new()
    bm.faces.new([bm.verts.new((x, 0.0, z)) for x, z in outline])
    body = C.mesh_obj("bass_shell", bm, mats["wood"], False, normals=False)
    sol = body.modifiers.new("Solidify", "SOLIDIFY")
    sol.thickness = 0.20
    sol.offset = 0.0
    C.apply_modifiers(body)
    C.fix_normals(body)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    rim = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle() > C.rad(60)]
    bmesh.ops.bevel(bm, geom=rim, offset=0.022, segments=2, profile=0.5, affect="EDGES")
    bm.to_mesh(body.data)
    bm.free()
    C.shade(body, 35.0)
    parts.append(body)

    parts.append(C.box("bass_neck", (0, -0.078, 1.32), (0.048, 0.05, 0.50), mats["wood"], bevel=0.012))
    fb0, fb1 = V((0, -0.152, 0.80)), V((0, -0.110, 1.57))
    parts.append(C.box("bass_fingerboard", (fb0 + fb1) / 2, (0.064, 0.014, (fb1 - fb0).length), mats["black"],
                       rot=Matrix.Rotation(-math.atan2(fb1.y - fb0.y, fb1.z - fb0.z), 4, "X"), bevel=0.003, segments=1))
    parts.append(C.box("bass_pegbox", (0, -0.060, 1.635), (0.056, 0.062, 0.15), mats["wood"], bevel=0.010))
    centre, pts, rr = V((0, -0.040, 1.745)), [], []
    for i in range(13):
        t = i / 12
        ang = -math.pi / 2 + t * math.tau * 1.4
        r = 0.052 * (1 - t) + 0.010 * t
        pts.append(centre + V((0, math.cos(ang) * r, math.sin(ang) * r)))
        rr.append(0.024 * (1 - t) + 0.012 * t)
    parts.append(C.tube("bass_scroll", pts, rr, mats["wood"], bevel_res=2, res=4))
    for i, z in enumerate((1.585, 1.615, 1.645, 1.675)):
        sx = 1 if i % 2 == 0 else -1
        parts.append(C.rod("bass_peg", (0, -0.06, z), (sx * 0.075, -0.06, z), 0.006, mats["black"], seg=6))
        parts.append(C.sphere("bass_peg_key", Matrix.Translation((sx * 0.086, -0.06, z)) @ Matrix.Diagonal((0.008, 0.018, 0.014, 1)), mats["black"], u=8, v=5))
    parts.append(C.box("bass_bridge", (0, -0.152, 0.42), (0.13, 0.105, 0.012), mats["cream"], bevel=0.003, segments=1))
    parts.append(C.box("bass_tailpiece", (0, -0.128, 0.21), (0.07, 0.016, 0.26), mats["black"], bevel=0.006, segments=1))
    for x in (-0.036, -0.012, 0.012, 0.036):
        nut, top, tail = V((x * 0.45, -0.120, 1.57)), V((x, -0.207, 0.42)), V((x * 0.6, -0.140, 0.33))
        parts.append(C.rod("bass_string", nut, top, 0.0024, mats["cream"], seg=5))
        parts.append(C.rod("bass_string_tail", top, tail, 0.0024, mats["cream"], seg=5))
    for sx in (1, -1):
        f = [(sx * (0.125 + dx), -0.104, z) for dx, z in ((0.030, 0.30), (0.012, 0.325), (0.002, 0.37), (0.0, 0.43), (-0.002, 0.49), (-0.012, 0.535), (-0.030, 0.56))]
        parts.append(C.tube("bass_f_hole", f, [0.010, 0.006, 0.005, 0.005, 0.005, 0.006, 0.010], mats["black"], bevel_res=1, res=4))
    parts.append(C.rod("bass_end_pin", (0, 0, 0.02), (0, 0, -PIN), 0.008, mats["black"], seg=8))
    bass = C.join(parts, TAG + "_instrument")
    bass.data.transform(bass_matrix())
    return bass


def rolled_sleeves(J, s, mats, hc):
    """The shirt sleeves rolled up to just below the elbow: a beige ring on each forearm."""
    rings = []
    for side in ("L", "R"):
        a, b = J["shoulder_" + side], J["wrist_" + side]
        p = a + (b - a) * 0.70
        ring = C.cyl("roll", 0.050 * s, 0.047 * s, 0.045 * s, Matrix.Translation(p) @ C.z_to(b - a), mats["beige"], seg=14)
        rings.append(C.set_group(ring, "forearm_" + side))
    return C.join(rings, "rolled_sleeves")


def build():
    B = bass_matrix()
    rot = B.to_3x3().normalized()
    P = lambda p: B @ V(p)
    D = lambda d: (rot @ V(d)).normalized()
    s = S
    joints = dict(shoulder=0.185, stance=0.10, upper=0.30, fore=0.275, arm_angle=34.0)
    J0 = C.body_joints(s, **joints)

    def along_arm(co):
        side = "L" if co.x > 0 else "R"
        a, b = J0["shoulder_" + side], J0["wrist_" + side]
        return (co - a).dot(b - a) / (b - a).length_squared

    def paint_body(c, bone):
        if bone == "foot":
            return "black"
        if bone in ("thigh", "shin"):
            return "darkgreen"
        if bone in ("hand", "fingers"):
            return "skin"
        if bone == "forearm":
            return "skin" if along_arm(c) > 0.70 else "beige"
        if bone == "neck":
            return "skin" if c.z > 1.50 * s else "beige"
        return "beige"

    c = C.make_character(
        TAG, s=s, build=0.96, joints=joints,
        radii={"chest": 0.158, "hips": 0.150, "spine": 0.146}, head_width=0.090,
        hat=C.hat_porkpie, head_props=(C.sunglasses, C.mustache), chest_props=(rolled_sleeves,), paint_body=paint_body,
        garments=[dict(name="waistcoat", sleeve=None, hem=0.93, puff=0.022, thickness=0.006, collar=0.05, paint=lambda co: "green")],
        hand_parents={"L": "bass_hold", "R": "bass_hold"},
        extra_bones=lambda J: [("bass_hold", P((0, 0, -PIN)), P((0, 0, 0.45)), "root"),
                               ("bass_spin", P((0, 0, -PIN)), P((0, 0, 1.10)), "bass_hold")])
    rig, J, body = c["rig"], c["J"], c["body"]
    bass = build_upright_bass(c["mats"])
    C.parent_to_bone(bass, rig, "bass_spin", rig.rest["bass_spin"])
    palm = 0.075 * s

    LEFT = dict(x=-0.077, y=-0.157, curl=-78)

    def left(z):
        return rig.basis("ik_hand_L", rig.grip_matrix("L", P((LEFT["x"], LEFT["y"] - (1.47 - z) * 0.055, z)), D((0.22, -1, 0.05)), D((1, 0.2, 0)), palm))

    def right(pull):
        return rig.basis("ik_hand_R", rig.grip_matrix("R", P((-0.040 - 0.030 * pull, -0.215 - 0.020 * pull, 0.930 + 0.018 * pull)),
                                                      D((0.8, -0.10, -0.55)), D((0.1, 1, 0.05)), palm))
    l_hi, r_rest = left(1.40), right(0.0)
    # arms flung wide for the spin, palms to the audience
    wide = {side: rig.basis("ik_hand_" + side, rig.hand_matrix(side, J["shoulder_" + side] + V((sx * 0.40, -0.16, 0.16)) * s,
                                                                (sx * 1.0, -0.3, 0.45), (0, -1, 0.2)))
            for side, sx in (("L", 1.0), ("R", -1.0))}
    grip = {"L": l_hi, "R": r_rest}

    def hook(rig, phase, f, t):
        if phase == "solo":
            b = t
            release = C.smooth((b - 0.2) / 0.8) * (1 - C.smooth((b - 6.9) / 1.0))
            for side in ("L", "R"):
                g, w = grip[side], wide[side]
                rig.set_target("ik_hand_" + side, g[0].lerp(w[0], release), g[1].slerp(w[1], release))
            M.rot(rig, "bass_spin", y=-720.0 * b / C.SOLO_BEATS)
            M.rot(rig, "head", x=-6 * release, y=10 * math.sin(math.tau * b / 4))
            M.rot(rig, "spine", x=6 - 8 * release)
            M.rot(rig, "fingers_L", z=-10 if release > 0.5 else LEFT["curl"])
            M.rot(rig, "fingers_R", z=10 if release > 0.5 else 30)
        else:
            rig.set_target("ik_hand_L", *l_hi)
            rig.set_target("ik_hand_R", *r_rest)
            M.rot(rig, "fingers_L", z=LEFT["curl"])
            M.rot(rig, "fingers_R", z=30)
            M.rot(rig, "head", y=8.0)

    names = M.animate(c, hook)
    return dict(c, objects=[c["root"], rig.arm, body, bass], instrument=bass, actions=names)
