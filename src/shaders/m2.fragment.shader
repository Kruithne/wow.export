#version 300 es
precision highp float;
precision highp int;

// inputs from vertex shader
in vec2 v_texcoord;
in vec2 v_texcoord2;
in vec2 v_texcoord3;
in vec3 v_normal;
in vec3 v_position_view;
in float v_edge_fade;

// textures
uniform sampler2D u_texture1;
uniform sampler2D u_texture2;
uniform sampler2D u_texture3;
uniform sampler2D u_texture4;

// material parameters
uniform int u_pixel_shader;
uniform int u_blend_mode;
uniform vec4 u_mesh_color;        // vertex color + alpha
uniform vec3 u_tex_sample_alpha;  // texture weight values
uniform float u_alpha_test;       // alpha test threshold (0.502 for mode 1)

// lighting (simplified for preview)
uniform vec3 u_ambient_color;
uniform vec3 u_diffuse_color;
uniform vec3 u_light_dir;
uniform int u_apply_lighting;

// wireframe mode
uniform int u_wireframe;
uniform vec4 u_wireframe_color;

// output
out vec4 frag_color;

// calculate diffuse lighting
vec3 calc_lighting(vec3 color, vec3 normal) {
	if (u_apply_lighting == 0)
		return color;

	vec3 n = normalize(normal);
	float n_dot_l = max(dot(n, normalize(-u_light_dir)), 0.0);

	vec3 ambient = u_ambient_color * color;
	vec3 diffuse = u_diffuse_color * color * n_dot_l;

	return ambient + diffuse;
}

void main() {
	if (u_wireframe != 0) {
		frag_color = u_wireframe_color;
		return;
	}

	// use correct UV coordinates based on shader mode
	vec2 uv1 = v_texcoord;
	vec2 uv2 = v_texcoord2;
	vec2 uv3 = v_texcoord3;

	// special case: shaders 26, 27, 28 use uv1 for all texture samples
	if (u_pixel_shader == 26 || u_pixel_shader == 27 || u_pixel_shader == 28) {
		uv2 = uv1;
		uv3 = uv1;
	}

	vec4 tex1 = texture(u_texture1, uv1);
	vec4 tex2 = texture(u_texture2, uv2);
	vec4 tex3 = texture(u_texture3, uv3);
	vec4 tex4 = texture(u_texture4, v_texcoord2);

	vec3 mesh_color = u_mesh_color.rgb;
	float mesh_opacity = u_mesh_color.a * v_edge_fade;

	vec3 mat_diffuse = vec3(0.0);
	vec3 specular = vec3(0.0);
	float discard_alpha = 1.0;
	bool can_discard = false;

	// Blizzard M2 combiner shaders, reference: https://wowdev.wiki/M2#Shaders
	switch (u_pixel_shader) {
		case 0: // Combiners_Opaque
			mat_diffuse = mesh_color * tex1.rgb;
			break;

		case 1: // Combiners_Mod
			mat_diffuse = mesh_color * tex1.rgb;
			discard_alpha = tex1.a;
			can_discard = true;
			break;

		case 2: // Combiners_Opaque_Mod
			mat_diffuse = mesh_color * tex1.rgb * tex2.rgb;
			discard_alpha = tex2.a;
			can_discard = true;
			break;

		case 3: // Combiners_Opaque_Mod2x
			mat_diffuse = mesh_color * tex1.rgb * tex2.rgb * 2.0;
			discard_alpha = tex2.a * 2.0;
			can_discard = true;
			break;

		case 4: // Combiners_Opaque_Mod2xNA
			mat_diffuse = mesh_color * tex1.rgb * tex2.rgb * 2.0;
			break;

		case 5: // Combiners_Opaque_Opaque
			mat_diffuse = mesh_color * tex1.rgb * tex2.rgb;
			break;

		case 6: // Combiners_Mod_Mod
			mat_diffuse = mesh_color * tex1.rgb * tex2.rgb;
			discard_alpha = tex1.a * tex2.a;
			can_discard = true;
			break;

		case 7: // Combiners_Mod_Mod2x
			mat_diffuse = mesh_color * tex1.rgb * tex2.rgb * 2.0;
			discard_alpha = tex1.a * tex2.a * 2.0;
			can_discard = true;
			break;

		case 8: // Combiners_Mod_Add
			mat_diffuse = mesh_color * tex1.rgb;
			discard_alpha = tex1.a + tex2.a;
			can_discard = true;
			specular = tex2.rgb;
			break;

		case 9: // Combiners_Mod_Mod2xNA
			mat_diffuse = mesh_color * tex1.rgb * tex2.rgb * 2.0;
			discard_alpha = tex1.a;
			can_discard = true;
			break;

		case 10: // Combiners_Mod_AddNA
			mat_diffuse = mesh_color * tex1.rgb;
			discard_alpha = tex1.a;
			can_discard = true;
			specular = tex2.rgb;
			break;

		case 11: // Combiners_Mod_Opaque
			mat_diffuse = mesh_color * tex1.rgb * tex2.rgb;
			discard_alpha = tex1.a;
			can_discard = true;
			break;

		case 12: // Combiners_Opaque_Mod2xNA_Alpha
			mat_diffuse = mesh_color * mix(tex1.rgb * tex2.rgb * 2.0, tex1.rgb, vec3(tex1.a));
			break;

		case 13: // Combiners_Opaque_AddAlpha
			mat_diffuse = mesh_color * tex1.rgb;
			specular = tex2.rgb * tex2.a;
			break;

		case 14: // Combiners_Opaque_AddAlpha_Alpha
			mat_diffuse = mesh_color * tex1.rgb;
			specular = tex2.rgb * tex2.a * (1.0 - tex1.a);
			break;

		case 15: // Combiners_Opaque_Mod2xNA_Alpha_Add
			mat_diffuse = mesh_color * mix(tex1.rgb * tex2.rgb * 2.0, tex1.rgb, vec3(tex1.a));
			specular = tex3.rgb * tex3.a * u_tex_sample_alpha.b;
			break;

		case 16: // Combiners_Mod_AddAlpha
			mat_diffuse = mesh_color * tex1.rgb;
			discard_alpha = tex1.a;
			can_discard = true;
			specular = tex2.rgb * tex2.a;
			break;

		case 17: // Combiners_Mod_AddAlpha_Alpha
			mat_diffuse = mesh_color * tex1.rgb;
			discard_alpha = tex1.a + tex2.a * (0.3 * tex2.r + 0.59 * tex2.g + 0.11 * tex2.b);
			can_discard = true;
			specular = tex2.rgb * tex2.a * (1.0 - tex1.a);
			break;

		case 18: // Combiners_Opaque_Alpha_Alpha
			mat_diffuse = mesh_color * mix(mix(tex1.rgb, tex2.rgb, vec3(tex2.a)), tex1.rgb, vec3(tex1.a));
			break;

		case 19: // Combiners_Opaque_Mod2xNA_Alpha_3s
			mat_diffuse = mesh_color * mix(tex1.rgb * tex2.rgb * 2.0, tex3.rgb, vec3(tex3.a));
			break;

		case 20: // Combiners_Opaque_AddAlpha_Wgt
			mat_diffuse = mesh_color * tex1.rgb;
			specular = tex2.rgb * tex2.a * u_tex_sample_alpha.g;
			break;

		case 21: // Combiners_Mod_Add_Alpha
			mat_diffuse = mesh_color * tex1.rgb;
			discard_alpha = tex1.a + tex2.a;
			can_discard = true;
			specular = tex2.rgb * (1.0 - tex1.a);
			break;

		case 22: // Combiners_Opaque_ModNA_Alpha
			mat_diffuse = mesh_color * mix(tex1.rgb * tex2.rgb, tex1.rgb, vec3(tex1.a));
			break;

		case 23: // Combiners_Mod_AddAlpha_Wgt
			mat_diffuse = mesh_color * tex1.rgb;
			discard_alpha = tex1.a;
			can_discard = true;
			specular = tex2.rgb * tex2.a * u_tex_sample_alpha.g;
			break;

		case 24: // Combiners_Opaque_Mod_Add_Wgt
			mat_diffuse = mesh_color * mix(tex1.rgb, tex2.rgb, vec3(tex2.a));
			specular = tex1.rgb * tex1.a * u_tex_sample_alpha.r;
			break;

		case 25: // Combiners_Opaque_Mod2xNA_Alpha_UnshAlpha
			{
				float glow_opacity = clamp(tex3.a * u_tex_sample_alpha.b, 0.0, 1.0);
				mat_diffuse = mesh_color * mix(tex1.rgb * tex2.rgb * 2.0, tex1.rgb, vec3(tex1.a)) * (1.0 - glow_opacity);
				specular = tex3.rgb * glow_opacity;
			}
			break;

		case 26: // Combiners_Mod_Dual_Crossfade
			{
				vec4 mixed = mix(mix(tex1, tex2, vec4(clamp(u_tex_sample_alpha.g, 0.0, 1.0))), tex3, vec4(clamp(u_tex_sample_alpha.b, 0.0, 1.0)));
				mat_diffuse = mesh_color * mixed.rgb;
				discard_alpha = mixed.a;
				can_discard = true;
			}
			break;

		case 27: // Combiners_Opaque_Mod2xNA_Alpha_Alpha
			mat_diffuse = mesh_color * mix(mix(tex1.rgb * tex2.rgb * 2.0, tex3.rgb, vec3(tex3.a)), tex1.rgb, vec3(tex1.a));
			break;

		case 28: // Combiners_Mod_Masked_Dual_Crossfade
			{
				vec4 mixed = mix(mix(tex1, tex2, vec4(clamp(u_tex_sample_alpha.g, 0.0, 1.0))), tex3, vec4(clamp(u_tex_sample_alpha.b, 0.0, 1.0)));
				mat_diffuse = mesh_color * mixed.rgb;
				discard_alpha = mixed.a * tex4.a;
				can_discard = true;
			}
			break;

		case 29: // Combiners_Opaque_Alpha
			mat_diffuse = mesh_color * mix(tex1.rgb, tex2.rgb, vec3(tex2.a));
			break;

		case 30: // Guild
			{
				vec3 generic0 = vec3(1.0);
				vec3 generic1 = vec3(1.0);
				vec3 generic2 = vec3(1.0);
				mat_diffuse = mesh_color * mix(tex1.rgb * mix(generic0, tex2.rgb * generic1, vec3(tex2.a)), tex3.rgb * generic2, vec3(tex3.a));
				discard_alpha = tex1.a;
				can_discard = true;
			}
			break;

		case 31: // Guild_NoBorder
			{
				vec3 generic0 = vec3(1.0);
				vec3 generic1 = vec3(1.0);
				mat_diffuse = mesh_color * tex1.rgb * mix(generic0, tex2.rgb * generic1, vec3(tex2.a));
				discard_alpha = tex1.a;
				can_discard = true;
			}
			break;

		case 32: // Guild_Opaque
			{
				vec3 generic0 = vec3(1.0);
				vec3 generic1 = vec3(1.0);
				vec3 generic2 = vec3(1.0);
				mat_diffuse = mesh_color * mix(tex1.rgb * mix(generic0, tex2.rgb * generic1, vec3(tex2.a)), tex3.rgb * generic2, vec3(tex3.a));
			}
			break;

		case 33: // Combiners_Mod_Depth
			mat_diffuse = mesh_color * tex1.rgb;
			discard_alpha = tex1.a;
			can_discard = true;
			break;

		case 34: // Illum
			discard_alpha = tex1.a;
			can_discard = true;
			break;

		case 35: // Combiners_Mod_Mod_Mod_Const
			{
				vec4 generic0 = vec4(1.0);
				vec4 combined = tex1 * tex2 * tex3 * generic0;
				mat_diffuse = mesh_color * combined.rgb;
				discard_alpha = combined.a;
				can_discard = true;
			}
			break;

		case 36: // Combiners_Mod_Mod_Depth
			mat_diffuse = mesh_color * tex1.rgb * tex2.rgb;
			discard_alpha = tex1.a * tex2.a;
			can_discard = true;
			break;

		default:
			mat_diffuse = mesh_color * tex1.rgb;
			break;
	}

	// calculate final opacity based on blend mode
	float final_opacity;
	bool do_discard = false;

	if (u_blend_mode == 13) {
		// constant alpha blend
		final_opacity = discard_alpha * mesh_opacity;
	} else if (u_blend_mode == 1) {
		// alpha key - hard cutoff
		final_opacity = mesh_opacity;
		if (can_discard && discard_alpha < u_alpha_test)
			do_discard = true;
	} else if (u_blend_mode == 0) {
		// opaque
		final_opacity = mesh_opacity;
	} else if (u_blend_mode == 5 || u_blend_mode == 6) {
		// MOD and MOD2X blend modes: discard low alpha pixels to prevent holdout
		// these modes multiply destination by source, so low alpha = black = destroys destination
		final_opacity = discard_alpha * mesh_opacity;
		if (can_discard && discard_alpha < u_alpha_test)
			do_discard = true;
	} else {
		// other blend modes
		final_opacity = discard_alpha * mesh_opacity;
	}

	if (do_discard)
		discard;

	// apply lighting
	vec3 lit_color = calc_lighting(mat_diffuse, v_normal);

	// add specular (disabled for debugging)
	// lit_color += specular;

	frag_color = vec4(lit_color, final_opacity);
}
