/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/
import BLPImage from '../../casc/blp.js';
import VertexArray from '../gl/VertexArray.js';
import core from '../../core.js';
import BLPImage from '../../casc/blp.js';
import MDXLoader from '../loaders/MDXLoader.js';
import GLTexture from '../gl/GLTexture.js';
import log from '../../log.js';
import Shaders from '../Shaders.js';
import BufferWrapper from '../../buffer.js';



const IDENTITY_MAT4 = new Float32Array([
	1, 0, 0, 0,
	0, 1, 0, 0,
	0, 0, 1, 0,
	0, 0, 0, 1
]);

// interpolation types
const INTERP_NONE = 0;
const INTERP_LINEAR = 1;
const INTERP_HERMITE = 2;
const INTERP_BEZIER = 3;

function mat4_multiply(out, a, b) {
	const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
	const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
	const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
	const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

	let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
	out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
	out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
	out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
	out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

	b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
	out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
	out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
	out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
	out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

	b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
	out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
	out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
	out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
	out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

	b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
	out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
	out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
	out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
	out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
}

function mat4_from_translation(out, x, y, z) {
	out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
	out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
	out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
	out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
}

function mat4_from_quat(out, x, y, z, w) {
	const x2 = x + x, y2 = y + y, z2 = z + z;
	const xx = x * x2, xy = x * y2, xz = x * z2;
	const yy = y * y2, yz = y * z2, zz = z * z2;
	const wx = w * x2, wy = w * y2, wz = w * z2;

	out[0] = 1 - (yy + zz);
	out[1] = xy + wz;
	out[2] = xz - wy;
	out[3] = 0;
	out[4] = xy - wz;
	out[5] = 1 - (xx + zz);
	out[6] = yz + wx;
	out[7] = 0;
	out[8] = xz + wy;
	out[9] = yz - wx;
	out[10] = 1 - (xx + yy);
	out[11] = 0;
	out[12] = 0;
	out[13] = 0;
	out[14] = 0;
	out[15] = 1;
}

function mat4_from_scale(out, x, y, z) {
	out[0] = x; out[1] = 0; out[2] = 0; out[3] = 0;
	out[4] = 0; out[5] = y; out[6] = 0; out[7] = 0;
	out[8] = 0; out[9] = 0; out[10] = z; out[11] = 0;
	out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
}

function mat4_copy(out, src) {
	out.set(src);
}

function lerp(a, b, t) {
	return a + (b - a) * t;
}

function quat_slerp(out, ax, ay, az, aw, bx, by, bz, bw, t) {
	let cosom = ax * bx + ay * by + az * bz + aw * bw;

	if (cosom < 0) {
		cosom = -cosom;
		bx = -bx; by = -by; bz = -bz; bw = -bw;
	}

	let scale0, scale1;
	if (1 - cosom > 0.000001) {
		const omega = Math.acos(cosom);
		const sinom = Math.sin(omega);
		scale0 = Math.sin((1 - t) * omega) / sinom;
		scale1 = Math.sin(t * omega) / sinom;
	} else {
		scale0 = 1 - t;
		scale1 = t;
	}

	out[0] = scale0 * ax + scale1 * bx;
	out[1] = scale0 * ay + scale1 * by;
	out[2] = scale0 * az + scale1 * bz;
	out[3] = scale0 * aw + scale1 * bw;
}

class MDXRendererGL {
	constructor(data, gl_context, reactive = false, useRibbon = true) {
		this.data = data;
		this.ctx = gl_context;
		this.gl = gl_context.gl;
		this.reactive = reactive;
		this.useRibbon = useRibbon;

		this.mdx = null;
		this.syncID = -1;

		// rendering
		this.vaos = [];
		this.textures = new Map();
		this.default_texture = null;
		this.buffers = [];
		this.draw_calls = [];

		// animation
		this.nodes = null;
		this.node_matrices = null;
		this.current_animation = null;
		this.animation_time = 0;
		this.animation_paused = false;

		// reactive
		this.geosetKey = 'modelViewerGeosets';
		this.geosetArray = null;

		// transforms
		this.model_matrix = new Float32Array(IDENTITY_MAT4);
		this.position = [0, 0, 0];
		this.rotation = [0, 0, 0];
		this.scale = [1, 1, 1];
	}

	static load_shaders(ctx) {
		return Shaders.create_program(ctx, 'm2');
	}

	async load() {
		this.mdx = new MDXLoader(this.data);
		await this.mdx.load();

		this.shader = MDXRendererGL.load_shaders(this.ctx);

		this._create_default_texture();
		await this._load_textures();
		this._create_skeleton();
		this._build_geometry();

		if (this.reactive && this.geosetArray) {
			core.view[this.geosetKey] = this.geosetArray;
			this.geosetWatcher = core.view.$watch(this.geosetKey, () => this.updateGeosets(), { deep: true });
			this.wireframeWatcher = core.view.$watch('config.modelViewerWireframe', () => {}, { deep: true });
		}

		this.data = undefined;
	}

	_create_default_texture() {
		const pixels = new Uint8Array([87, 175, 226, 255]);
		this.default_texture = new GLTexture(this.ctx);
		this.default_texture.set_rgba(pixels, 1, 1, { has_alpha: false });
	}

	async _load_textures() {
		const textures = this.mdx.textures;
		const mpq = core.view.mpq;
		if (this.useRibbon)
			this.syncID = textureRibbon.reset();

		for (let i = 0; i < textures.length; i++) {
			const texture = textures[i];
			const ribbonSlot = this.useRibbon ? textureRibbon.addSlot() : null;

			// mdx uses image filename directly
			const fileName = texture.image;
			if (fileName && fileName.length > 0) {
				if (ribbonSlot !== null)
					textureRibbon.setSlotFile(ribbonSlot, fileName, this.syncID);

				try {
					const data = await mpq.getFile(fileName);
					if (data) {
						const blp = new BLPImage(new BufferWrapper(data));
						const gl_tex = new GLTexture(this.ctx);

						const wrap_s = (texture.flags & 1) ? this.gl.REPEAT : this.gl.CLAMP_TO_EDGE;
						const wrap_t = (texture.flags & 2) ? this.gl.REPEAT : this.gl.CLAMP_TO_EDGE;

						const pixels = blp.toUInt8Array(0, 0b1111);
						gl_tex.set_rgba(pixels, blp.width, blp.height, {
							wrap_s: wrap_s,
							wrap_t: wrap_t,
							has_alpha: blp.alphaDepth > 0,
							generate_mipmaps: true
						});

						this.textures.set(i, gl_tex);

						if (ribbonSlot !== null)
							textureRibbon.setSlotSrc(ribbonSlot, blp.getDataURL(0b0111), this.syncID);
					}
				} catch (e) {
					log.write('Failed to load MDX texture %s: %s', fileName, e.message);
				}
			}
		}
	}

	_create_skeleton() {
		const nodes = this.mdx.nodes;

		if (!nodes || nodes.length === 0) {
			this.nodes = null;
			this.node_matrices = new Float32Array(16);
			return;
		}

		// flatten nodes array (may have gaps)
		this.nodes = [];
		let maxId = 0;
		for (let i = 0; i < nodes.length; i++) {
			if (nodes[i]) {
				this.nodes.push(nodes[i]);
				if (nodes[i].objectId > maxId)
					maxId = nodes[i].objectId;
			}
		}

		this.node_matrices = new Float32Array((maxId + 1) * 16);
		for (let i = 0; i <= maxId; i++)
			this.node_matrices.set(IDENTITY_MAT4, i * 16);
	}

	_build_geometry() {
		const mdx = this.mdx;
		const gl = this.gl;

		if (this.reactive)
			this.geosetArray = [];

		for (let g = 0; g < mdx.geosets.length; g++) {
			const geoset = mdx.geosets[g];

			// convert vertices (mdx uses different coordinate system)
			const vertCount = geoset.vertices.length / 3;
			const vertices = new Float32Array(vertCount * 3);
			const normals = new Float32Array(vertCount * 3);

			for (let i = 0; i < vertCount; i++) {
				// x, y, z -> x, z, -y (convert to webgl y-up)
				vertices[i * 3] = geoset.vertices[i * 3];
				vertices[i * 3 + 1] = geoset.vertices[i * 3 + 2];
				vertices[i * 3 + 2] = -geoset.vertices[i * 3 + 1];

				normals[i * 3] = geoset.normals[i * 3];
				normals[i * 3 + 1] = geoset.normals[i * 3 + 2];
				normals[i * 3 + 2] = -geoset.normals[i * 3 + 1];
			}

			// uvs (flip v)
			const uvs = geoset.tVertices[0] || new Float32Array(vertCount * 2);
			const flippedUvs = new Float32Array(uvs.length);
			for (let i = 0; i < vertCount; i++) {
				flippedUvs[i * 2] = uvs[i * 2];
				flippedUvs[i * 2 + 1] = 1 - uvs[i * 2 + 1];
			}

			// create VAO
			const vao = new VertexArray(this.ctx);
			vao.bind();

			// vertex buffer
			const vbo = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
			gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
			this.buffers.push(vbo);

			// normal buffer
			const nbo = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
			gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
			this.buffers.push(nbo);

			// uv buffer
			const uvo = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, uvo);
			gl.bufferData(gl.ARRAY_BUFFER, flippedUvs, gl.STATIC_DRAW);
			this.buffers.push(uvo);

			// bone index/weight (mdx uses group-based skinning, simplified for now)
			const boneIndices = new Uint8Array(vertCount * 4);
			const boneWeights = new Uint8Array(vertCount * 4);

			for (let i = 0; i < vertCount; i++) {
				const groupIdx = geoset.vertexGroup[i] || 0;
				const group = geoset.groups[groupIdx] || [0];

				// assign up to 4 bones per vertex with equal weight
				const boneCount = Math.min(group.length, 4);
				const weight = Math.floor(255 / boneCount);

				for (let b = 0; b < 4; b++) {
					if (b < boneCount) {
						boneIndices[i * 4 + b] = group[b] || 0;
						boneWeights[i * 4 + b] = weight;
					} else {
						boneIndices[i * 4 + b] = 0;
						boneWeights[i * 4 + b] = 0;
					}
				}
			}

			const bibo = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, bibo);
			gl.bufferData(gl.ARRAY_BUFFER, boneIndices, gl.STATIC_DRAW);
			this.buffers.push(bibo);

			const bwbo = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, bwbo);
			gl.bufferData(gl.ARRAY_BUFFER, boneWeights, gl.STATIC_DRAW);
			this.buffers.push(bwbo);

			// index buffer
			const ebo = gl.createBuffer();
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
			gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(geoset.faces), gl.STATIC_DRAW);
			this.buffers.push(ebo);
			vao.ebo = ebo;

			vao.setup_m2_separate_buffers(vbo, nbo, uvo, bibo, bwbo, null);

			this.vaos.push(vao);

			// material/texture
			const material = mdx.materials[geoset.materialId];
			let textureId = null;
			let blendMode = 0;
			let twoSided = false;

			if (material && material.layers && material.layers.length > 0) {
				const layer = material.layers[0];
				textureId = typeof layer.textureId === 'number' ? layer.textureId : null;
				blendMode = layer.filterMode || 0;
				twoSided = !!(layer.shading & 0x10);
			}

			const drawCall = {
				vao: vao,
				start: 0,
				count: geoset.faces.length,
				textureId: textureId,
				blendMode: blendMode,
				twoSided: twoSided,
				visible: true
			};

			this.draw_calls.push(drawCall);

			if (this.reactive) {
				this.geosetArray.push({
					label: 'Geoset ' + g,
					checked: true,
					id: g
				});
			}
		}
	}

	async playAnimation(index) {
		this.current_animation = index;
		this.animation_time = 0;
	}

	stopAnimation() {
		this.current_animation = null;
		this.animation_time = 0;
		this.animation_paused = false;

		if (this.nodes) {
			const maxId = (this.node_matrices.length / 16) - 1;
			for (let i = 0; i <= maxId; i++)
				this.node_matrices.set(IDENTITY_MAT4, i * 16);
		}
	}

	updateAnimation(delta_time) {
		if (this.current_animation === null || !this.nodes)
			return;

		const seq = this.mdx.sequences?.[this.current_animation];
		if (!seq)
			return;

		if (!this.animation_paused) {
			this.animation_time += delta_time * 1000; // convert to ms

			const duration = seq.interval[1] - seq.interval[0];
			if (duration > 0) {
				while (this.animation_time >= duration)
					this.animation_time -= duration;
			}
		}

		this._update_node_matrices();
	}

	_update_node_matrices() {
		const frame = this.mdx.sequences[this.current_animation].interval[0] + this.animation_time;
		const nodes = this.nodes;

		const local_mat = new Float32Array(16);
		const trans_mat = new Float32Array(16);
		const rot_mat = new Float32Array(16);
		const scale_mat = new Float32Array(16);
		const pivot_mat = new Float32Array(16);
		const neg_pivot_mat = new Float32Array(16);
		const temp_result = new Float32Array(16);

		const calculated = new Set();

		const calc_node = (node) => {
			if (!node || calculated.has(node.objectId))
				return;

			// calc parent first
			if (node.parent !== null && this.mdx.nodes[node.parent])
				calc_node(this.mdx.nodes[node.parent]);

			const pivot = node.pivotPoint || [0, 0, 0];
			// convert pivot (same coord conversion)
			const px = pivot[0];
			const py = pivot[2];
			const pz = -pivot[1];

			mat4_copy(local_mat, IDENTITY_MAT4);

			const has_trans = node.translation?.keys?.length > 0;
			const has_rot = node.rotation?.keys?.length > 0;
			const has_scale = node.scale?.keys?.length > 0;

			if (has_trans || has_rot || has_scale) {
				mat4_from_translation(pivot_mat, px, py, pz);
				mat4_multiply(temp_result, local_mat, pivot_mat);
				mat4_copy(local_mat, temp_result);

				if (has_trans) {
					const [tx, ty, tz] = this._sample_vec3(node.translation, frame);
					mat4_from_translation(trans_mat, tx, tz, -ty);
					mat4_multiply(temp_result, local_mat, trans_mat);
					mat4_copy(local_mat, temp_result);
				}

				if (has_rot) {
					const [qx, qy, qz, qw] = this._sample_quat(node.rotation, frame);
					mat4_from_quat(rot_mat, qx, qz, -qy, qw);
					mat4_multiply(temp_result, local_mat, rot_mat);
					mat4_copy(local_mat, temp_result);
				}

				if (has_scale) {
					const [sx, sy, sz] = this._sample_vec3(node.scale, frame);
					mat4_from_scale(scale_mat, sx, sz, sy);
					mat4_multiply(temp_result, local_mat, scale_mat);
					mat4_copy(local_mat, temp_result);
				}

				mat4_from_translation(neg_pivot_mat, -px, -py, -pz);
				mat4_multiply(temp_result, local_mat, neg_pivot_mat);
				mat4_copy(local_mat, temp_result);
			}

			const offset = node.objectId * 16;
			if (node.parent !== null && this.mdx.nodes[node.parent]) {
				const parentOffset = node.parent * 16;
				const parentMat = this.node_matrices.subarray(parentOffset, parentOffset + 16);
				mat4_multiply(this.node_matrices.subarray(offset, offset + 16), parentMat, local_mat);
			} else {
				this.node_matrices.set(local_mat, offset);
			}

			calculated.add(node.objectId);
		};

		for (const node of nodes)
			calc_node(node);
	}

	_sample_vec3(track, frame) {
		const keys = track.keys;
		if (!keys || keys.length === 0)
			return [0, 0, 0];

		if (keys.length === 1 || frame <= keys[0].frame) {
			const v = keys[0].value;
			return Array.isArray(v) ? v : [v, v, v];
		}

		if (frame >= keys[keys.length - 1].frame) {
			const v = keys[keys.length - 1].value;
			return Array.isArray(v) ? v : [v, v, v];
		}

		let idx = 0;
		for (let i = 0; i < keys.length - 1; i++) {
			if (frame >= keys[i].frame && frame < keys[i + 1].frame) {
				idx = i;
				break;
			}
		}

		const k0 = keys[idx];
		const k1 = keys[idx + 1];
		const t = (frame - k0.frame) / (k1.frame - k0.frame);

		const v0 = k0.value;
		const v1 = k1.value;

		return [
			lerp(v0[0], v1[0], t),
			lerp(v0[1], v1[1], t),
			lerp(v0[2], v1[2], t)
		];
	}

	_sample_quat(track, frame) {
		const keys = track.keys;
		if (!keys || keys.length === 0)
			return [0, 0, 0, 1];

		if (keys.length === 1 || frame <= keys[0].frame)
			return keys[0].value;

		if (frame >= keys[keys.length - 1].frame)
			return keys[keys.length - 1].value;

		let idx = 0;
		for (let i = 0; i < keys.length - 1; i++) {
			if (frame >= keys[i].frame && frame < keys[i + 1].frame) {
				idx = i;
				break;
			}
		}

		const k0 = keys[idx];
		const k1 = keys[idx + 1];
		const t = (frame - k0.frame) / (k1.frame - k0.frame);

		const q0 = k0.value;
		const q1 = k1.value;

		const out = [0, 0, 0, 1];
		quat_slerp(out, q0[0], q0[1], q0[2], q0[3], q1[0], q1[1], q1[2], q1[3], t);
		return out;
	}

	updateGeosets() {
		if (!this.reactive || !this.geosetArray || !this.draw_calls)
			return;

		for (let i = 0; i < this.draw_calls.length && i < this.geosetArray.length; i++)
			this.draw_calls[i].visible = this.geosetArray[i].checked;
	}

	setTransform(position, rotation, scale) {
		this.position = position;
		this.rotation = rotation;
		this.scale = scale;
		this._update_model_matrix();
	}

	setTransformQuat(position, quat, scale) {
		const [px, py, pz] = position;
		const [qx, qy, qz, qw] = quat;
		const [sx, sy, sz] = scale;

		const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
		const xx = qx * x2, xy = qx * y2, xz = qx * z2;
		const yy = qy * y2, yz = qy * z2, zz = qz * z2;
		const wx = qw * x2, wy = qw * y2, wz = qw * z2;

		const m = this.model_matrix;
		m[0] = (1 - (yy + zz)) * sx;
		m[1] = (xy + wz) * sx;
		m[2] = (xz - wy) * sx;
		m[3] = 0;
		m[4] = (xy - wz) * sy;
		m[5] = (1 - (xx + zz)) * sy;
		m[6] = (yz + wx) * sy;
		m[7] = 0;
		m[8] = (xz + wy) * sz;
		m[9] = (yz - wx) * sz;
		m[10] = (1 - (xx + yy)) * sz;
		m[11] = 0;
		m[12] = px;
		m[13] = py;
		m[14] = pz;
		m[15] = 1;
	}

	_update_model_matrix() {
		const m = this.model_matrix;
		const [px, py, pz] = this.position;
		const [rx, ry, rz] = this.rotation;
		const [sx, sy, sz] = this.scale;

		const cx = Math.cos(rx), sinx = Math.sin(rx);
		const cy = Math.cos(ry), siny = Math.sin(ry);
		const cz = Math.cos(rz), sinz = Math.sin(rz);

		m[0] = cy * cz * sx;
		m[1] = cy * sinz * sx;
		m[2] = -siny * sx;
		m[3] = 0;
		m[4] = (sinx * siny * cz - cx * sinz) * sy;
		m[5] = (sinx * siny * sinz + cx * cz) * sy;
		m[6] = sinx * cy * sy;
		m[7] = 0;
		m[8] = (cx * siny * cz + sinx * sinz) * sz;
		m[9] = (cx * siny * sinz - sinx * cz) * sz;
		m[10] = cx * cy * sz;
		m[11] = 0;
		m[12] = px;
		m[13] = py;
		m[14] = pz;
		m[15] = 1;
	}

	render(view_matrix, projection_matrix) {
		if (!this.shader || this.draw_calls.length === 0)
			return;

		const gl = this.gl;
		const ctx = this.ctx;
		const shader = this.shader;
		const wireframe = core.view.config.modelViewerWireframe;

		shader.use();

		shader.set_uniform_mat4('u_view_matrix', false, view_matrix);
		shader.set_uniform_mat4('u_projection_matrix', false, projection_matrix);
		shader.set_uniform_mat4('u_model_matrix', false, this.model_matrix);
		shader.set_uniform_3f('u_view_up', 0, 1, 0);
		shader.set_uniform_1f('u_time', performance.now() * 0.001);

		// bone matrices (mdx uses node-based skeleton)
		shader.set_uniform_1i('u_bone_count', this.nodes ? this.nodes.length : 0);
		if (this.nodes && this.node_matrices) {
			const loc = shader.get_uniform_location('u_bone_matrices');
			if (loc !== null)
				gl.uniformMatrix4fv(loc, false, this.node_matrices);
		}

		shader.set_uniform_1i('u_has_tex_matrix1', 0);
		shader.set_uniform_1i('u_has_tex_matrix2', 0);
		shader.set_uniform_mat4('u_tex_matrix1', false, IDENTITY_MAT4);
		shader.set_uniform_mat4('u_tex_matrix2', false, IDENTITY_MAT4);

		// lighting
		const lx = 3, ly = -0.7, lz = -2;
		const light_view_x = view_matrix[0] * lx + view_matrix[4] * ly + view_matrix[8] * lz;
		const light_view_y = view_matrix[1] * lx + view_matrix[5] * ly + view_matrix[9] * lz;
		const light_view_z = view_matrix[2] * lx + view_matrix[6] * ly + view_matrix[10] * lz;

		shader.set_uniform_1i('u_apply_lighting', 1);
		shader.set_uniform_3f('u_ambient_color', 0.5, 0.5, 0.5);
		shader.set_uniform_3f('u_diffuse_color', 0.7, 0.7, 0.7);
		shader.set_uniform_3f('u_light_dir', light_view_x, light_view_y, light_view_z);

		shader.set_uniform_1i('u_wireframe', wireframe ? 1 : 0);
		shader.set_uniform_4f('u_wireframe_color', 1, 1, 1, 1);

		shader.set_uniform_1f('u_alpha_test', 0.501960814);

		shader.set_uniform_1i('u_texture1', 0);
		shader.set_uniform_1i('u_texture2', 1);
		shader.set_uniform_1i('u_texture3', 2);
		shader.set_uniform_1i('u_texture4', 3);

		shader.set_uniform_3f('u_tex_sample_alpha', 1, 1, 1);

		// use basic shader mode for mdx
		shader.set_uniform_1i('u_vertex_shader', 0);
		shader.set_uniform_1i('u_pixel_shader', 0);
		shader.set_uniform_4f('u_mesh_color', 1, 1, 1, 1);

		ctx.set_depth_test(true);
		ctx.set_depth_write(true);

		for (const dc of this.draw_calls) {
			if (!dc.visible)
				continue;

			// map mdx blend modes to m2 blend modes
			shader.set_uniform_1i('u_blend_mode', dc.blendMode);
			ctx.apply_blend_mode(dc.blendMode);

			if (dc.twoSided)
				ctx.set_cull_face(false);
			else {
				ctx.set_cull_face(true);
				ctx.set_cull_mode(gl.BACK);
			}

			// bind texture
			const texture = (dc.textureId !== null) ? (this.textures.get(dc.textureId) || this.default_texture) : this.default_texture;
			texture.bind(0);
			this.default_texture.bind(1);
			this.default_texture.bind(2);
			this.default_texture.bind(3);

			dc.vao.bind();
			gl.drawElements(
				wireframe ? gl.LINES : gl.TRIANGLES,
				dc.count,
				gl.UNSIGNED_SHORT,
				dc.start * 2
			);
		}

		ctx.set_blend(false);
		ctx.set_depth_test(true);
		ctx.set_depth_write(true);
		ctx.set_cull_face(false);
	}

	getBoundingBox() {
		if (!this.mdx || !this.mdx.info)
			return null;

		const info = this.mdx.info;
		if (!info.minExtent || !info.maxExtent)
			return null;

		// convert coords
		return {
			min: [info.minExtent[0], info.minExtent[2], -info.maxExtent[1]],
			max: [info.maxExtent[0], info.maxExtent[2], -info.minExtent[1]]
		};
	}

	dispose() {
		this.geosetWatcher?.();
		this.wireframeWatcher?.();

		for (const vao of this.vaos)
			vao.dispose();

		for (const buf of this.buffers)
			this.gl.deleteBuffer(buf);

		for (const tex of this.textures.values())
			tex.dispose();

		this.textures.clear();

		if (this.default_texture) {
			this.default_texture.dispose();
			this.default_texture = null;
		}

		this.vaos = [];
		this.buffers = [];
		this.draw_calls = [];

		if (this.geosetArray)
			this.geosetArray.splice(0);
	}
}

export default MDXRendererGL;