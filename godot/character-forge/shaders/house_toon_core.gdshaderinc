// =============================================================================
// House toon CORE — the shared body of the one stylized surface shader for
// Character Forge avatars (technique.md verdict), written for the
// Compatibility renderer (WebGL2 / single-threaded WASM / Quest 3 browser).
//
// Included by BOTH house_toon.gdshader (opaque, the default for every avatar
// surface) and house_toon_trans.gdshader (alpha-blended, used only by the
// handful of see-through pieces: slime bodies, insect wings, blush discs).
// The two shaders exist as separate files ONLY because a Godot spatial shader
// that writes ALPHA is transparent for every material using it — factoring the
// body here keeps the two variants from drifting apart.
//
// * Diffuse: custom light() half-Lambert ramp quantized into 2-3 bands
//   (band_cuts 1 = classic 2-tone, 2 = 3-tone). COMPATIBILITY DISCIPLINE:
//   DIFFUSE_LIGHT must NEVER go negative there (vec3(-x) clamps to black and
//   breaks darkening tricks) — every factor below is clamped >= 0 and only
//   ADDED, never subtracted.
// * Albedo: the per-avatar 8x8 palette-strip texture (CharForgePalette).
//   Imported GLBs sample it by their remapped UVs; procedural primitives
//   ignore mesh UV by setting `palette_cell` to a cell centre (per-material
//   uniform — per-INSTANCE uniforms are unsupported in Compatibility, which
//   is why recolor rides in the shared palette texture instead).
// * Rim: pure-fragment fresnel added to EMISSION (renderer-safe, no light()
//   dependency).
// * Optional matcap specular: view-space-normal lookup for the FF-stylized
//   sheen at zero light cost; off (black texture / strength 0) by default.
//
// The inverted-hull outline lives in outline_hull.gdshader as a next_pass
// material behind a quality toggle (default OFF) — never here.
// =============================================================================

// Nearest + no-repeat AT THE SAMPLER so palette cells never bleed, regardless
// of texture import settings (the palette is a runtime ImageTexture anyway).
uniform sampler2D palette_tex : source_color, filter_nearest, repeat_disable, hint_default_white;
// (-1,-1) = sample by mesh UV (palette-mapped GLBs); a cell centre from
// CharForgePalette.region_uv() = fixed-cell mode (procedural primitives).
uniform vec2 palette_cell = vec2(-1.0, -1.0);
uniform vec4 albedo_tint : source_color = vec4(1.0, 1.0, 1.0, 1.0);

// Ramp: number of band boundaries in the half-Lambert ramp. 1 => 2 bands,
// 2 => 3 bands (the supported stylistic range; toon=1, anime=2).
uniform float band_cuts : hint_range(1.0, 3.0, 1.0) = 1.0;
uniform float band_softness : hint_range(0.001, 0.5) = 0.04;
// Darkest tone of the unlit band (multiplier on albedo — a LIT floor, never
// a negative subtraction).
uniform float shadow_tone : hint_range(0.0, 1.0) = 0.55;

uniform vec4 rim_color : source_color = vec4(1.0, 1.0, 1.0, 1.0);
uniform float rim_strength : hint_range(0.0, 2.0) = 0.35;
uniform float rim_power : hint_range(0.5, 8.0) = 3.0;

// Optional matcap specular (FF-stylized sheen); black default = off.
uniform sampler2D matcap_tex : source_color, hint_default_black;
uniform float matcap_strength : hint_range(0.0, 2.0) = 0.0;

// Iris-glow / synth-core style emissive boost of the albedo itself.
uniform float emission_boost : hint_range(0.0, 4.0) = 0.0;

#ifdef HOUSE_TOON_TRANSPARENT
uniform float alpha_mul : hint_range(0.0, 1.0) = 1.0;
#endif


void fragment() {
	vec2 uv = (palette_cell.x >= 0.0) ? palette_cell : UV;
	vec4 albedo = texture(palette_tex, uv) * albedo_tint;
	ALBEDO = albedo.rgb;
#ifdef HOUSE_TOON_TRANSPARENT
	ALPHA = clamp(albedo.a * alpha_mul, 0.0, 1.0);
#endif

	vec3 n = normalize(NORMAL);
	// Fresnel rim (view-space N and V — both fragment built-ins are view-space).
	float fresnel = pow(clamp(1.0 - dot(n, normalize(VIEW)), 0.0, 1.0), rim_power);
	// Matcap: view-space normal xy -> hemisphere lookup (0.497 guards the seam).
	vec2 matcap_uv = clamp(n.xy * 0.497 + 0.5, 0.0, 1.0);
	vec3 matcap = texture(matcap_tex, matcap_uv).rgb;

	EMISSION = rim_color.rgb * (fresnel * rim_strength)
			+ matcap * matcap_strength
			+ ALBEDO * emission_boost;
}


void light() {
	// Half-Lambert: wrap N.L into [0,1] so the dark side keeps shape.
	float half_lambert = clamp(dot(NORMAL, LIGHT) * 0.5 + 0.5, 0.0, 1.0);
	float cuts = max(band_cuts, 1.0);
	float x = half_lambert * (cuts + 1.0);
	float band = floor(x);
	float frac = x - band;
	float soft = clamp(band_softness, 0.001, 0.5);
	// Quantize with a smoothstepped edge per band boundary (anti-alias).
	float level = clamp((band + smoothstep(0.5 - soft, 0.5 + soft, frac)) / (cuts + 1.0), 0.0, 1.0);
	float shade = mix(shadow_tone, 1.0, level);
	// All factors clamped non-negative: DIFFUSE_LIGHT can only ever grow.
	DIFFUSE_LIGHT += max(shade, 0.0) * clamp(ATTENUATION, 0.0, 1.0) * LIGHT_COLOR * ALBEDO / PI;
}
