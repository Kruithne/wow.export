#version 300 es
precision highp float;
precision highp int;

// inputs from vertex shader
in vec2 v_texcoord;
in vec2 v_texcoord2;
in vec2 v_texcoord3;
in vec2 v_texcoord4;
in vec3 v_normal;
in vec3 v_position_view;
in vec4 v_color;
in vec4 v_color2;
in vec4 v_color3;

// textures
uniform sampler2D u_texture1;
uniform sampler2D u_texture2;
uniform sampler2D u_texture3;
uniform sampler2D u_texture4;
uniform sampler2D u_texture5;
uniform sampler2D u_texture6;
uniform sampler2D u_texture7;
uniform sampler2D u_texture8;
uniform sampler2D u_texture9;

// material parameters
uniform int u_pixel_shader;
uniform int u_blend_mode;
uniform int u_use_vertex_color;

// lighting
uniform vec3 u_ambient_color;
uniform vec3 u_diffuse_color;
uniform vec3 u_light_dir;
uniform int u_apply_lighting;

// wireframe
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

	vec4 tex1 = texture(u_texture1, v_texcoord);
	vec4 tex2 = texture(u_texture2, v_texcoord);

	vec3 mat_diffuse;
	vec3 emissive = vec3(0.0);

	// WMO pixel shader modes
	// https://github.com/Deamon87/WebWowViewerCpp/blob/master/wowViewerLib/shaders/glsl/common/commonWMOMaterial.glsl
	switch (u_pixel_shader) {
		case 0: // MapObjDiffuse
			mat_diffuse = tex1.rgb;
			break;

		case 1: // MapObjSpecular
			mat_diffuse = tex1.rgb;
			break;

		case 2: // MapObjMetal
			mat_diffuse = tex1.rgb;
			break;

		case 3: // MapObjEnv
			mat_diffuse = tex1.rgb;
			emissive = tex2.rgb * tex1.a;
			break;

		case 4: // MapObjOpaque
			mat_diffuse = tex1.rgb;
			break;

		case 5: // MapObjEnvMetal
			mat_diffuse = tex1.rgb;
			emissive = (tex1.rgb * tex1.a) * tex2.rgb;
			break;

		case 6: { // MapObjTwoLayerDiffuse
			vec3 layer1_6 = tex1.rgb;
			vec3 layer2_6 = mix(layer1_6, tex2.rgb, tex2.a);
			mat_diffuse = mix(layer2_6, layer1_6, v_color2.a);
			break;
		}

		case 7: { // MapObjTwoLayerEnvMetal
			vec4 tex3_7 = texture(u_texture3, v_texcoord3);
			vec4 color_mix = mix(tex1, tex2, 1.0 - v_color2.a);
			mat_diffuse = color_mix.rgb;
			emissive = (color_mix.rgb * color_mix.a) * tex3_7.rgb;
			break;
		}

		case 8: // MapObjTwoLayerTerrain
			mat_diffuse = mix(tex2.rgb, tex1.rgb, v_color2.a);
			break;

		case 9: // MapObjDiffuseEmissive
			mat_diffuse = tex1.rgb;
			emissive = tex2.rgb * tex2.a * v_color2.a;
			break;

		case 10: { // MapObjMaskedEnvMetal
			vec4 tex3_10 = texture(u_texture3, v_texcoord3);
			float mix_factor = clamp(tex3_10.a * v_color2.a, 0.0, 1.0);
			mat_diffuse = mix(mix((tex1.rgb * tex2.rgb) * 2.0, tex3_10.rgb, mix_factor), tex1.rgb, tex1.a);
			break;
		}

		case 11: { // MapObjEnvMetalEmissive
			vec4 tex3_11 = texture(u_texture3, v_texcoord3);
			mat_diffuse = tex1.rgb;
			emissive = ((tex1.rgb * tex1.a) * tex2.rgb) + ((tex3_11.rgb * tex3_11.a) * v_color2.a);
			break;
		}

		case 12: // MapObjTwoLayerDiffuseOpaque
			mat_diffuse = mix(tex2.rgb, tex1.rgb, v_color2.a);
			break;

		case 13: // MapObjTwoLayerDiffuseEmissive
			vec3 t1_diffuse = tex2.rgb * (1.0 - tex2.a);
			mat_diffuse = mix(t1_diffuse, tex1.rgb, v_color2.a);
			emissive = (tex2.rgb * tex2.a) * (1.0 - v_color2.a);
			break;

		case 14: { // MapObjAdditiveMaskedEnvMetal
			vec4 tex3_14 = texture(u_texture3, v_texcoord3);
			mat_diffuse = mix(
				(tex1.rgb * tex2.rgb * 2.0) + (tex3_14.rgb * clamp(tex3_14.a * v_color2.a, 0.0, 1.0)),
				tex1.rgb,
				tex1.a
			);
			break;
		}

		case 15: { // MapObjTwoLayerDiffuseMod2x
			vec4 tex3_15 = texture(u_texture3, v_texcoord3);
			vec3 layer1_15 = tex1.rgb;
			vec3 layer2_15 = mix(layer1_15, tex2.rgb, tex2.a);
			vec3 layer3_15 = mix(layer2_15, layer1_15, v_color2.a);
			mat_diffuse = layer3_15 * tex3_15.rgb * 2.0;
			break;
		}

		case 16: // MapObjTwoLayerDiffuseMod2xNA
			vec3 layer1_16 = (tex1.rgb * tex2.rgb) * 2.0;
			mat_diffuse = mix(tex1.rgb, layer1_16, v_color2.a);
			break;

		case 17: { // MapObjTwoLayerDiffuseAlpha
			vec4 tex3_17 = texture(u_texture3, v_texcoord3);
			vec3 layer1_17 = tex1.rgb;
			vec3 layer2_17 = mix(layer1_17, tex2.rgb, tex2.a);
			vec3 layer3_17 = mix(layer2_17, layer1_17, tex3_17.a);
			mat_diffuse = (layer3_17 * tex3_17.rgb) * 2.0;
			break;
		}

		case 18: // MapObjLod
			mat_diffuse = tex1.rgb;
			break;

		case 19: // MapObjParallax (simplified)
			mat_diffuse = tex1.rgb;
			break;

		case 20: { // MapObjUnkShader
			vec4 tex2_20 = texture(u_texture2, v_texcoord);
			vec4 tex3_20 = texture(u_texture3, v_texcoord2);
			vec4 tex4_20 = texture(u_texture4, v_texcoord3);
			vec4 tex5_20 = texture(u_texture5, v_texcoord4);
			vec4 tex6_20 = texture(u_texture6, v_texcoord);
			vec4 tex7_20 = texture(u_texture7, v_texcoord2);
			vec4 tex8_20 = texture(u_texture8, v_texcoord3);
			vec4 tex9_20 = texture(u_texture9, v_texcoord4);

			float second_color_sum = dot(v_color3.bgr, vec3(1.0));
			vec4 weights = vec4(v_color3.bgr, 1.0 - clamp(second_color_sum, 0.0, 1.0));
			vec4 heights = max(vec4(tex6_20.a, tex7_20.a, tex8_20.a, tex9_20.a), 0.004);
			vec4 alpha_vec = weights * heights;
			float weights_max = max(alpha_vec.r, max(alpha_vec.g, max(alpha_vec.b, alpha_vec.a)));
			vec4 alpha_vec2 = (1.0 - clamp(vec4(weights_max) - alpha_vec, 0.0, 1.0)) * alpha_vec;
			vec4 alpha_normalized = alpha_vec2 * (1.0 / dot(alpha_vec2, vec4(1.0)));

			vec4 tex_mixed = tex2_20 * alpha_normalized.r +
							tex3_20 * alpha_normalized.g +
							tex4_20 * alpha_normalized.b +
							tex5_20 * alpha_normalized.a;

			// env texture would use posToTexCoord - simplified here
			emissive = (tex_mixed.a * tex1.rgb) * tex_mixed.rgb;
			mat_diffuse = mix(tex_mixed.rgb, vec3(0.0), v_color3.a);
			break;
		}

		default:
			mat_diffuse = tex1.rgb;
			break;
	}

	// apply vertex color if enabled
	if (u_use_vertex_color != 0)
		mat_diffuse *= v_color.rgb;

	// alpha test discard (only when blend_mode > 0)
	if (u_blend_mode > 0 && tex1.a < 0.501960814)
		discard;

	// apply lighting
	vec3 lit_color = calc_lighting(mat_diffuse, v_normal);

	// add emissive (unaffected by lighting)
	lit_color += emissive;

	// output alpha is always 1.0 - transparency handled by blend mode at pipeline level
	frag_color = vec4(lit_color, 1.0);
}
