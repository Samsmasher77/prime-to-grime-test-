"""
Grime to Prime BBQ — Blender Python Model Generator
====================================================
Recreates the 3D BBQ explodex from the website as editable Blender objects.

HOW TO USE:
  1. Open Blender (2.93 or newer)
  2. Go to the Scripting workspace (top bar tab)
  3. Click "Open" and select this file, OR paste the contents into the text editor
  4. Click the "Run Script" button (triangle/play icon)
  5. The BBQ model will appear in your scene organized by part collections
  6. File > Export > FBX (.fbx) to save

PARTS CREATED (each in its own Collection):
  Cart_Frame        — legs, bottom shelf, rails, wheels
  Firebox_Body      — main cook box
  Side_Shelves      — left and right fold-out shelves
  Drip_Tray         — grease collection basin
  Burners           — 3 horizontal gas tubes
  Flavorizer_Bars   — 5 angled bars above burners
  Cooking_Grates    — grid of bars at the top of cook box
  Grill_Lid         — dome, rim, handle, vent

COORDINATE SYSTEM NOTE:
  The model is built in Blender Z-up coordinates, matching how it
  appears in the browser. The grill stands upright with legs pointing -Z.
  Units are in metres; the full grill is ~6.5 units tall.
"""

import bpy
import bmesh
import math

PI = math.pi


# ─── Helpers ──────────────────────────────────────────────────────────────────

def t2b(x, y, z):
    """Convert Three.js (Y-up) position to Blender (Z-up): swap Y↔Z, negate new Y."""
    return (x, -z, y)


def make_collection(name, parent=None):
    col = bpy.data.collections.new(name)
    target = parent if parent else bpy.context.scene.collection
    target.children.link(col)
    return col


def link_to(obj, col):
    """Move object out of its current collections and into col."""
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)


def apply_material(obj, hex_color, roughness=0.62, metalness=0.35):
    r = ((hex_color >> 16) & 0xFF) / 255.0
    g = ((hex_color >>  8) & 0xFF) / 255.0
    b = ( hex_color        & 0xFF) / 255.0
    mat = bpy.data.materials.new(name=obj.name + "_M")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metalness
    obj.data.materials.append(mat)
    return mat


def add_box(col, name, w, h, d, x, y, z,
            rx=0.0, ry=0.0, rz=0.0,
            color=0x333333, roughness=0.62, metalness=0.35):
    """
    Add a box (BoxGeometry equivalent).
      w = X size, h = Y size (up in Three.js / Z in Blender), d = Z size (depth)
      Position and rotation are given in Three.js coordinates.
      Rotation conversion: Three.js (rx, ry, rz) → Blender Euler (rx, -rz, ry)
    """
    bpy.ops.mesh.primitive_cube_add(size=1, location=t2b(x, y, z))
    obj = bpy.context.active_object
    obj.name = name
    # size=1 cube spans -0.5..0.5 on each axis, so scale = full dimension
    obj.scale = (w, d, h)            # Blender axes: X=w, Y=depth, Z=height
    obj.rotation_euler = (rx, -rz, ry)
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    link_to(obj, col)
    apply_material(obj, color, roughness, metalness)
    return obj


def add_cylinder_x(col, name, radius, length, x, y, z,
                   color=0x444444, roughness=0.50, metalness=0.60, verts=16):
    """
    Add a cylinder running along the X axis.
    Equivalent to Three.js CylinderGeometry with rotation.z = PI/2.
    """
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts, radius=radius, depth=length,
        location=t2b(x, y, z)
    )
    obj = bpy.context.active_object
    obj.name = name
    # Default Blender cylinder is along Z; rotate 90° around Y → along X
    obj.rotation_euler = (0, PI / 2, 0)
    bpy.ops.object.transform_apply(rotation=True)
    link_to(obj, col)
    apply_material(obj, color, roughness, metalness)
    return obj


def add_cylinder_y(col, name, radius, length, x, y, z,
                   color=0x444444, verts=12):
    """
    Add a cylinder running along the Blender Y axis (= Three.js -Z direction).
    Used for wheels (Three.js cylinder with rotation.x = PI/2).
    """
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts, radius=radius, depth=length,
        location=t2b(x, y, z)
    )
    obj = bpy.context.active_object
    obj.name = name
    # Rotate 90° around X → along Y
    obj.rotation_euler = (PI / 2, 0, 0)
    bpy.ops.object.transform_apply(rotation=True)
    link_to(obj, col)
    apply_material(obj, color)
    return obj


def add_dome(col, name, radius, length, x, y, z, color=0x333333):
    """
    Add a half-cylinder dome running along the X axis, opening downward.
    Equivalent to Three.js CylinderGeometry(r, r, h, 24, 1, false, 0, PI)
    with rotation.z = PI/2.
    """
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=24, radius=radius, depth=length,
        location=t2b(x, y, z)
    )
    obj = bpy.context.active_object
    obj.name = name
    # Rotate so cylinder runs along X
    obj.rotation_euler = (0, PI / 2, 0)
    bpy.ops.object.transform_apply(rotation=True)

    # Enter edit mode and remove the bottom half (local Z < 0)
    bpy.ops.object.editmode_toggle()
    bm = bmesh.from_edit_mesh(obj.data)
    bm.verts.ensure_lookup_table()

    for v in bm.verts:
        v.select = (v.co.z < -0.001)
    bm.select_flush_mode()

    geom = [f for f in bm.faces if f.select]
    bmesh.ops.delete(bm, geom=geom, context="FACES")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    bmesh.update_edit_mesh(obj.data)
    bpy.ops.object.editmode_toggle()

    link_to(obj, col)
    apply_material(obj, color, roughness=0.60, metalness=0.20)
    return obj


# ─── Clear scene ──────────────────────────────────────────────────────────────

def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for col in list(bpy.data.collections):
        bpy.data.collections.remove(col)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)

clear_scene()


# ─── Top-level collection ─────────────────────────────────────────────────────

root = make_collection("BBQ_Grime_to_Prime")

frame_col    = make_collection("Cart_Frame",       root)
firebox_col  = make_collection("Firebox_Body",     root)
shelves_col  = make_collection("Side_Shelves",     root)
drip_col     = make_collection("Drip_Tray",        root)
burners_col  = make_collection("Burners",          root)
flavor_col   = make_collection("Flavorizer_Bars",  root)
grates_col   = make_collection("Cooking_Grates",   root)
lid_col      = make_collection("Grill_Lid",        root)


# ─── 1. Cart & Frame ──────────────────────────────────────────────────────────
FRAME_COLOR = 0x2e2e2e

# Four legs
for xi, zi in [(-2.2, 1.0), (2.2, 1.0), (-2.2, -1.0), (2.2, -1.0)]:
    add_box(frame_col, "Leg", 0.15, 3.0, 0.15, xi, -1.55, zi,
            color=FRAME_COLOR)

# Bottom shelf
add_box(frame_col, "Bottom_Shelf", 4.55, 0.06, 2.2, 0, -2.8, 0,
        color=FRAME_COLOR)

# Front and back rails
add_box(frame_col, "Front_Rail", 4.55, 0.06, 0.06, 0, -0.55,  1.08,
        color=FRAME_COLOR)
add_box(frame_col, "Back_Rail",  4.55, 0.06, 0.06, 0, -0.55, -1.08,
        color=FRAME_COLOR)

# Wheels (run along Three.js Z-axis → Blender Y-axis)
for xi in [-2.2, 2.2]:
    add_cylinder_y(frame_col, "Wheel", 0.18, 0.10, xi, -3.0, 1.0,
                   color=FRAME_COLOR, verts=12)


# ─── 2. Firebox Body ──────────────────────────────────────────────────────────
add_box(firebox_col, "Firebox", 5.0, 1.6, 2.4, 0, 0.8, 0,
        color=0x303030)


# ─── 3. Side Shelves ──────────────────────────────────────────────────────────
SHELF_COLOR = 0x383838

add_box(shelves_col, "Left_Shelf",    1.8,  0.05, 2.4, -3.4,  0.85, 0, color=SHELF_COLOR)
add_box(shelves_col, "Left_Support",  0.05, 0.42, 2.4, -2.52, 0.64, 0, color=SHELF_COLOR)
add_box(shelves_col, "Right_Shelf",   1.8,  0.05, 2.4,  3.4,  0.85, 0, color=SHELF_COLOR)
add_box(shelves_col, "Right_Support", 0.05, 0.42, 2.4,  2.52, 0.64, 0, color=SHELF_COLOR)


# ─── 4. Drip Tray ─────────────────────────────────────────────────────────────
TRAY_COLOR = 0x2a2a2a

add_box(drip_col, "Tray_Base",       4.60, 0.10, 2.00, 0,     0.12,  0,    color=TRAY_COLOR)
add_box(drip_col, "Tray_Front_Wall", 4.60, 0.14, 0.06, 0,     0.22,  0.97, color=TRAY_COLOR)
add_box(drip_col, "Tray_Back_Wall",  4.60, 0.14, 0.06, 0,     0.22, -0.97, color=TRAY_COLOR)
add_box(drip_col, "Tray_Right_Wall", 0.06, 0.14, 2.00, 2.22,  0.22,  0,    color=TRAY_COLOR)
add_box(drip_col, "Tray_Left_Wall",  0.06, 0.14, 2.00, -2.22, 0.22,  0,    color=TRAY_COLOR)


# ─── 5. Burners ───────────────────────────────────────────────────────────────
# Three.js: CylinderGeometry rotated PI/2 around Z → cylinder runs along X
for zi in [-0.6, 0.0, 0.6]:
    add_cylinder_x(burners_col, "Burner", 0.08, 4.5, 0, 0.48, zi,
                   color=0x5a5a5a, verts=12)


# ─── 6. Flavorizer Bars ───────────────────────────────────────────────────────
# Slightly tilted boxes (rx = 0.42 rad ≈ 24°)
for i in range(-2, 3):
    add_box(flavor_col, f"Flavorizer_{i+3}",
            4.45, 0.22, 0.26,
            0, 0.75, i * 0.38,
            rx=0.42,
            color=0x363636)


# ─── 7. Cooking Grates ────────────────────────────────────────────────────────
# Parallel bars running along X
for i in range(-4, 5):
    add_box(grates_col, f"Grate_Bar_{i+5}",
            4.45, 0.08, 0.05,
            0, 1.06, i * 0.24,
            color=0x525252)

# Cross members running along Z (depth)
for xi in [-1.8, 0.0, 1.8]:
    add_box(grates_col, "Grate_Cross",
            0.05, 0.08, 2.0,
            xi, 1.06, 0,
            color=0x525252)


# ─── 8. Grill Lid ─────────────────────────────────────────────────────────────
LID_COLOR = 0x3a3a3a

# Lid rim (flat ring where lid meets firebox)
add_box(lid_col, "Lid_Rim", 5.0, 0.22, 2.4, 0, 1.61, 0, color=LID_COLOR)

# Dome — half-cylinder running along X, arch pointing upward
add_dome(lid_col, "Lid_Dome", 1.15, 5.0, 0, 1.58, 0, color=LID_COLOR)

# Handle
add_box(lid_col, "Handle_Bar",    1.10, 0.12, 0.12,  0.0, 2.78, 0.0, color=LID_COLOR)
add_box(lid_col, "Handle_Left",   0.12, 0.32, 0.12, -0.5, 2.62, 0.0, color=LID_COLOR)
add_box(lid_col, "Handle_Right",  0.12, 0.32, 0.12,  0.5, 2.62, 0.0, color=LID_COLOR)

# Vent
add_box(lid_col, "Lid_Vent", 0.55, 0.06, 0.08, 0.2, 2.83, 0.5, color=LID_COLOR)


# ─── Done ─────────────────────────────────────────────────────────────────────

print("=" * 52)
print("  BBQ model created — Grime to Prime")
print("=" * 52)
print("  Collections:")
for col in root.children:
    count = len(col.objects)
    print(f"    {col.name:<22} ({count} object{'s' if count != 1 else ''})")
print()
print("  To export as FBX:")
print("    File  >  Export  >  FBX (.fbx)")
print("    Recommended: Apply Scalings = 'FBX Units Scale'")
print("=" * 52)
