"""Saxophonist (reference/sax.png): tall and slim, cream newsboy cap with black dots, dark round sunglasses, black-and-cream striped
turtleneck under a long cream coat, cream trousers with turn-ups, black shoes. The saxophone hangs across to his left.
Solo: leans far back and the horn bends like rubber (two bones in the horn: sax_lo for the body tube, sax_hi for the bow and bell)."""
import math

from mathutils import Matrix, Vector as V

import common as C
import motion as M

TAG = "sax"
S = 1.03


def stripes(z, s):
    return "black" if int(z / (0.034 * s)) % 2 == 0 else "cream"


def sax_path(J, s):
    """Mouthpiece at the mouth, body hanging across to the player's left (+X)."""
    hc = J["head_top"] - V((0, 0, 0.135 * s))
    m = hc + V((0, -0.100 * s, -0.052 * s))
    pts = [m + V(p) for p in (
        (0.000, 0.000, 0.000), (0.000, -0.070, -0.004), (0.010, -0.135, -0.030), (0.030, -0.150, -0.110),
        (0.100, -0.160, -0.410), (0.160, -0.170, -0.690), (0.180, -0.220, -0.780), (0.190, -0.285, -0.710), (0.195, -0.300, -0.580))]
    return pts


def build_saxophone(c, path):
    mats = c["mats"]
    radii = [0.009, 0.011, 0.012, 0.018, 0.028, 0.038, 0.044, 0.048, 0.056]
    parts = [C.tube("sax_tube", path, radii, mats["brass"], bevel_res=3, res=8)]
    tangent = (path[-1] - path[-2]).normalized() + V((0, -0.25, 0))
    bell = C.lathe("sax_bell", [(0.056, 0.0), (0.060, 0.035), (0.071, 0.070), (0.090, 0.096), (0.106, 0.108), (0.110, 0.108), (0.104, 0.102)],
                   None, steps=24, matrix=Matrix.Translation(path[-1]) @ C.z_to(tangent), smooth=None)
    bell.data.materials.append(mats["brass"])
    bell.data.materials.append(mats["black"])
    C.material_by(bell, lambda p: 1 if (p - path[-1]).length > 0.125 else 0)           # a black rim on the bell, as drawn
    parts.append(bell)
    a, b = path[3], path[5]
    axis = (b - a).normalized()
    front = V((-0.25, -1, 0))
    front = (front - axis * front.dot(axis)).normalized()
    side = axis.cross(front).normalized()
    n = 16
    for i in range(n):
        t = 0.05 + 0.9 * i / (n - 1)
        r_tube = C.lerp(radii[3], radii[5], t)
        swing = (-0.55, 0.0, 0.55)[i % 3]
        normal = (front + side * swing).normalized()
        centre = a.lerp(b, t) + normal * (r_tube + 0.006)
        size = 0.0085 + 0.006 * t
        parts.append(C.cyl("sax_key", size, size * 0.8, 0.006, Matrix.Translation(centre) @ C.z_to(normal), mats["black"], seg=8))
    for swing in (-0.8, 0.8):
        normal = (front + side * swing).normalized()
        parts.append(C.rod("sax_rod", a.lerp(b, 0.03) + normal * (radii[3] + 0.010), a.lerp(b, 0.97) + normal * (radii[5] + 0.010), 0.003, mats["black"], seg=6))
    parts.append(C.rod("sax_ligature", path[0].lerp(path[1], 0.35), path[0].lerp(path[1], 0.65), 0.0135, mats["black"], seg=10))
    parts.append(C.rod("sax_collar", path[3] + V((0, 0, 0.012)), path[3] - V((0, 0, 0.010)), 0.024, mats["black"], seg=12))
    sax = C.join(parts, TAG + "_instrument")
    grips = {"L": path[3].lerp(path[4], 0.42), "R": path[4].lerp(path[5], 0.52)}
    return sax, grips


def skin_horn(sax, rig, path):
    """Weights along the horn: the neck and body tube follow sax_lo, the bow and bell sax_hi, blended around the bottom bend."""
    lens = [0.0]
    for p0, p1 in zip(path, path[1:]):
        lens.append(lens[-1] + (p1 - p0).length)
    split = lens[5]
    lo, hi = sax.vertex_groups.new(name="sax_lo"), sax.vertex_groups.new(name="sax_hi")
    for v in sax.data.vertices:
        best = (1e9, 0.0)
        for i, (p0, p1) in enumerate(zip(path, path[1:])):
            d = p1 - p0
            t = max(0.0, min(1.0, (v.co - p0).dot(d) / d.length_squared))
            dist = (v.co - (p0 + d * t)).length
            if dist < best[0]:
                best = (dist, lens[i] + t * d.length)
        w = C.smooth((best[1] - (split - 0.06)) / 0.12)
        lo.add([v.index], 1.0 - w, "REPLACE")
        hi.add([v.index], w, "REPLACE")
    sax.parent = rig.arm
    sax.modifiers.new("Armature", "ARMATURE").object = rig.arm


def turn_ups(J, s, mats, hc):
    """Trouser turn-ups: a cream ring round each ankle, following the shin."""
    rings = []
    for side in ("L", "R"):
        ring = C.cyl("cuff", 0.066 * s, 0.064 * s, 0.040 * s, Matrix.Translation(J["ankle_" + side] + V((0, 0, 0.045 * s))), mats["cream"], seg=16)
        rings.append(C.set_group(ring, "shin_" + side))
    return C.join(rings, "turn_ups")


def build():
    s = S

    def paint_body(c, bone):
        if bone == "foot":
            return "black"
        if bone in ("thigh", "shin"):
            return "cream"
        if bone in ("hand", "fingers"):
            return "skin"
        if bone in ("upper_arm", "forearm"):
            return "cream"
        return stripes(c.z, s)                              # turtleneck: torso and neck

    def coat(c):
        top, bottom = 1.50 * s, 0.98 * s                    # the coat hangs open in a V that shows the stripes
        if c.y < 0 and bottom < c.z < top:
            w = 0.125 * s * ((c.z - bottom) / (top - bottom)) ** 0.8
            if abs(c.x) < w:
                return stripes(c.z, s)
        return "cream"

    c = C.make_character(
        TAG, s=s, build=0.88, joints=dict(shoulder=0.18, stance=0.10, upper=0.30, fore=0.27),
        radii={"chest": 0.150, "hips": 0.140, "spine": 0.136, "knee": 0.068, "ankle": 0.056}, head_width=0.084,
        hat=C.hat_newsboy, head_props=(C.sunglasses,), chest_props=(turn_ups,), paint_body=paint_body,
        garments=[dict(name="coat", sleeve=0.94, hem=0.96, tail=0.24, flare=1.08, reach=0.16, puff=0.030, thickness=0.007, widen=1.04,
                       collar=0.030, paint=coat)],
        extra_bones=lambda J: [("sax_lo", sax_path(J, s)[3], sax_path(J, s)[5], "chest", True),
                               ("sax_hi", sax_path(J, s)[5], sax_path(J, s)[8], "sax_lo", True)])
    rig, J, body = c["rig"], c["J"], c["body"]

    path = sax_path(J, s)
    sax, grips = build_saxophone(c, path)
    skin_horn(sax, rig, path)
    palm = 0.075 * s
    targets = {
        "L": rig.grip_matrix("L", grips["L"] + V((0.052, 0.004, 0)), (-0.18, -1, -0.10), (-1, 0, 0), palm),
        "R": rig.grip_matrix("R", grips["R"] + V((-0.058, 0.004, 0)), (0.18, -1, -0.10), (1, 0, 0), palm),
    }
    base = {side: rig.basis("ik_hand_" + side, m) for side, m in targets.items()}

    def hook(rig, phase, f, t):
        for side in ("L", "R"):
            rig.set_target("ik_hand_" + side, *base[side])
        if phase == "solo":
            b = t
            lean = C.off(b * 0.5) ** 1.2                    # leans back over two beats, comes forward over two
            M.rot(rig, "spine", x=6 - 22 * lean, z=3 * math.sin(math.tau * b / 4))
            M.rot(rig, "chest", x=4 - 14 * lean)
            M.rot(rig, "head", x=-10 * lean)
            wob = math.sin(math.pi * b)
            M.rot(rig, "sax_lo", x=-6 * wob)
            M.rot(rig, "sax_hi", x=28 * wob, z=14 * math.sin(math.pi * b + 1.2))      # the bell flops like rubber
            eighth = 0.5 + 0.5 * math.sin(math.tau * b)
            M.rot(rig, "fingers_L", z=-(34 + 16 * eighth))
            M.rot(rig, "fingers_R", z=(34 + 16 * (1 - eighth)))
        else:
            lag = math.sin(math.pi * min(1.0, t * 2.2)) * (1 - t)       # the bell trails the jump
            M.rot(rig, "sax_hi", x=-24 * lag if phase == "emerge" else 24 * lag)
            M.rot(rig, "fingers_L", z=-40)
            M.rot(rig, "fingers_R", z=40)

    names = M.animate(c, hook)
    return dict(c, objects=[c["root"], rig.arm, body, sax], instrument=sax, actions=names)
