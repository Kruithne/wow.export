const UniformBuffer = require('../gl/UniformBuffer');

const IDENTITY_MAT4 = new Float32Array([
	1, 0, 0, 0,
	0, 1, 0, 0,
	0, 0, 1, 0,
	0, 0, 0, 1
]);

function create_bones_ubo(shader, gl, ctx, ubos, bone_count = 0) {
	shader.bind_uniform_block('VsBoneUbo', 0);
	const ubosize = shader.get_uniform_block_param('VsBoneUbo', gl.UNIFORM_BLOCK_DATA_SIZE);
	const offsets = shader.get_active_uniform_offsets(['u_bone_matrices']);
	const ubo = new UniformBuffer(ctx, ubosize);
	ubos.push({ ubo, offsets });

	const matrices = ubo.get_float32_view(offsets[0], (ubosize - offsets[0]) / 4);
	const count = Math.min(bone_count, matrices.length / 16);
	for (let i = 0; i < count; i++)
		matrices.set(IDENTITY_MAT4, i * 16);

	return matrices;
}

module.exports = { create_bones_ubo };
