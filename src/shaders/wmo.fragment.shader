#version 300 es
precision highp float;
precision highp int;

// inputs from vertex shader
in vec2 v_texcoord;
in vec3 v_normal;
in vec3 v_position_view;
in vec4 v_color;

// textures
uniform sampler2D u_texture1;
uniform sampler2D u_texture2;

// material parameters
uniform int u_pixel_shader;
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
	vec3 specular = vec3(0.0);
	float alpha = tex1.a;

	// WMO pixel shader modes
	switch (u_pixel_shader) {
		case 0: // MapObjDiffuse
			mat_diffuse = tex1.rgb;
			break;

		case 1: // MapObjSpecular
			mat_diffuse = tex1.rgb;
			specular = vec3(tex1.a);
			alpha = 1.0;
			break;

		case 2: // MapObjMetal
			mat_diffuse = tex1.rgb;
			specular = tex1.rgb * tex1.a;
			alpha = 1.0;
			break;

		case 3: // MapObjEnv
			mat_diffuse = tex1.rgb;
			specular = tex2.rgb * tex1.a;
			break;

		case 4: // MapObjOpaque
			mat_diffuse = tex1.rgb;
			alpha = 1.0;
			break;

		case 5: // MapObjEnvMetal
			mat_diffuse = tex1.rgb;
			specular = (tex2.rgb + tex1.rgb * tex1.a);
			alpha = 1.0;
			break;

		case 6: // MapObjTwoLayerDiffuse
			mat_diffuse = mix(tex1.rgb, tex2.rgb, tex2.a);
			break;

		case 7: // MapObjTwoLayerEnvMetal
			mat_diffuse = mix(tex1.rgb, tex2.rgb, tex2.a);
			specular = (tex1.rgb * tex1.a);
			alpha = 1.0;
			break;

		case 8: // MapObjTwoLayerTerrain
			mat_diffuse = mix(tex1.rgb, tex2.rgb, v_color.a);
			break;

		case 9: // MapObjDiffuseEmissive
			mat_diffuse = tex1.rgb;
			specular = tex2.rgb * tex2.a;
			break;

		case 10: // MapObjMaskedEnvMetal
			mat_diffuse = tex1.rgb;
			specular = tex2.rgb * tex1.a;
			alpha = 1.0;
			break;

		case 11: // MapObjEnvMetalEmissive
			mat_diffuse = tex1.rgb;
			specular = tex2.rgb * tex1.a + tex2.rgb * tex2.a;
			alpha = 1.0;
			break;

		case 12: // MapObjTwoLayerDiffuseOpaque
			mat_diffuse = mix(tex1.rgb, tex2.rgb, tex2.a);
			alpha = 1.0;
			break;

		case 13: // MapObjTwoLayerDiffuseEmissive
			mat_diffuse = mix(tex1.rgb, tex2.rgb, tex2.a);
			specular = tex1.rgb * tex1.a;
			break;

		case 14: // MapObjAdditiveMaskedEnvMetal
			mat_diffuse = tex1.rgb;
			specular = tex2.rgb * tex1.a;
			break;

		case 15: // MapObjTwoLayerDiffuseMod2x
			mat_diffuse = mix(tex1.rgb, tex2.rgb, tex2.a);
			specular = tex1.rgb * tex1.a + tex2.rgb * tex2.a;
			alpha = 1.0;
			break;

		case 16: // MapObjTwoLayerDiffuseMod2xNA
			mat_diffuse = mix(tex1.rgb, tex2.rgb * 2.0, tex2.a);
			break;

		case 17: // MapObjTwoLayerDiffuseAlpha
			mat_diffuse = mix(tex1.rgb, tex2.rgb * 2.0, tex2.a);
			alpha = 1.0;
			break;

		case 18: // MapObjLod
			mat_diffuse = mix(tex1.rgb, tex2.rgb, v_color.a);
			alpha = tex1.a;
			break;

		case 19: // MapObjParallax
			mat_diffuse = tex1.rgb;
			break;

		case 20: // MapObjUnkShader
			mat_diffuse = tex1.rgb;
			alpha = 1.0; // wrong but for now
			break;

		default:
			mat_diffuse = tex1.rgb;
			break;
	}

	// apply vertex color if enabled
	if (u_use_vertex_color != 0)
		mat_diffuse *= v_color.rgb;

	// apply lighting
	vec3 lit_color = calc_lighting(mat_diffuse, v_normal);

	// add specular
	lit_color += specular;

	frag_color = vec4(lit_color, alpha);
}
