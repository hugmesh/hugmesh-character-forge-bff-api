extends Node3D

# Character Forge studio — turntable scene controller.
#
# Owns the CharacterAssembler instance, the orbit camera, the turntable spin,
# the transparent snapshot SubViewport (for CharForge.snapshot avatar/sticker
# reuse), and the built-in editor UI. The built-in UI makes the export a
# playable game in the hugmesh.games portal on its own; when the Angular
# character-forge remote embeds the engine it drives everything through the
# CharForge JavaScriptBridge singleton instead (and may hide the built-in UI
# via CharForge.setUiVisible(false)).

const ORBIT_SENSITIVITY := 0.42
const ZOOM_STEP := 0.18
const MIN_DISTANCE := 1.4
const MAX_DISTANCE := 6.0
const SNAP_SIZE := 1024

# Built-in UI cycle lists per part slot (VN partId vocabulary; the assembler
# keyword-matches unknown ids so free-form values from /map still render).
const UI_PART_CHOICES := {
	"tail": [null, "tail_fox_01", "tail_wolf_bushy_01", "tail_cat_01", "tail_lion_01",
			"tail_feather_fan_01", "tail_spade_01", "tail_thick_lizard_01", "tail_eastern_01",
			"tail_horse_01", "tail_deer_01", "tail_bunny_puff_01", "tail_rat_thin_01",
			"tail_squirrel_01", "tail_ringed_01", "tail_shark_01", "tail_cetacean_01",
			"tail_hyena_01", "tail_pig_curl_01", "tail_macropod_01", "tail_goo_01",
			"tail_synth_01", "tail_bear_stub_01", "tail_cow_tassel_01"],
	"wings": [null, "wings_feathered_01", "wings_dragon_01", "wings_bat_01",
			"wings_butterfly_01", "wings_moth_01", "wings_insect_01", "wings_crystal_01",
			"wings_goo_01", "wings_small_01"],
	"ears": [null, "ears_lop_01", "ears_pointy", "ears_round", "ears_long",
			"ears_huge", "ears_fin", "ears_tuft", "ears_goo_01", "ears_none"],
	"feature": [null, "feature_mane_01", "feature_antlers_01", "feature_unicorn_horn_01",
			"feature_dragon_horns_01", "feature_ram_horns_01", "feature_bull_horns_01",
			"feature_goat_horns_01", "feature_frill_01", "feature_head_crest_01",
			"feature_dorsal_fin_01", "feature_head_fins_01", "feature_tusks_01",
			"feature_antennae_01", "feature_antennae_ball_01", "feature_halo",
			"feature_core_orb_01", "feature_snail_shell_01", "feature_goo_crown_01",
			"feature_hyena_mane_01", "feature_dragon_spines_01", "feature_synth_fins_01"],
	"accessory": [null, "accessory_bandana_01", "accessory_collar_01", "accessory_glasses_01",
			"accessory_ear_piercing_01", "accessory_mushroom_cap_01", "accessory_slime_pet_01"],
	"markings": [null, "marking_mask_01", "marking_countershade_01", "marking_sock_01",
			"marking_muzzle_blaze_01", "marking_fawn_spots_01", "marking_tiger_stripes_01",
			"marking_bee_stripes_01", "marking_belly_scutes_01", "marking_holstein_patches_01",
			"marking_metallic_sheen_01", "marking_crystal_growths_01", "marking_goo_drip_01"],
	"hair": [null, "hair_default_01", "hair_flower_01", "hair_leafy_01", "hair_goo_01"],
}

var assembler: CharacterAssembler = null
## Mounts vendored-pack meshes (and BYO imports) onto the assembler rig.
var mount: CharForgeMount = null

var _bridge: Node = null
## Catalogue key currently selected ("" = the purely procedural avatar).
var _pack_key := ""
var _auto_rotate := true
var _orbiting := false
var _cam_distance := 2.9
var _syncing := false
var _snap_viewport: SubViewport = null
var _snap_camera: Camera3D = null
var _ui: Dictionary = {}

@onready var _turntable: Node3D = $Turntable
@onready var _char_root: Node3D = $Turntable/CharacterRoot
@onready var _gimbal: Node3D = $CameraGimbal
@onready var _pitch: Node3D = $CameraGimbal/Pitch
@onready var _camera: Camera3D = $CameraGimbal/Pitch/Camera3D
@onready var _ui_layer: CanvasLayer = $UI


func _ready() -> void:
	_setup_stage()
	assembler = CharacterAssembler.new()
	assembler.name = "Character"
	_char_root.add_child(assembler)

	# The assembler never loads anything itself — it announces that the resolved
	# basis is a mesh and this mount fetches it (DESIGN §2 part-registry
	# indirection). Connected BEFORE the first apply_config so a pack selected
	# from a saved config mounts on the very first rebuild.
	mount = CharForgeMount.new(assembler)
	add_child(mount)
	assembler.mesh_basis_required.connect(_on_mesh_basis_required)
	assembler.apply_config(Char3DConfig.defaults())

	_setup_snapshot_viewport()
	_build_ui()
	_refresh_ui()

	_bridge = get_node_or_null("/root/CharForgeBridge")
	if _bridge != null:
		_bridge.config_received.connect(_on_bridge_config)
		_bridge.expression_received.connect(_on_bridge_expression)
		_bridge.openness_received.connect(_on_bridge_openness)
		_bridge.randomize_received.connect(_on_bridge_randomize)
		_bridge.ui_visible_received.connect(_on_bridge_ui_visible)
		_bridge.pack_received.connect(_on_bridge_pack)
		_bridge.import_received.connect(_on_bridge_import)
		_bridge.snapshot_provider = _snapshot


func _process(delta: float) -> void:
	if _auto_rotate and not _orbiting:
		_turntable.rotation.y = wrapf(_turntable.rotation.y + delta * 0.45, -TAU, TAU)
	if _snap_camera != null:
		_snap_camera.global_transform = _camera.global_transform
		_snap_camera.fov = _camera.fov


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		match mb.button_index:
			MOUSE_BUTTON_LEFT:
				_orbiting = mb.pressed
			MOUSE_BUTTON_WHEEL_UP:
				if mb.pressed:
					_cam_distance = clampf(_cam_distance - ZOOM_STEP, MIN_DISTANCE, MAX_DISTANCE)
					_camera.position.z = _cam_distance
			MOUSE_BUTTON_WHEEL_DOWN:
				if mb.pressed:
					_cam_distance = clampf(_cam_distance + ZOOM_STEP, MIN_DISTANCE, MAX_DISTANCE)
					_camera.position.z = _cam_distance
	elif event is InputEventMouseMotion and _orbiting:
		var mm := event as InputEventMouseMotion
		_gimbal.rotation_degrees.y -= mm.relative.x * ORBIT_SENSITIVITY
		_pitch.rotation_degrees.x = clampf(
				_pitch.rotation_degrees.x - mm.relative.y * ORBIT_SENSITIVITY, -55.0, 25.0)


# =============================================================================
# Stage / camera / snapshot
# =============================================================================

func _setup_stage() -> void:
	$KeyLight.rotation_degrees = Vector3(-42.0, -32.0, 0.0)
	$FillLight.position = Vector3(-1.8, 1.4, 2.2)
	$RimLight.position = Vector3(0.6, 2.0, -2.4)
	_gimbal.position = Vector3(0, 0.95, 0)
	_camera.position = Vector3(0, 0, _cam_distance)
	_pitch.rotation_degrees.x = -6.0


func _setup_snapshot_viewport() -> void:
	# A transparent SubViewport sharing the main World3D renders ONLY the 3D
	# stage (never the UI), so CharForge.snapshot returns clean alpha PNGs.
	_snap_viewport = SubViewport.new()
	_snap_viewport.name = "SnapshotViewport"
	_snap_viewport.size = Vector2i(SNAP_SIZE, SNAP_SIZE)
	_snap_viewport.transparent_bg = true
	_snap_viewport.own_world_3d = false
	_snap_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(_snap_viewport)
	_snap_camera = Camera3D.new()
	_snap_camera.name = "SnapshotCamera"
	_snap_viewport.add_child(_snap_camera)
	_snap_camera.current = true


func _snapshot(w: int, h: int) -> String:
	if _snap_viewport == null:
		return ""
	var img := _snap_viewport.get_texture().get_image()
	if img == null:
		return ""
	img.convert(Image.FORMAT_RGBA8)
	img.resize(clampi(w, 16, 2048), clampi(h, 16, 2048), Image.INTERPOLATE_LANCZOS)
	return Marshalls.raw_to_base64(img.save_png_to_buffer())


# =============================================================================
# Bridge handlers (host -> game)
# =============================================================================

func _on_bridge_config(json: String) -> void:
	var cfg: Variant = Char3DConfig.try_parse(json)
	if cfg is Dictionary:
		assembler.apply_config(cfg)
		_refresh_ui()


func _on_bridge_expression(label: String) -> void:
	assembler.set_expression(label)


func _on_bridge_openness(value: float) -> void:
	assembler.set_openness(value)
	if _ui.has("openness"):
		_syncing = true
		_ui.openness.value = value
		_syncing = false


func _on_bridge_randomize(seed_value: int) -> void:
	assembler.apply_config(CharRandomizer.randomize_config(seed_value))
	_refresh_ui()
	_emit_config_changed()


func _on_bridge_ui_visible(ui_visible: bool) -> void:
	_ui_layer.visible = ui_visible


func _on_bridge_pack(key: String) -> void:
	select_pack(key)
	if _bridge != null:
		_bridge.emit_pack_changed(JSON.stringify(mount.mount_report()))


func _on_bridge_import(bytes: PackedByteArray, file_name: String) -> void:
	var report := import_model(bytes, file_name)
	if _bridge != null:
		_bridge.emit_import_result(JSON.stringify(report))


# =============================================================================
# Pack mounting (the vendored CC0/CC-BY catalogue) + BYO import
# =============================================================================

## Mounts a catalogue entry by key ("" drops back to the procedural avatar).
##
## Selecting a model also moves the CONFIG onto it, because the basis registry
## is keyed by family/archetype: an "avatar" entry takes over its head family
## and body archetype, while a "body" entry (the kemono hybrid) takes only the
## archetype so the beast head the user picked survives on top of it.
func select_pack(key: String) -> void:
	_pack_key = key
	var cfg := _edited_config()
	if key.is_empty():
		assembler.registry = CharForgeRegistry.default_registry()
		mount.clear()
		assembler.apply_config(cfg)
		_refresh_ui()
		_emit_config_changed()
		return
	var entry := CharForgePacks.entry(key)
	if entry.is_empty():
		_pack_key = ""
		return
	assembler.registry = CharForgePacks.registry_for(key)
	if String(entry.get("mount", "")) == "body":
		cfg.body.archetype = String(entry.get("archetype", "humanoid"))
	else:
		cfg.head.family = String(entry.get("family", "humanoid"))
		cfg.body.archetype = String(entry.get("archetype", "humanoid"))
	assembler.apply_config(cfg)
	_refresh_ui()
	_emit_config_changed()


## Loads USER bytes as the avatar. The bytes are parsed in-process and are
## never written to disk or uploaded — the host page reads the file locally and
## hands them straight over the bridge.
func import_model(bytes: PackedByteArray, file_name: String) -> Dictionary:
	_pack_key = ""
	assembler.registry = CharForgeRegistry.default_registry()
	var report := mount.import_bytes(bytes, file_name)
	_refresh_ui()
	return report


func _on_mesh_basis_required(kind: String, entry: Dictionary) -> void:
	mount.mount(kind, entry)
	_refresh_pack_note()


func _emit_config_changed() -> void:
	if _bridge != null:
		_bridge.emit_config_changed(JSON.stringify(assembler.config))


# =============================================================================
# Built-in editor UI
# =============================================================================

func _build_ui() -> void:
	var root := Control.new()
	root.name = "UiRoot"
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_ui_layer.add_child(root)

	# --- top bar -------------------------------------------------------------
	var top := PanelContainer.new()
	top.set_anchors_preset(Control.PRESET_TOP_WIDE)
	root.add_child(top)
	var top_row := HBoxContainer.new()
	top_row.add_theme_constant_override("separation", 10)
	top.add_child(top_row)

	var title := Label.new()
	title.text = "  Character Forge"
	top_row.add_child(title)

	var name_edit := LineEdit.new()
	name_edit.placeholder_text = "Name"
	name_edit.custom_minimum_size = Vector2(180, 0)
	name_edit.max_length = Char3DConfig.MAX_NAME_LEN
	name_edit.text_changed.connect(_on_name_changed)
	top_row.add_child(name_edit)
	_ui["name"] = name_edit

	var randomize_btn := Button.new()
	randomize_btn.text = "Randomize"
	randomize_btn.pressed.connect(_on_randomize_pressed)
	top_row.add_child(randomize_btn)

	var spin := CheckButton.new()
	spin.text = "Spin"
	spin.button_pressed = true
	spin.toggled.connect(_on_spin_toggled)
	top_row.add_child(spin)

	# --- left panel ----------------------------------------------------------
	var left := PanelContainer.new()
	left.set_anchors_preset(Control.PRESET_LEFT_WIDE)
	left.offset_top = 44.0
	left.offset_bottom = -64.0
	left.custom_minimum_size = Vector2(280, 0)
	root.add_child(left)
	var scroll := ScrollContainer.new()
	left.add_child(scroll)
	var panel := VBoxContainer.new()
	panel.custom_minimum_size = Vector2(260, 0)
	panel.add_theme_constant_override("separation", 6)
	scroll.add_child(panel)

	# --- style packs (the vendored CC0/CC-BY catalogue) ----------------------
	# Lane == style tab: Anime / JRPG / Kemono-Furry / Monsters / Import. Empty
	# selection = the procedural avatar, which is the ONLY basis for most of the
	# 29 families and the deliberate primary for the kemono lane.
	panel.add_child(_section_label("Style pack"))
	var lane_pick := OptionButton.new()
	lane_pick.add_item("Procedural (no mesh)")
	lane_pick.set_item_metadata(0, "")
	for lane_row in CharForgePacks.lanes():
		lane_pick.add_item(String(lane_row.get("displayName", lane_row.get("id", "?"))))
		lane_pick.set_item_metadata(lane_pick.item_count - 1, String(lane_row.get("id", "")))
	lane_pick.item_selected.connect(_on_lane_selected)
	panel.add_child(lane_pick)
	_ui["lane"] = lane_pick

	var pack_pick := OptionButton.new()
	pack_pick.item_selected.connect(_on_pack_selected)
	panel.add_child(pack_pick)
	_ui["pack"] = pack_pick

	var pack_note := Label.new()
	pack_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	pack_note.add_theme_color_override("font_color", Color(0.62, 0.6, 0.72))
	panel.add_child(pack_note)
	_ui["pack_note"] = pack_note
	_refresh_pack_choices("")

	panel.add_child(_section_label("Family"))
	var family := OptionButton.new()
	for f in Char3DConfig.FAMILIES:
		family.add_item(f)
	family.item_selected.connect(_on_family_selected)
	panel.add_child(family)
	_ui["family"] = family

	panel.add_child(_section_label("Style"))
	var style := OptionButton.new()
	for s in Char3DConfig.STYLES:
		style.add_item(s)
	style.item_selected.connect(_on_style_selected)
	panel.add_child(style)
	_ui["style"] = style

	panel.add_child(_section_label("Snout length"))
	_ui["snout"] = _add_slider(panel, 0.0, 1.0, _on_number_changed.bind("snout"))
	panel.add_child(_section_label("Build"))
	_ui["build"] = _add_slider(panel, 0.0, 1.0, _on_number_changed.bind("build"))
	panel.add_child(_section_label("Height"))
	_ui["height"] = _add_slider(panel, 0.5, 1.5, _on_number_changed.bind("height"))

	panel.add_child(_section_label("Parts"))
	for slot in Char3DConfig.PART_SLOTS:
		var row := HBoxContainer.new()
		var slot_label := Label.new()
		slot_label.text = slot
		slot_label.custom_minimum_size = Vector2(72, 0)
		row.add_child(slot_label)
		var prev := Button.new()
		prev.text = "<"
		prev.pressed.connect(_on_part_cycle.bind(slot, -1))
		row.add_child(prev)
		var value_label := Label.new()
		value_label.text = "-"
		value_label.clip_text = true
		value_label.custom_minimum_size = Vector2(120, 0)
		value_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(value_label)
		var next := Button.new()
		next.text = ">"
		next.pressed.connect(_on_part_cycle.bind(slot, 1))
		row.add_child(next)
		panel.add_child(row)
		_ui["part_" + slot] = value_label

	panel.add_child(_section_label("Colors"))
	# The 7 canonical palette regions plus the 4 extended kemono coat blocks.
	# An extended region that a config never set shows its DERIVED colour
	# (CharForgePalette) until the operator picks one explicitly.
	for region in Char3DConfig.ALL_MATERIAL_REGIONS:
		var crow := HBoxContainer.new()
		var region_label := Label.new()
		region_label.text = region
		region_label.custom_minimum_size = Vector2(92, 0)
		if region in Char3DConfig.EXTENDED_MATERIAL_REGIONS:
			region_label.tooltip_text = "extended coat block — derived from %s when unset" \
					% CharForgePalette.DERIVED_FROM.get(region, "-")
			region_label.add_theme_color_override("font_color", Color(0.6, 0.66, 0.78))
		crow.add_child(region_label)
		var picker := ColorPickerButton.new()
		picker.custom_minimum_size = Vector2(64, 24)
		picker.color_changed.connect(_on_color_changed.bind(region))
		crow.add_child(picker)
		panel.add_child(crow)
		_ui["color_" + region] = picker

	panel.add_child(_section_label("Quality"))
	var outline := CheckButton.new()
	outline.text = "Outlines"
	outline.tooltip_text = "Inverted-hull outline pass. OFF by default: it doubles " \
			+ "vertex work and draw calls, which the Quest browser cannot afford."
	outline.button_pressed = CharForgeMaterials.outline_enabled
	outline.toggled.connect(_on_outline_toggled)
	panel.add_child(outline)
	_ui["outline"] = outline

	var proportion_label := Label.new()
	proportion_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	proportion_label.add_theme_color_override("font_color", Color(0.62, 0.6, 0.72))
	panel.add_child(proportion_label)
	_ui["proportions"] = proportion_label

	# --- bottom bar: expressions + openness ---------------------------------
	var bottom := PanelContainer.new()
	bottom.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	root.add_child(bottom)
	var bottom_row := HBoxContainer.new()
	bottom_row.add_theme_constant_override("separation", 4)
	bottom.add_child(bottom_row)
	for label in Char3DConfig.EXPRESSIONS:
		var btn := Button.new()
		btn.text = label
		btn.pressed.connect(_on_expression_pressed.bind(label))
		bottom_row.add_child(btn)
	var mouth_label := Label.new()
	mouth_label.text = "  mouth"
	bottom_row.add_child(mouth_label)
	var openness := HSlider.new()
	openness.min_value = 0.0
	openness.max_value = 1.0
	openness.step = 0.01
	openness.custom_minimum_size = Vector2(140, 0)
	openness.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	openness.value_changed.connect(_on_openness_changed)
	bottom_row.add_child(openness)
	_ui["openness"] = openness


func _section_label(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", Color(0.72, 0.68, 0.9))
	return l


func _add_slider(parent: Control, lo: float, hi: float, handler: Callable) -> HSlider:
	var s := HSlider.new()
	s.min_value = lo
	s.max_value = hi
	s.step = 0.01
	s.value_changed.connect(handler)
	parent.add_child(s)
	return s


## Pushes the current assembler config into every UI control (no feedback).
func _refresh_ui() -> void:
	if _ui.is_empty():
		return
	_syncing = true
	var cfg: Dictionary = assembler.config
	_ui.name.text = cfg.name
	_ui.family.select(Char3DConfig.FAMILIES.find(cfg.head.family))
	_ui.style.select(Char3DConfig.STYLES.find(cfg.style))
	_ui.snout.value = cfg.head.snoutLength
	_ui.build.value = cfg.body.build
	_ui.height.value = cfg.body.height
	for slot in Char3DConfig.PART_SLOTS:
		var part: Variant = cfg.parts.get(slot)
		_ui["part_" + slot].text = "-" if part == null else String(part)
	for region in Char3DConfig.ALL_MATERIAL_REGIONS:
		# CharForgePalette (not Char3DConfig) so the extended blocks show the
		# derived colour rather than a flat default.
		_ui["color_" + region].color = CharForgePalette.region_color(cfg, region)
	if _ui.has("proportions"):
		var row: Dictionary = assembler.proportions
		_ui.proportions.text = "preset %s — %.1f heads%s" % [
			row.get("preset", "legacy"), float(row.get("headsTall", 0.0)),
			", digitigrade" if bool(row.get("digitigrade", false)) else ""]
	_syncing = false
	_refresh_pack_note()


## Copies the current config for mutation; _commit applies + emits.
func _edited_config() -> Dictionary:
	return assembler.config.duplicate(true)


func _commit(cfg: Dictionary) -> void:
	assembler.apply_config(cfg)
	_emit_config_changed()


func _on_name_changed(text: String) -> void:
	if _syncing:
		return
	# Name doesn't affect geometry (except hash-seeded slime drips) — update
	# in place and emit, skipping the rebuild for responsiveness.
	assembler.config.name = text.substr(0, Char3DConfig.MAX_NAME_LEN)
	_emit_config_changed()


## Fills the model picker with one lane's entries ("" = none).
func _refresh_pack_choices(lane_id: String) -> void:
	if not _ui.has("pack"):
		return
	var pack_pick: OptionButton = _ui.pack
	pack_pick.clear()
	pack_pick.add_item("— none —")
	pack_pick.set_item_metadata(0, "")
	if lane_id.is_empty():
		pack_pick.disabled = true
		_refresh_pack_note()
		return
	pack_pick.disabled = false
	for e in CharForgePacks.lane_entries(lane_id):
		var label := String(e.get("displayName", e.get("key", "?")))
		if not bool(e.get("recolorable", false)):
			label += "  (fixed colours)"
		pack_pick.add_item(label)
		var idx := pack_pick.item_count - 1
		pack_pick.set_item_metadata(idx, String(e.get("key", "")))
		pack_pick.set_item_tooltip(idx, "%s · %s · %d tris / %d joints\n%s" % [
			e.get("licenseSpdx", "?"), e.get("attribution", "?"),
			int(e.get("tris", 0)), int(e.get("joints", 0)), e.get("notes", "")])
	_refresh_pack_note()


## The honest capability note under the picker: what mounted, whether it can be
## recoloured, which lip-sync channel it ended up on, and — for CC-BY — the
## attribution the licence requires to be VISIBLE, not merely in a manifest.
func _refresh_pack_note() -> void:
	if not _ui.has("pack_note"):
		return
	if mount == null or _pack_key.is_empty():
		var lane_row := CharForgePacks.lane(_selected_lane())
		if lane_row.is_empty():
			_ui.pack_note.text = "Procedural avatar — %d catalogue models available." \
					% CharForgePacks.entries().size()
		else:
			_ui.pack_note.text = String(lane_row.get("summary", ""))
		return
	var report: Dictionary = mount.mount_report()
	var bits: Array = []
	bits.append("recolour: " + ("yes" if report.recolorable else "NO (baked atlas)"))
	var channels: Array = report.lipSyncChannels
	bits.append("lip-sync: " + (", ".join(PackedStringArray(channels)) if not channels.is_empty() else "none"))
	if int(report.meshesHidden) > 0:
		bits.append("%d props hidden" % int(report.meshesHidden))
	var text := "%s — %s\n%s · %s" % [report.displayName, ", ".join(PackedStringArray(bits)),
			report.licenseSpdx, report.attribution]
	if not String(report.error).is_empty():
		text += "\n! " + String(report.error)
	_ui.pack_note.text = text


func _selected_lane() -> String:
	if not _ui.has("lane"):
		return ""
	var lane_pick: OptionButton = _ui.lane
	var meta: Variant = lane_pick.get_item_metadata(lane_pick.selected)
	return "" if meta == null else String(meta)


func _on_lane_selected(_index: int) -> void:
	if _syncing:
		return
	_refresh_pack_choices(_selected_lane())
	select_pack("")


func _on_pack_selected(index: int) -> void:
	if _syncing:
		return
	var meta: Variant = _ui.pack.get_item_metadata(index)
	select_pack("" if meta == null else String(meta))
	_refresh_pack_note()


func _on_family_selected(index: int) -> void:
	if _syncing:
		return
	var family: String = Char3DConfig.FAMILIES[index]
	var entry := CharForgePacks.entry(_pack_key)
	var mount_kind := String(entry.get("mount", ""))
	if mount_kind == "avatar" and String(entry.get("family", "")) != family:
		# A whole-avatar model IS its family — you cannot ask the chibi cat to be
		# a dragon. Changing the family therefore drops back to procedural
		# rather than leaving a mesh that no longer matches the config.
		_pack_key = ""
		assembler.registry = CharForgeRegistry.default_registry()
		mount.clear()
		if _ui.has("pack"):
			_syncing = true
			_ui.pack.select(0)
			_syncing = false
		mount_kind = ""
	var cfg := _edited_config()
	cfg.head.family = family
	# A mesh BODY keeps its own archetype (that is the whole point of the
	# hybrid: CC0 humanoid body, procedural beast head), so only a procedural or
	# whole-avatar selection moves the archetype with the family.
	if mount_kind != "body":
		cfg.body.archetype = family
	_commit(cfg)
	_refresh_ui()


func _on_style_selected(index: int) -> void:
	if _syncing:
		return
	var cfg := _edited_config()
	cfg.style = Char3DConfig.STYLES[index]
	_commit(cfg)


func _on_number_changed(value: float, key: String) -> void:
	if _syncing:
		return
	var cfg := _edited_config()
	match key:
		"snout":
			cfg.head.snoutLength = value
		"build":
			cfg.body.build = value
		"height":
			cfg.body.height = value
	_commit(cfg)


func _on_part_cycle(slot: String, direction: int) -> void:
	if _syncing:
		return
	var choices: Array = UI_PART_CHOICES.get(slot, [null])
	var current: Variant = assembler.config.parts.get(slot)
	var idx := choices.find(current)
	idx = wrapi(idx + direction, 0, choices.size())
	var cfg := _edited_config()
	cfg.parts[slot] = choices[idx]
	_commit(cfg)
	_refresh_ui()


func _on_color_changed(color: Color, region: String) -> void:
	if _syncing:
		return
	# Recolour is a 64-pixel palette rewrite, not a rebuild: no geometry is
	# rebuilt and no material is reassigned (technique.md's whole point).
	if assembler.recolor({region: "#" + color.to_html(false)}):
		_emit_config_changed()
		return
	var cfg := _edited_config()
	cfg.materials[region] = "#" + color.to_html(false)
	_commit(cfg)


func _on_outline_toggled(pressed: bool) -> void:
	if _syncing:
		return
	assembler.set_outline_enabled(pressed)


func _on_expression_pressed(label: String) -> void:
	assembler.set_expression(label)


func _on_openness_changed(value: float) -> void:
	if _syncing:
		return
	assembler.set_openness(value)


func _on_randomize_pressed() -> void:
	var seed_value := int(Time.get_ticks_msec()) ^ randi()
	assembler.apply_config(CharRandomizer.randomize_config(seed_value))
	_refresh_ui()
	_emit_config_changed()


func _on_spin_toggled(pressed: bool) -> void:
	_auto_rotate = pressed
