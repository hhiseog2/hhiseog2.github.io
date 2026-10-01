"""Frontman, second version (screening-v2-prompt.md step 7; reference frames: reference/frontman/*.png from the owner's film).

White captain's cap with a dark band and visor, round dark sunglasses, moustache, a cigar, black bow tie, white shirt, a light
three-piece suit (jacket with a pocket square, darker waistcoat), the same trousers turned up at the hem, dark two-tone shoes,
a 1950s chrome capsule microphone in the right hand. Slim illustration proportions; hands with the thumb and the index finger apart.

Materials are named toon_* (the site sets their greys from SCREENING.popout.greys): toon_cap 0.9, toon_shirt 0.9, toon_suit 0.72,
toon_vest 0.6, toon_ink 0.08 (bow tie, glasses, shoes, cap band), toon_skin 0.78, toon_shoe 0.3, toon_mic 0.82.

Actions (30 fps):
  exit_leap    0.6 s  stretches up out of a short dip and turns half a somersault backward
  solo         3.0 s  loop, 8 beats at 160 BPM: sings into the mic, sweeps the free arm, lifts the cap to the audience, kicks
  return_dive  1.1 s  crouch 0.2 s, spring up, then straight and feet first downward
The cap, the bow tie and the coat tails have their own bones and follow the body a little late.
"""
import math

from mathutils import Matrix, Vector as V

import common as C
import motion as M

TAG = "frontman"
S = 0.98
FPS = C.FPS
ACTIONS = {"exit_leap": 18, "solo": 90, "return_dive": 33}
RENAME = {"paint_capwhite": "toon_cap", "paint_shirtwhite": "toon_shirt", "paint_suitgrey": "toon_suit", "paint_vestgrey": "toon_vest",
          "paint_inkgrey": "toon_ink", "paint_skingrey": "toon_skin", "paint_shoegrey": "toon_shoe", "paint_chrome": "toon_mic",
          "paint_skin": "toon_skin", "paint_black": "toon_ink", "paint_white": "toon_shirt", "paint_tan": "toon_suit", "paint_beige": "toon_cap"}


def cap(J, s, mats, center, group="cap"):
    """White captain's cap: a crown wider than the band, dark band and visor."""
    k = s
    profile = [(0.100, 0.000), (0.102, 0.040), (0.114, 0.058), (0.146, 0.084), (0.152, 0.098), (0.140, 0.110), (0.080, 0.117), (0.0, 0.118)]
    crown = C._crown("captain", profile, k, [mats["capwhite"], mats["inkgrey"]], lambda c: 1 if c.z < 0.042 * k else 0, steps=32)
    for v in crown.data.vertices:
        v.co.y *= 1.08
    visor = C._visor(k, 0.100 * k, 0.178 * k, 0.004, -0.028, mats["inkgrey"], spread=0.80)
    obj = C.join([crown, visor], "captain_cap")
    obj.data.transform(Matrix.Translation(center + V((0, 0.0, 0.050 * k))) @ Matrix.Rotation(C.rad(-4), 4, "X"))
    C.shade(obj, None)
    return C.set_group(obj, group)


def glasses(J, s, mats, center):
    o = C.sunglasses(J, s, mats, center)
    o.data.materials.clear(); o.data.materials.append(mats["inkgrey"])
    return o


def moustache(J, s, mats, center):
    o = C.mustache(J, s, mats, center)
    o.data.materials.clear(); o.data.materials.append(mats["inkgrey"])
    return o


def cigar(J, s, mats, center):
    o = C.cigar(J, s, mats, center)
    o.data.materials.clear(); o.data.materials.append(mats["shirtwhite"]); o.data.materials.append(mats["inkgrey"])
    return o


def bow(J, s, mats, center):
    o = C.bow_tie(J, s, mats, center, group="tie")
    o.data.materials.clear(); o.data.materials.append(mats["inkgrey"])
    return o


def turn_ups(J, s, mats, hc):
    rings = []
    for side in ("L", "R"):
        ring = C.cyl("cuff", 0.072 * s, 0.070 * s, 0.045 * s, Matrix.Translation(J["ankle_" + side] + V((0, 0, 0.05 * s))), mats["suitgrey"], seg=16)
        rings.append(C.set_group(ring, "shin_" + side))
    return C.join(rings, "turn_ups")


def build_mic(c):
    """A 1950s capsule microphone: a chrome capsule with dark grille bands, a short tapered handle."""
    mats, m, s = c["mats"], c["mouth"], c["s"]
    grill = m + V((-0.022, -0.080, -0.035)) * s
    h = V((-0.22, -0.18, -0.96)).normalized()
    head = C.sphere("mic_grill", Matrix.Translation(grill) @ C.z_to(h) @ Matrix.Diagonal((0.028, 0.028, 0.050, 1)), None, u=16, v=14)
    head.data.materials.append(mats["chrome"]); head.data.materials.append(mats["inkgrey"])
    for p in head.data.polygons:
        along = (p.center - grill).dot(h)
        p.material_index = 1 if int((along + 0.05) / 0.011) % 2 == 0 and abs(along) < 0.038 else 0
    parts = [head,
             C.rod("mic_collar", grill + h * 0.046, grill + h * 0.060, 0.019, mats["chrome"], seg=12),
             C.rod("mic_handle", grill + h * 0.056, grill + h * 0.205, 0.0160, mats["chrome"], seg=12, r2=0.0115),
             C.rod("mic_band", grill + h * 0.120, grill + h * 0.135, 0.0158, mats["inkgrey"], seg=12)]
    return C.join(parts, TAG + "_mic"), grill, h


def spin_about(rig, pivot, angle_deg, axis="X"):
    """Turn the whole figure (the root bone) about a world point, e.g. the hips for a somersault."""
    rest = rig.rest["root"]
    m = Matrix.Translation(pivot) @ Matrix.Rotation(C.rad(angle_deg), 4, axis) @ Matrix.Translation(-pivot) @ rest
    b = rest.inverted() @ m
    pb = rig.pb("root")
    pb.location = b.to_translation()
    pb.rotation_euler = b.to_euler("XYZ")


def build():
    s = S
    joints = dict(shoulder=0.195, stance=0.12, hip=0.10)
    J0 = C.body_joints(s, **joints)

    def paint_body(c, bone):
        if bone == "foot":
            return "inkgrey" if c.z > 0.03 * s and c.y < J0["ball_L"].y + 0.02 else "shoegrey"      # dark uppers, a lighter sole and heel
        if bone in ("thigh", "shin", "upper_arm", "forearm"):
            return "suitgrey"
        if bone in ("hand", "fingers"):
            return "skingrey"
        return "shirtwhite"

    def jacket(c):
        top, bottom = 1.50 * s, 1.08 * s
        if c.y < 0 and bottom < c.z < top:
            w = 0.11 * s * ((c.z - bottom) / (top - bottom)) ** 0.8
            if abs(c.x) < w:
                return "shirtwhite" if c.z > 1.36 * s else "vestgrey"       # shirt front above, waistcoat below
        if c.y < 0 and 0.07 * s < c.x < 0.13 * s and 1.27 * s < c.z < 1.31 * s:
            return "shirtwhite"                                               # pocket square
        return "suitgrey"

    def tails(gobj):
        """The jacket below the waist also follows the coat_tail bone, so the tails swing after the body."""
        vg = gobj.vertex_groups.get("coat_tail") or gobj.vertex_groups.new(name="coat_tail")
        names = [g.name for g in gobj.vertex_groups]
        for v in gobj.data.vertices:
            w = C.smooth((1.02 * s - v.co.z) / (0.22 * s))
            if w <= 0:
                continue
            for g in v.groups:
                if names[g.group] != "coat_tail":
                    g.weight *= (1 - w)
            vg.add([v.index], w, "REPLACE")

    c = C.make_character(
        TAG, s=s, build=1.06, joints=joints,
        radii={"chest": 0.166, "hips": 0.152, "spine": 0.150, "knee": 0.076}, head_width=0.088,
        hat=cap, hat_group="cap", head_props=(glasses, moustache, cigar), chest_props=(bow, turn_ups),
        paint_body=paint_body,
        garments=[dict(name="jacket", sleeve=0.93, hem=0.98, tail=0.22, flare=1.05, reach=0.16, puff=0.030, thickness=0.007, widen=1.04,
                       collar=0.030, paint=jacket, post=tails)],
        extra_bones=lambda J: [("cap", J["head_top"] - V((0, 0, 0.09 * s)), J["head_top"] + V((0, 0, 0.04 * s)), "head", True),
                               ("tie", J["neck"] + V((0, -0.08 * s, -0.05 * s)), J["neck"] + V((0, -0.08 * s, -0.12 * s)), "chest", False),
                               ("coat_tail", V((0, 0.02, 1.0 * s)), V((0, 0.02, 0.7 * s)), "hips", False)])
    rig, J, body = c["rig"], c["J"], c["body"]
    # the tie and coat-tail bones stay out of the automatic weights (they would take the hips' skin), then deform what was given them
    for b in ("tie", "coat_tail"):
        rig.arm.data.bones[b].use_deform = True
    mic, grill, h = build_mic(c)
    palm = 0.075 * s
    grip = grill + h * 0.130
    mic_hand = rig.basis("ik_hand_R", rig.grip_matrix("R", grip + V((-0.032, 0.020, 0.0)), (0.40, -0.90, 0.16), (0.9, 0.4, 0), palm))
    rig.set_target("ik_hand_R", *mic_hand)
    rig.set_target("ik_hand_L", *rig.basis("ik_hand_L", rig.rest["ik_hand_L"]))
    C.parent_to_bone(mic, rig, "hand_R", rig.posed("hand_R"))

    def reach(side, offset, fingers, palm_dir):
        return rig.basis("ik_hand_" + side, rig.hand_matrix(side, J["shoulder_" + side] + V(offset) * s, fingers, palm_dir))
    low = reach("L", (0.17, -0.17, -0.12), (0.25, -0.35, -1), (0, -1, 0.1))
    wide_l = reach("L", (0.44, -0.12, 0.16), (1, -0.3, 0.45), (0, -1, 0.2))
    up_l = reach("L", (0.06, -0.06, 0.58), (0.05, -0.1, 1), (-1, 0, 0))
    up_r = reach("R", (-0.06, -0.06, 0.58), (-0.05, -0.1, 1), (1, 0, 0))
    hips = J["hips"].copy()

    def blend(a, b, t):
        return a[0].lerp(b[0], t), a[1].slerp(b[1], t)

    def follow(bone, lag_value):
        """cap / tie / coat tail: a small rotation that trails the body's movement"""
        M.rot(rig, bone, x=lag_value)

    def pose(name, f):
        T = f / FPS
        if name == "exit_leap":
            u = f / ACTIONS[name]
            dip = math.sin(math.pi * min(1, u / 0.25)) if u < 0.25 else 0
            stretch = C.smooth((u - 0.15) / 0.35) * (1 - 0.4 * C.smooth((u - 0.7) / 0.3))
            C.squash(rig, 0.12 * dip - 0.28 * stretch)
            for side, sx in (("L", 1), ("R", -1)):
                rig.offset("ik_foot_" + side, V((-sx * 0.03 * stretch, 0.04 * stretch, -0.05 * stretch + 0.12 * dip)) * s, 35 * stretch)
            rig.offset("hips", V((0, 0.02 * dip, -0.10 * dip)) * s)
            M.rot(rig, "spine", x=10 * dip - 12 * stretch)
            M.rot(rig, "head", x=-14 * stretch)
            rig.set_target("ik_hand_R", *blend(mic_hand, up_r, 0.6 * stretch))
            rig.set_target("ik_hand_L", *blend(low, up_l, stretch))
            spin_about(rig, hips, -180 * C.smooth((u - 0.3) / 0.7))           # half a somersault, backward
            follow("cap", 25 * stretch); follow("tie", -30 * stretch); follow("coat_tail", 35 * stretch)
        elif name == "solo":
            b = f / ACTIONS[name] * 8
            M.solo(rig, s, b)
            spread = C.smooth((b - 0.2) / 0.8) * (1 - C.smooth((b - 2.0) / 0.6))
            take = C.smooth((b - 2.2) / 0.6) * (1 - C.smooth((b - 6.0) / 0.6))
            lift = C.smooth((b - 3.0) / 0.8) * (1 - C.smooth((b - 5.2) / 0.8))
            sweep = math.sin(math.pi * b / 2)
            M.rot(rig, "spine", x=6 + 14 * lift, z=3 * sweep * (1 - lift))
            M.rot(rig, "chest", x=4 + 6 * lift - 6 * spread)
            M.rot(rig, "head", x=8 * lift - 8 * spread + 4 * math.sin(math.pi * b), z=6 * sweep)
            rig.offset("cap", V((0, 0, 0.15 * lift)) * s)
            M.rot(rig, "cap", x=-30 * lift + 4 * math.sin(math.pi * b))
            rig.set_target("ik_hand_R", *mic_hand)                            # sings into the mic the whole time
            left = blend(low, wide_l, max(spread, 0.6 * (0.5 + 0.5 * sweep) * (1 - take)))
            if take > 0.001:
                capm = rig.posed("cap")
                hold = capm @ V((0.115 * s, 0.03 * s, 0.02 * s))
                held = rig.basis_in("ik_hand_L", rig.grip_matrix("L", hold, (-0.35, -0.15, 0.9), (-1, 0, 0.15), palm), "chest")
                left = blend(left, held, take)
            rig.set_target("ik_hand_L", *left)
            M.rot(rig, "fingers_R", z=52)
            M.rot(rig, "fingers_L", z=-(40 * take + 8 * (1 - take)))
            follow("tie", 10 * math.sin(math.pi * b - 0.6)); follow("coat_tail", 12 * math.sin(math.pi * b - 0.9))
        else:  # return_dive
            u = f / ACTIONS[name]
            crouch = math.sin(math.pi * min(1, u / 0.36)) if u < 0.36 else 0
            spring = C.smooth((u - 0.18) / 0.25) * (1 - C.smooth((u - 0.55) / 0.2))
            pencil = C.smooth((u - 0.5) / 0.3)
            C.squash(rig, 0.16 * crouch - 0.22 * spring - 0.26 * pencil)
            for side, sx in (("L", 1), ("R", -1)):
                d = M.AIR * (1 - pencil) + V((0, 0, 0.14 * crouch)) + V((-sx * 0.035, 0.03, -0.12)) * pencil
                rig.offset("ik_foot_" + side, d * s, 30 + 40 * pencil)
            M.rot(rig, "spine", x=6 + 18 * crouch - 8 * pencil)
            M.rot(rig, "head", x=-6 * pencil)
            rig.set_target("ik_hand_R", *blend(mic_hand, up_r, pencil))
            rig.set_target("ik_hand_L", *blend(low, up_l, max(spring, pencil)))
            follow("cap", -20 * spring + 30 * pencil); follow("tie", 25 * pencil); follow("coat_tail", -30 * crouch + 40 * pencil)

    names = []
    for name, frames in ACTIONS.items():
        act = C.start_action(rig, name)
        ad = rig.arm.animation_data
        for f in range(frames + 1):
            ad.action = None
            C.reset_pose(rig)
            pose(name, f)
            ad.action = act
            C.key_all(rig, f)
        names.append(name)
    return dict(c, objects=[c["root"], rig.arm, body, mic], instrument=mic, actions=names, keep_materials=RENAME,
                preview_action=("solo", 0))
