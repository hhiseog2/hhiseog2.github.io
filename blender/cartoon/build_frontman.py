"""Frontman (reference/frontman.png): medium height, solid chest, white captain's cap with a black band and visor, dark sunglasses,
black moustache and a cigar, white shirt, black bow tie and waistcoat under a tan jacket with a white pocket square, tan trousers,
black shoes, a vintage microphone in his right hand.
Solo: arms flung wide, then the free hand lifts the cap off and he bows (the cap has its own bone), and puts it back."""
import math

from mathutils import Matrix, Vector as V

import common as C
import motion as M

TAG = "frontman"
S = 0.98


def build_mic(c):
    mats, m = c["mats"], c["mouth"]
    s = c["s"]
    grill = m + V((-0.020, -0.075, -0.030)) * s
    h = V((-0.25, -0.20, -0.95)).normalized()         # the handle runs down toward the right hand
    head = C.sphere("mic_grill", Matrix.Translation(grill) @ C.z_to(h) @ Matrix.Diagonal((0.030, 0.030, 0.046, 1)), None, u=16, v=12)
    head.data.materials.append(mats["silver"])
    head.data.materials.append(mats["black"])
    # ribs: alternate faces along the capsule are black, the grille lines of an old ribbon mic
    for p in head.data.polygons:
        along = (p.center - grill).dot(h)
        p.material_index = 1 if int((along + 0.05) / 0.0115) % 2 == 0 and abs(along) < 0.040 else 0
    parts = [
        head,
        C.rod("mic_collar", grill + h * 0.040, grill + h * 0.056, 0.020, mats["silver"], seg=12),
        C.rod("mic_handle", grill + h * 0.052, grill + h * 0.220, 0.0165, mats["black"], seg=12, r2=0.0125),
    ]
    return C.join(parts, TAG + "_mic"), grill, h


def build():
    s = S

    def paint_body(c, bone):
        if bone == "foot":
            return "black"
        if bone in ("thigh", "shin", "upper_arm", "forearm"):
            return "tan"
        if bone in ("hand", "fingers"):
            return "skin"
        if bone == "neck":
            return "white"
        return "white"

    def jacket(c):
        top, bottom = 1.50 * s, 1.10 * s
        if c.y < 0 and bottom < c.z < top:
            w = 0.11 * s * ((c.z - bottom) / (top - bottom)) ** 0.8
            if abs(c.x) < w:
                return "white" if c.z > 1.38 * s else "black"          # shirt front above, waistcoat below
        if c.y < 0 and 0.07 * s < c.x < 0.13 * s and 1.26 * s < c.z < 1.31 * s:
            return "white"                                                # pocket square
        return "tan"

    c = C.make_character(
        TAG, s=s, build=1.06, joints=dict(shoulder=0.195, stance=0.12, hip=0.10),
        radii={"chest": 0.166, "hips": 0.152, "spine": 0.150, "knee": 0.076}, head_width=0.092,
        hat=C.hat_captain, hat_group="cap", head_props=(C.sunglasses, C.mustache, C.cigar), chest_props=(C.bow_tie,),
        paint_body=paint_body,
        garments=[dict(name="jacket", sleeve=0.93, hem=0.98, tail=0.20, flare=1.05, reach=0.16, puff=0.032, thickness=0.007, widen=1.05,
                       collar=0.030, paint=jacket)],
        extra_bones=lambda J: [("cap", J["head_top"] - V((0, 0, 0.09 * s)), J["head_top"] + V((0, 0, 0.04 * s)), "head", True)])
    rig, J, body = c["rig"], c["J"], c["body"]
    mic, grill, h = build_mic(c)
    palm = 0.075 * s

    grip = grill + h * 0.140
    mic_hand = rig.basis("ik_hand_R", rig.grip_matrix("R", grip + V((-0.034, 0.020, 0.0)), (0.40, -0.90, 0.16), (0.9, 0.4, 0), palm))
    rig.set_target("ik_hand_R", *mic_hand)
    rig.set_target("ik_hand_L", *rig.basis("ik_hand_L", rig.rest["ik_hand_L"]))
    C.parent_to_bone(mic, rig, "hand_R", rig.posed("hand_R"))

    def reach(side, offset, fingers, palm_dir):
        sh = J["shoulder_" + side]
        return rig.basis("ik_hand_" + side, rig.hand_matrix(side, sh + V(offset) * s, fingers, palm_dir))
    low = reach("L", (0.17, -0.17, -0.10), (0.25, -0.35, -1), (0, -1, 0.1))
    wide_l = reach("L", (0.42, -0.14, 0.18), (1, -0.3, 0.45), (0, -1, 0.2))
    wide_r = reach("R", (-0.42, -0.14, 0.18), (-1, -0.3, 0.45), (0, -1, 0.2))
    over_l = reach("L", (0.04, -0.06, 0.58), (0.05, -0.1, 1), (-1, 0, 0))
    over_r = reach("R", (-0.04, -0.06, 0.58), (-0.05, -0.1, 1), (1, 0, 0))

    def blend(a, b, t):
        return a[0].lerp(b[0], t), a[1].slerp(b[1], t)

    def hook(rig, phase, f, t):
        if phase == "solo":
            b = t
            spread = C.smooth((b - 0.2) / 0.8) * (1 - C.smooth((b - 2.0) / 0.6))
            take = C.smooth((b - 2.2) / 0.6) * (1 - C.smooth((b - 6.0) / 0.6))
            lift = C.smooth((b - 3.0) / 0.8) * (1 - C.smooth((b - 5.2) / 0.8))
            M.rot(rig, "spine", x=6 + 14 * lift, z=3 * math.sin(math.tau * b / 2) * (1 - lift))
            M.rot(rig, "chest", x=4 + 6 * lift - 6 * spread)
            M.rot(rig, "head", x=8 * lift - 8 * spread, z=6 * math.sin(math.tau * b / 2))
            rig.offset("cap", V((0, 0, 0.15 * lift)) * s)
            M.rot(rig, "cap", x=-30 * lift)
            rig.set_target("ik_hand_R", *blend(mic_hand, wide_r, spread))
            left = blend(low, wide_l, spread)
            if take > 0.001:
                cap = rig.posed("cap")
                hold = cap @ V((0.115 * s, 0.03 * s, 0.02 * s))
                held = rig.basis_in("ik_hand_L", rig.grip_matrix("L", hold, (-0.35, -0.15, 0.9), (-1, 0, 0.15), palm), "chest")
                left = blend(left, held, take)
            rig.set_target("ik_hand_L", *left)
            M.rot(rig, "fingers_R", z=52 * (1 - spread) + 8 * spread)
            M.rot(rig, "fingers_L", z=-(40 * take + 8 * (1 - take)))
        elif phase == "emerge":
            up = C.smooth((f - 8) / 6)
            rig.set_target("ik_hand_R", *mic_hand)
            rig.set_target("ik_hand_L", *blend(low, wide_l, up))
            M.rot(rig, "fingers_R", z=52)
            M.rot(rig, "fingers_L", z=-8)
        else:
            stretch = C.smooth((f - 6) / 10)
            rig.set_target("ik_hand_R", *blend(mic_hand, over_r, stretch))
            rig.set_target("ik_hand_L", *blend(low, over_l, stretch))
            M.rot(rig, "fingers_R", z=52)
            M.rot(rig, "fingers_L", z=-8)

    names = M.animate(c, hook)
    return dict(c, objects=[c["root"], rig.arm, body, mic], instrument=mic, actions=names)
