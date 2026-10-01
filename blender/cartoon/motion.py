"""The three actions every cartoon player has, at 30 fps:

    emerge  1.0s  crouch (squash), spring toward the camera (stretch), settle into the air pose
    solo    3.0s  8 beats at 160 BPM, loops: legs kicking on alternate beats, a small squash on every offbeat
    return  1.0s  tuck, then stretch long for the dive back into the screen

The flight path itself (out of the screen, the arc, back in) is done in three.js on the model's root node; these actions only
pose the body. Every frame starts from the rest pose and keys every bone, so no action leaves a pose behind for the next one.
Each character adds its own hands, instrument and props through hook(rig, phase, frame, t) — t is 0..1 for emerge/return
and the beat (0..8) for solo.
"""
import math

from mathutils import Vector as V

import common as C


def rot(rig, bone, x=0.0, y=0.0, z=0.0):
    rig.pb(bone).rotation_euler = (C.rad(x), C.rad(y), C.rad(z))


def feet(rig, s, d_left, d_right, pitch):
    rig.offset("ik_foot_L", V(d_left) * s, pitch)
    rig.offset("ik_foot_R", V(d_right) * s, pitch)


AIR = V((0.0, -0.04, 0.22))          # air pose: knees up a little, feet under the body


def emerge(rig, s, f):
    crouch = C.smooth(f / 9) * (1 - C.smooth((f - 9) / 4))
    launch = C.smooth((f - 9) / 5) * (1 - C.smooth((f - 14) / 16))
    air = C.smooth((f - 14) / 16)
    rig.offset("hips", V((0, 0.03 * crouch, -0.16 * crouch + 0.05 * launch)) * s)
    rot(rig, "spine", x=16 * crouch - 10 * launch + 6 * air)
    rot(rig, "chest", x=8 * crouch - 6 * launch + 4 * air)
    rot(rig, "head", x=-12 * crouch + 4 * launch)
    C.squash(rig, 0.14 * crouch - 0.24 * launch)
    trail = V((0, 0.10, -0.06))
    for side, sx in (("L", 1), ("R", -1)):
        d = trail * launch + AIR * air
        d.x += sx * 0.02 * air
        rig.offset("ik_foot_" + side, d * s, 40 * launch + 30 * air)


def solo(rig, s, b):
    kick_l = max(0.0, math.sin(math.pi * b)) ** 2
    kick_r = max(0.0, -math.sin(math.pi * b)) ** 2
    for side, sx, k in (("L", 1, kick_l), ("R", -1, kick_r)):
        d = AIR + V((sx * 0.02, -0.14 * k, 0.12 * k))
        rig.offset("ik_foot_" + side, d * s, 30 - 20 * k)
    rig.offset("hips", V((0.02 * math.sin(math.tau * b / 4), 0, 0.025 * (C.on(b) - 1))) * s)
    rot(rig, "spine", x=6)
    rot(rig, "chest", x=4)
    C.squash(rig, 0.05 * C.off(b) ** 4)


def dive(rig, s, f):
    tuck = C.smooth(f / 8) * (1 - C.smooth((f - 8) / 8))
    stretch = C.smooth((f - 8) / 10)
    C.squash(rig, 0.12 * tuck - 0.30 * stretch)
    for side, sx in (("L", 1), ("R", -1)):
        d = AIR * (1 - stretch) + V((0, 0, 0.08 * tuck)) + V((-sx * 0.03, 0.06, -0.10)) * stretch
        d.x += sx * 0.02 * (1 - stretch)
        rig.offset("ik_foot_" + side, d * s, 30 + 30 * stretch)
    rot(rig, "spine", x=6 + 14 * tuck - 6 * stretch)
    rot(rig, "chest", x=4 + 6 * tuck - 4 * stretch)
    rot(rig, "head", x=-8 * stretch)


def animate(c, hook):
    """Make the three actions on the character's rig. Returns their names in order."""
    rig, s = c["rig"], c["s"]
    plan = (("emerge", C.EMERGE_FRAMES, lambda f: emerge(rig, s, f), lambda f: f / C.EMERGE_FRAMES),
            ("solo", C.SOLO_FRAMES, lambda f: solo(rig, s, C.beat(f)), lambda f: C.beat(f)),
            ("return", C.RETURN_FRAMES, lambda f: dive(rig, s, f), lambda f: f / C.RETURN_FRAMES))
    names = []
    for name, frames, body, clock in plan:
        act = C.start_action(rig, name)
        ad = rig.arm.animation_data
        for f in range(frames + 1):
            ad.action = None                 # while posing, nothing keyed may override the values (rig.posed() evaluates the scene)
            C.reset_pose(rig)
            body(f)
            hook(rig, name, f, clock(f))
            ad.action = act
            C.key_all(rig, f)
        names.append(name)
    return names
