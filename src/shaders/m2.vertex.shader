#version 300 es
precision highp float;
precision highp int;

// vertex attributes
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in uvec4 a_bone_indices;
layout(location = 3) in vec4 a_bone_weights;
layout(location = 4) in vec2 a_texcoord;
layout(location = 5) in vec2 a_texcoord2;

// uniforms
uniform mat4 u_view_matrix;
uniform mat4 u_projection_matrix;
uniform mat4 u_model_matrix;
uniform vec3 u_view_up;
uniform float u_time;

// bone matrices (max 256 bones)
#define MAX_BONES 256
uniform mat4 u_bone_matrices[MAX_BONES];
uniform int u_bone_count;

// texture transform matrices
uniform int u_tex_matrix1_idx;
uniform int u_tex_matrix2_idx;
#define MAX_MATRICES 64
uniform mat4 u_tex_matrices[MAX_MATRICES];

// vertex shader mode
uniform int u_vertex_shader;

// outputs
out vec2 v_texcoord;
out vec2 v_texcoord2;
out vec2 v_texcoord3;
out vec3 v_normal;
out vec3 v_position_view;
out float v_edge_fade;

// calculate environment map coords from view position and normal
vec2 calc_env_coord(vec3 pos_view, vec3 normal_view) {
	vec3 r = reflect(normalize(pos_view), normalize(normal_view));
	float m = 2.0 * sqrt(r.x * r.x + r.y * r.y + (r.z + 1.0) * (r.z + 1.0));
	return vec2(r.x / m + 0.5, r.y / m + 0.5);
}

// edge fade calculation
float calc_edge_fade(vec3 pos_view, vec3 normal_view) {
	vec3 view_dir = normalize(-pos_view);
	float n_dot_v = abs(dot(normalize(normal_view), view_dir));
	return clamp(n_dot_v * n_dot_v, 0.0, 1.0);
}

void main() {
	// bone skinning
	mat4 bone_transform = mat4(1.0);

	// note: legacy m2 bone skinning disabled until animation system is fixed
	if (u_bone_count > 0) {
		float total_weight = dot(a_bone_weights, vec4(1.0));
		if (total_weight > 0.0) {
			bone_transform = mat4(0.0);
			bone_transform += a_bone_weights.x * u_bone_matrices[a_bone_indices.x];
			bone_transform += a_bone_weights.y * u_bone_matrices[a_bone_indices.y];
			bone_transform += a_bone_weights.z * u_bone_matrices[a_bone_indices.z];
			bone_transform += a_bone_weights.w * u_bone_matrices[a_bone_indices.w];
		}
	}

	// transform position
	vec4 skinned_pos = bone_transform * vec4(a_position, 1.0);
	vec4 world_pos = u_model_matrix * skinned_pos;
	vec4 view_pos = u_view_matrix * world_pos;

	gl_Position = u_projection_matrix * view_pos;

	// transform normal
	mat3 normal_matrix = transpose(inverse(mat3(u_view_matrix * u_model_matrix * bone_transform)));
	vec3 normal_view = normalize(normal_matrix * a_normal);

	v_normal = normal_view;
	v_position_view = view_pos.xyz;

	// calculate texture coordinates based on vertex shader mode
	vec2 env_coord = calc_env_coord(view_pos.xyz, normal_view);
	float edge_scan = calc_edge_fade(view_pos.xyz, normal_view);
	v_edge_fade = 1.0;

	// apply texture matrix transforms
	mat4 tex_mat1 = u_tex_matrix1_idx < 0 ? mat4(1.0) : u_tex_matrices[u_tex_matrix1_idx];
	mat4 tex_mat2 = u_tex_matrix2_idx < 0 ? mat4(1.0) : u_tex_matrices[u_tex_matrix2_idx];

	v_texcoord = a_texcoord;
	v_texcoord2 = vec2(0.0);
	v_texcoord3 = vec2(0.0);

	switch (u_vertex_shader) {
		case 0: // Diffuse_T1
			v_texcoord = (tex_mat1 * vec4(a_texcoord, 0.0, 1.0)).xy;
			break;

		case 1: // Diffuse_Env
			v_texcoord = env_coord;
			break;

		case 2: // Diffuse_T1_T2
			v_texcoord = (tex_mat1 * vec4(a_texcoord, 0.0, 1.0)).xy;
			v_texcoord2 = (tex_mat2 * vec4(a_texcoord2, 0.0, 1.0)).xy;
			break;

		case 3: // Diffuse_T1_Env
			v_texcoord = (tex_mat1 * vec4(a_texcoord, 0.0, 1.0)).xy;
			v_texcoord2 = env_coord;
			break;

		case 4: // Diffuse_Env_T1
			v_texcoord = env_coord;
			v_texcoord2 = (tex_mat1 * vec4(a_texcoord, 0.0, 1.0)).xy;
			break;

		case 5: // Diffuse_Env_Env
			v_texcoord = env_coord;
			v_texcoord2 = env_coord;
			break;

		case 6: // Diffuse_T1_Env_T1
			v_texcoord = (tex_mat1 * vec4(a_texcoord, 0.0, 1.0)).xy;
			v_texcoord2 = env_coord;
			v_texcoord3 = (tex_mat1 * vec4(a_texcoord, 0.0, 1.0)).xy;
			break;

		case 7: // Diffuse_T1_T1
			v_texcoord = (tex_mat1 * vec4(a_texcoord, 0.0, 1.0)).xy;
			v_texcoord2 = (tex_mat1 * vec4(a_texcoord, 0.0, 1.0)).xy;
			break;

		case 8: // Diffuse_T1_T1_T1
			v_texcoord = (tex_mat1 * vec4(a_texcoord, 0.0, 1.0)).xy;
			v_texcoord2 = (tex_mat1 * vec4(a_texcoord, 0.0, 1.0)).xy;
			v_texcoord3 = (tex_mat1 * vec4(a_texcoord, 0.0, 1.0)).xy;
			break;

		case 9: // Diffuse_EdgeFade_T1
			v_edge_fade = edge_scan;
			v_texcoord = (tex_mat1 * vec4(a_texcoord, 0.0, 1.0)).xy;
			break;

		case 10: // Diffuse_T2
			v_texcoord = (tex_mat2 * vec4(a_texcoord2, 0.0, 1.0)).xy;
			break;

		case 11: // Diffuse_T1_Env_T2
			v_texcoord = (tex_mat1 * vec4(a_texcoord, 0.0, 1.0)).xy;
			v_texcoord2 = env_coord;
			v_texcoord3 = (tex_mat2 * vec4(a_texcoord2, 0.0, 1.0)).xy;
			break;

		case 12: // Diffuse_EdgeFade_T1_T2
			v_edge_fade = edge_scan;
			v_texcoord = (tex_mat1 * vec4(a_texcoord, 0.0, 1.0)).xy;
			v_texcoord2 = (tex_mat2 * vec4(a_texcoord2, 0.0, 1.0)).xy;
			break;

		case 13: // Diffuse_EdgeFade_Env
			v_edge_fade = edge_scan;
			v_texcoord = env_coord;
			break;

		case 14: // Diffuse_T1_T2_T1
			v_texcoord = (tex_mat1 * vec4(a_texcoord, 0.0, 1.0)).xy;
			v_texcoord2 = (tex_mat2 * vec4(a_texcoord2, 0.0, 1.0)).xy;
			v_texcoord3 = (tex_mat1 * vec4(a_texcoord, 0.0, 1.0)).xy;
			break;

		case 15: // Diffuse_T1_T2_T3
			v_texcoord = (tex_mat1 * vec4(a_texcoord, 0.0, 1.0)).xy;
			v_texcoord2 = (tex_mat2 * vec4(a_texcoord2, 0.0, 1.0)).xy;
			v_texcoord3 = a_texcoord2;
			break;

		case 16: // Color_T1_T2_T3
			v_texcoord = (tex_mat2 * vec4(a_texcoord2, 0.0, 1.0)).xy;
			v_texcoord2 = vec2(0.0);
			v_texcoord3 = a_texcoord2;
			break;

		case 17: // BW_Diffuse_T1
		case 18: // BW_Diffuse_T1_T2
			v_texcoord = (tex_mat1 * vec4(a_texcoord, 0.0, 1.0)).xy;
			break;

		default:
			v_texcoord = a_texcoord;
			break;
	}
}
