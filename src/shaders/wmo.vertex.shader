#version 300 es
precision highp float;
precision highp int;

// vertex attributes
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 4) in vec2 a_texcoord;
layout(location = 5) in vec2 a_texcoord2;
layout(location = 6) in vec4 a_color;
layout(location = 7) in vec4 a_color2;
layout(location = 8) in vec2 a_texcoord3;
layout(location = 9) in vec2 a_texcoord4;
layout(location = 10) in vec4 a_color3;

// uniforms
uniform mat4 u_view_matrix;
uniform mat4 u_projection_matrix;
uniform mat4 u_model_matrix;
uniform int u_vertex_shader;

// outputs
out vec2 v_texcoord;
out vec2 v_texcoord2;
out vec2 v_texcoord3;
out vec2 v_texcoord4;
out vec3 v_normal;
out vec3 v_position_view;
out vec4 v_color;
out vec4 v_color2;
out vec4 v_color3;

void main() {
	vec4 world_pos = u_model_matrix * vec4(a_position, 1.0);
	vec4 view_pos = u_view_matrix * world_pos;

	gl_Position = u_projection_matrix * view_pos;

	// transform normal
	mat3 normal_matrix = transpose(inverse(mat3(u_view_matrix * u_model_matrix)));
	v_normal = normalize(normal_matrix * a_normal);

	v_position_view = view_pos.xyz;
	v_color = a_color;
	v_color2 = a_color2;
	v_color3 = a_color3;

	// WMO vertex shader modes
	switch (u_vertex_shader) {
		default: // TODO: Implement other modes
		case 0:
			v_texcoord = a_texcoord;
			v_texcoord2 = a_texcoord2;
			v_texcoord3 = a_texcoord3;
			v_texcoord4 = a_texcoord4;
			break;
	}
}
