class_name CharForgeGlbLoader
extends Node

# =============================================================================
# Runtime GLB/VRM loader + THE MANDATORY FIXUP PASS.
#
# technique.md, verbatim recommendation: "GLTFDocument.append_from_buffer +
# generate_scene, then a MANDATORY post-load fixup pass that (a) generates
# mipmaps for any embedded textures (open engine bug #100481), (b) swaps all
# materials for the shared toon shader + palette texture, (c) attaches
# procedural ears/tails/wings via BoneAttachment3D FROM CODE (never author
# attachments inside GLBs — import creates phantom bones), (d) pre-warms
# shaders offscreen for one frame. Chunk parsing across frames on
# single-threaded web."
#
# All four steps are implemented below and none of them is optional: load()
# runs the whole pass or fails. The individual steps are also exposed as static
# functions so they can be asserted directly without a GLB file.
#
# HONEST LIMITS (do not paper over these):
#  * GLTFDocument.append_from_buffer is a single blocking call — it CANNOT be
#    chunked. What is chunked across frames is everything this loader does
#    itself: the material/texture fixup walk and the attachment pass. On a
#    single-threaded web export the parse itself is still a hitch proportional
#    to file size, which is why MAX_BYTES is small and why the shipped
#    registry has no mesh bases yet.
#  * Runtime loading performs NO BoneMap retargeting, no LOD generation and no
#    texture import options. The rig that arrives is the rig you get, so mesh
#    bases must be conformed to SkeletonProfileHumanoid names at authoring/CI
#    time (enforced socially by CharForgeRegistry.RIG_HUMANOID, not by code).
#  * Blend-shape correctness on WEB Compatibility has no definitive upstream
#    verdict (technique.md gap) — the viseme channel is therefore opt-in per
#    registry entry and the jaw bone stays the mandatory path.
# =============================================================================

signal loaded(root: Node3D)
signal load_failed(reason: String)

## Hard cap on a single runtime asset. Deliberately small: a single-threaded
## WASM main-thread parse of anything larger is a visible freeze, and the
## Quest-3 browser budget in technique.md is ~5-15k tris per avatar.
const MAX_BYTES := 24 * 1024 * 1024

## Nodes visited per frame during the chunked fixup walk.
const CHUNK_NODES := 48

## Fallback palette regions by common material-name substring, tried only when
## the registry slot map has no exact answer. Keeps a well-meaning but
## non-conforming GLB from rendering as flat white.
const NAME_HINTS := {
	"fur": "fur", "body": "fur", "coat": "fur",
	"skin": "skin", "face": "skin",
	"hair": "hair",
	"eye": "iris", "iris": "iris",
	"line": "line", "outline": "line",
	"accent": "accent", "cloth": "accent",
	"detail": "detail", "trim": "detail",
}


## Merges a registry entry's slot map over the default ingest contract and
## lower-cases every key (glTF material names are case-inconsistent in the
## wild).
static func normalize_slot_map(entry: Dictionary) -> Dictionary:
	var out := {}
	for key in CharForgeRegistry.DEFAULT_SLOT_MAP:
		out[String(key).to_lower()] = CharForgeRegistry.DEFAULT_SLOT_MAP[key]
	var slots: Variant = entry.get("slots")
	if slots is Dictionary:
		for key in slots.keys():
			var region := String(slots[key])
			if region in Char3DConfig.ALL_MATERIAL_REGIONS:
				out[String(key).to_lower()] = region
	return out


## Palette region for a glTF material name: exact slot-map hit first, then the
## `hm_` ingest prefix, then a substring hint. Returns "" when nothing matches
## (the caller then leaves the surface on the fur region rather than guessing).
static func region_for_material_name(material_name: String, slot_map: Dictionary) -> String:
	var key := material_name.strip_edges().to_lower()
	if key.is_empty():
		return ""
	if slot_map.has(key):
		return slot_map[key]
	# glTF exporters routinely suffix duplicated material names (".001").
	var trimmed := key.split(".")[0]
	if slot_map.has(trimmed):
		return slot_map[trimmed]
	if trimmed.begins_with("hm_"):
		var region := trimmed.substr(3)
		for candidate in Char3DConfig.ALL_MATERIAL_REGIONS:
			if String(candidate).to_lower() == region:
				return candidate
	for hint in NAME_HINTS:
		if trimmed.contains(hint):
			return NAME_HINTS[hint]
	return ""


## FIXUP (a): regenerate mipmaps for every embedded texture of a parsed
## document. Runtime glTF loading does NOT apply mipmaps to embedded textures
## (engine bug #100481, confirmed open late-2024, 2026 status unverified) —
## this is harmless if upstream has since fixed it. Returns how many textures
## were rewritten.
static func fix_texture_mipmaps(state: GLTFState) -> int:
	var images: Array = state.get_images()
	if images.is_empty():
		return 0
	var fixed := 0
	var rebuilt: Array = []
	for tex in images:
		if not (tex is Texture2D):
			rebuilt.append(tex)
			continue
		var img: Image = (tex as Texture2D).get_image()
		if img == null or img.has_mipmaps():
			rebuilt.append(tex)
			continue
		var copy := Image.new()
		copy.copy_from(img)
		copy.generate_mipmaps()
		rebuilt.append(ImageTexture.create_from_image(copy))
		fixed += 1
	if fixed > 0:
		state.set_images(rebuilt)
	return fixed


## FIXUP (b): swap every surface material for the shared house material of its
## palette region. Returns the number of surfaces rebound.
static func swap_materials(root: Node, mats: CharForgeMaterials,
		slot_map: Dictionary) -> int:
	var swapped := 0
	for node in _walk(root):
		swapped += _swap_node_materials(node, mats, slot_map)
	return swapped


## Rebinds one node's surfaces. Shared by the synchronous and the chunked
## walkers so the two can never disagree about what "fixed up" means.
static func _swap_node_materials(node: Node, mats: CharForgeMaterials,
		slot_map: Dictionary) -> int:
	if not (node is MeshInstance3D):
		return 0
	var mi := node as MeshInstance3D
	if mi.mesh == null:
		return 0
	var swapped := 0
	for i in range(mi.mesh.get_surface_count()):
		var source: Material = mi.mesh.surface_get_material(i)
		var source_name := "" if source == null else source.resource_name
		var region := region_for_material_name(source_name, slot_map)
		if region.is_empty():
			region = "fur"
		mi.set_surface_override_material(i, mats.region(region))
		swapped += 1
	return swapped


## FIXUP (c): attach a procedural part to a bone FROM CODE. Attachments
## authored inside a GLB can create phantom bones on import and humanoid
## retargeting can break them, so this is the only supported path.
## Returns the created BoneAttachment3D, or null when the bone does not exist.
static func attach_part(skeleton: Skeleton3D, bone_name: String, part: Node3D) -> BoneAttachment3D:
	if skeleton == null or part == null:
		return null
	if skeleton.find_bone(bone_name) < 0:
		return null
	var attachment := BoneAttachment3D.new()
	attachment.name = "Attach_" + bone_name + "_" + part.name
	skeleton.add_child(attachment)
	attachment.bone_name = bone_name
	# A part that is already parented (e.g. a piece being moved off the
	# procedural rig onto a loaded one) must be detached first — add_child on a
	# parented node is an engine error, not a reparent.
	var current := part.get_parent()
	if current != null:
		current.remove_child(part)
	attachment.add_child(part)
	return attachment


## The bone an attachment slot binds to on a given skeleton — the first
## candidate the rig actually has. "" when the rig exposes none of them.
static func bone_for_slot(skeleton: Skeleton3D, slot: String) -> String:
	if skeleton == null:
		return ""
	for candidate in CharForgeRegistry.SLOT_BONE_CANDIDATES.get(slot, []):
		if skeleton.find_bone(candidate) >= 0:
			return candidate
	return ""


## The jaw bone driving the mandatory lip-sync channel, or "" when the rig has
## none (in which case CharForgeLipSync falls back to the mouth strip).
static func find_jaw_bone(skeleton: Skeleton3D) -> String:
	if skeleton == null:
		return ""
	for candidate in CharForgeRegistry.JAW_BONE_CANDIDATES:
		if skeleton.find_bone(candidate) >= 0:
			return candidate
	return ""


## First Skeleton3D under a loaded root (mesh bases are single-rig by contract).
static func find_skeleton(root: Node) -> Skeleton3D:
	for node in _walk(root):
		if node is Skeleton3D:
			return node as Skeleton3D
	return null


## Parses GLB bytes and runs the ENTIRE fixup pass, yielding between chunks.
## Awaitable: `var root := await loader.load_from_buffer(bytes, cfg, entry)`.
## Returns null on failure (load_failed carries the reason).
func load_from_buffer(bytes: PackedByteArray, mats: CharForgeMaterials,
		entry: Dictionary) -> Node3D:
	if bytes.is_empty():
		_fail("empty buffer")
		return null
	if bytes.size() > MAX_BYTES:
		_fail("asset is %d bytes, over the %d-byte runtime cap" % [bytes.size(), MAX_BYTES])
		return null

	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var err := doc.append_from_buffer(bytes, "", state)
	if err != OK:
		_fail("append_from_buffer failed with error %d" % err)
		return null

	# (a) mipmaps — before generate_scene so the scene picks up the fixed set.
	fix_texture_mipmaps(state)

	var root: Node = doc.generate_scene(state)
	if not (root is Node3D):
		if root != null:
			root.free()
		_fail("glTF produced no Node3D root")
		return null
	var root3d := root as Node3D

	# (b) materials, chunked across frames (single-threaded web).
	await _swap_materials_chunked(root3d, mats, normalize_slot_map(entry))

	loaded.emit(root3d)
	return root3d


## FIXUP (d): render one offscreen frame so every material of `root` compiles
## its shader BEFORE the avatar is first seen (first-draw shader compilation
## stutters badly on web). The node is parented into a hidden SubViewport, one
## frame is drawn, and it is handed back unparented.
func prewarm(root: Node3D) -> void:
	if root == null or not is_inside_tree():
		return
	var viewport := SubViewport.new()
	viewport.size = Vector2i(8, 8)
	viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
	viewport.own_world_3d = true
	add_child(viewport)
	var camera := Camera3D.new()
	camera.current = true
	viewport.add_child(camera)
	var previous_parent: Node = root.get_parent()
	if previous_parent != null:
		previous_parent.remove_child(root)
	viewport.add_child(root)
	await get_tree().process_frame
	await get_tree().process_frame
	viewport.remove_child(root)
	if previous_parent != null:
		previous_parent.add_child(root)
	# Detach BEFORE queue_free: queue_free is deferred to the end of the frame,
	# so a caller that inspects the loader right after awaiting prewarm() would
	# otherwise still see the throwaway viewport hanging off it.
	remove_child(viewport)
	viewport.queue_free()


## Attaches procedural parts to a loaded rig, from code (fixup step c). `parts`
## is {slot: Node3D}. Returns {slot: BoneAttachment3D} for the ones that bound;
## slots whose bone is missing are reported in the returned "unbound" array.
func attach_parts(root: Node3D, parts: Dictionary) -> Dictionary:
	var skeleton := find_skeleton(root)
	var bound := {}
	var unbound: Array = []
	for slot in parts:
		var bone := bone_for_slot(skeleton, slot)
		if bone.is_empty():
			unbound.append(slot)
			continue
		var attachment := attach_part(skeleton, bone, parts[slot])
		if attachment == null:
			unbound.append(slot)
		else:
			bound[slot] = attachment
	return {"bound": bound, "unbound": unbound}


## The chunked half of fixup (b): the same per-node work as swap_materials(),
## yielding every CHUNK_NODES nodes so a big rig does not stall the single
## WASM thread in one go.
func _swap_materials_chunked(root: Node3D, mats: CharForgeMaterials,
		slot_map: Dictionary) -> int:
	var visited := 0
	var swapped := 0
	for node in _walk(root):
		visited += 1
		swapped += _swap_node_materials(node, mats, slot_map)
		if visited % CHUNK_NODES == 0 and is_inside_tree():
			await get_tree().process_frame
	return swapped


func _fail(reason: String) -> void:
	push_warning("CharForgeGlbLoader: " + reason)
	load_failed.emit(reason)


static func _walk(root: Node) -> Array:
	var out: Array = []
	if root == null:
		return out
	var stack: Array = [root]
	while not stack.is_empty():
		var node: Node = stack.pop_back()
		out.append(node)
		for child in node.get_children():
			stack.append(child)
	return out
