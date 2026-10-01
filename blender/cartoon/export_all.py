"""Build the cartoon trio, check it against the character sheets, export Draco GLBs.

    blender --background --factory-startup --python blender/cartoon/export_all.py
    blender --background --factory-startup --python blender/cartoon/export_all.py -- sax          (only some of them)

Output: public/models/cartoon/<tag>.glb, blender/cartoon/previews/<tag>_{front,34,side,solo,glb}.png and report.json.
Previews are rendered in the sheet colours (before the toon finish); <tag>_glb.png is the exported file loaded back.
"""
import importlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import bpy

import common as C
import motion as M
import build_sax, build_bass, build_frontman

for m in (C, M, build_sax, build_bass, build_frontman):
    importlib.reload(m)

BUDGET = 15000                     # triangles per character (screening prompt 2-4)
BUILDERS = {"sax": build_sax, "bass": build_bass, "frontman": build_frontman}
VIEWS = {"front": (0, -1, 0.10), "34": (-0.72, -0.70, 0.22), "side": (-1, 0, 0.08)}
FRAMING = {"sax": ((0, 0, 0.90), 1.05), "bass": ((0.08, 0, 0.92), 1.10), "frontman": ((0, 0, 0.90), 1.02)}
SHEET_BG = (0.80, 0.78, 0.72)


def fit_budget(objects):
    meshes = [o for o in objects if o.type == "MESH"]
    tris = C.tri_count(meshes)
    if tris > BUDGET:
        big = [o for o in meshes if C.tri_count([o]) > 1500]
        ratio = (BUDGET * 0.96 - (tris - C.tri_count(big))) / C.tri_count(big)
        print("   %d triangles is over %d, decimating the large meshes to %.2f" % (tris, BUDGET, ratio))
        for o in big:
            C.decimate_to(o, ratio)
        tris = C.tri_count(meshes)
    return tris


def rename_materials(mapping):
    """paint_* -> toon_*; paints that map to the same toon name end up as one material"""
    target = {}
    for m in list(bpy.data.materials):
        if m.name in mapping:
            want = mapping[m.name]
            if want in target:
                continue
            m.name = want
            target[want] = m
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        for slot in o.material_slots:
            m = slot.material
            if m is not None and m.name in mapping and mapping[m.name] in target:
                slot.material = target[mapping[m.name]]


def show_action(rig, name, frame):
    ad = rig.arm.animation_data
    ad.action = bpy.data.actions[name]
    bpy.context.scene.frame_set(frame)


def main(only):
    report = {"blender": bpy.app.version_string, "budget": BUDGET, "models": {}}
    os.makedirs(C.MODELS, exist_ok=True)
    os.makedirs(C.PREVIEWS, exist_ok=True)
    for tag, module in BUILDERS.items():
        if only and tag not in only:
            continue
        print("== %s" % tag)
        C.reset_scene()
        built = module.build()
        rig = built["rig"]
        tris = fit_budget(built["objects"])
        center, radius = FRAMING[tag]
        acts = built["actions"]                                       # [out, loop, back] in that order
        show_action(rig, *(built.get("preview_action") or (acts[0], 0)))
        C.render_previews(tag, center, radius, VIEWS, frame=0, world=SHEET_BG)
        show_action(rig, acts[1], 17)
        C.render_previews(tag, (center[0], center[1], center[2] + 0.15), radius * 1.15, {"solo": VIEWS["34"]}, frame=17, world=SHEET_BG)
        show_action(rig, acts[1], 45)
        C.render_previews(tag, (center[0], center[1], center[2] + 0.15), radius * 1.15, {"solo4": VIEWS["front"]}, frame=45, world=SHEET_BG)
        show_action(rig, acts[0], 11)
        C.render_previews(tag, center, radius * 1.15, {"emerge": VIEWS["side"]}, frame=11, world=SHEET_BG)
        show_action(rig, acts[2], 24)
        C.render_previews(tag, (center[0], center[1], center[2] + 0.1), radius * 1.25, {"return": VIEWS["side"]}, frame=24, world=SHEET_BG)
        if built.get("keep_materials"):
            rename_materials(built["keep_materials"])               # named toon_* materials; the site sets their greys
        else:
            C.finalize_toon([o for o in built["objects"] if o.type == "MESH"])
        C.stash_actions(rig, built["actions"])
        path = os.path.join(C.MODELS, tag + ".glb")
        size = C.export_glb(path, built["objects"], animated=True)
        info = C.describe_glb(path)
        C.reset_scene()
        bpy.ops.import_scene.gltf(filepath=path)
        C.render_previews(tag, center, radius, {"glb": VIEWS["34"]}, frame=0, world=SHEET_BG)
        report["models"][tag] = {"triangles": tris, "bytes": size, "materials": info["materials"], "animations": info["animations"],
                                 "extensions": info["extensions"], "nodes": len(info["nodes"])}
        print("   %d triangles, %.1f KB, materials %s, animations %s" % (tris, size / 1024, info["materials"], info["animations"]))
    out = os.path.join(C.PREVIEWS, "report.json")
    previous = {}
    if only and os.path.exists(out):
        with open(out, encoding="utf-8") as f:
            previous = json.load(f).get("models", {})
    previous.update(report["models"])
    report["models"] = previous
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    main(set(argv))
