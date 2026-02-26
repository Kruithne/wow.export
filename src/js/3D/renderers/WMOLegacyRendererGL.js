/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/
import BLPImage from '../../casc/blp.js';
import VertexArray from '../gl/VertexArray.js';
import textureRibbon from '../../ui/texture-ribbon.js';
import log from '../../log.js';
import WMOLegacyLoader from '../loaders/WMOLegacyLoader.js';
import Shaders from '../Shaders.js';
import GLTexture from '../gl/GLTexture.js';
import BufferWrapper from '../../buffer.js';








const IDENTITY_MAT4 = new Float32Array([
	1, 0, 0, 0,
	0, 1, 0, 0,
	0, 0, 1, 0,
	0, 0, 0, 1
]);

// legacy wmo shaders are simpler
const WMO_LEGACY_SHADERS = {
	0: { VertexShader: 0, PixelShader: 0 },   // Diffuse
	1: { VertexShader: 0, PixelShader: 1 },   // Specular
	2: { VertexShader: 0, PixelShader: 2 },   // Metal
	3: { VertexShader: 0, PixelShader: 0 },   // Env
	4: { VertexShader: 0, PixelShader: 0 },   // Opaque
	5: { VertexShader: 0, PixelShader: 0 },   // EnvMetal
	6: { VertexShader: 0, PixelShader: 0 },   // TwoLayerDiffuse
	7: { VertexShader: 0, PixelShader: 0 },   // TwoLayerEnvMetal
};

class WMOLegacyRendererGL {
	constructor(data, fileID, gl_context, useRibbon = true) {
		this.data = data;
		this.fileID = fileID;
		this.ctx = gl_context;
		this.gl = gl_context.gl;
		this.useRibbon = useRibbon;

		this.wmo = null;
		this.syncID = -1;

		// rendering state
		this.groups = [];
		this.textures = new Map();
		this.materialTextures = new Map();
		this.default_texture = null;
		this.buffers = [];

		// doodad state
		this.doodadSets = [];
		this.m2_renderers = new Map();

		// reactive state
		this.groupArray = [];
		this.setArray = [];

		// transforms
		this.model_matrix = new Float32Array(IDENTITY_MAT4);
		this.position = [0, 0, 0];
		this.rotation = [0, 0, 0];
		this.scale = [1, 1, 1];
	}

	static load_shaders(ctx) {
		return Shaders.create_program(ctx, 'wmo');
	}

	async load() {
		this.wmo = new WMOLegacyLoader(this.data, this.fileID, true);
		await this.wmo.load();

		this.shader = WMOLegacyRendererGL.load_shaders(this.ctx);

		this._create_default_texture();
		await this._load_textures();
		await this._load_groups();
		this._setup_doodad_sets();

		const view = core.view;
		view.modelViewerWMOGroups = this.groupArray;
		view.modelViewerWMOSets = this.setArray;
		this.groupWatcher = view.$watch('modelViewerWMOGroups', () => this.updateGroups(), { deep: true });
		this.setWatcher = view.$watch('modelViewerWMOSets', () => this.updateSets(), { deep: true });
		this.wireframeWatcher = view.$watch('config.modelViewerWireframe', () => {}, { deep: true });

		this.data = undefined;
	}

	_create_default_texture() {
		const pixels = new Uint8Array([87, 175, 226, 255]);
		this.default_texture = new GLTexture(this.ctx);
		this.default_texture.set_rgba(pixels, 1, 1, { has_alpha: false });
	}

	async _load_textures() {
		const wmo = this.wmo;
		const materials = wmo.materials;
		const mpq = core.view.mpq;
		if (this.useRibbon)
			this.syncID = textureRibbon.reset();

		// legacy wmos use texture names directly
		const textureNames = wmo.textureNames || {};

		for (let i = 0; i < materials.length; i++) {
			const material = materials[i];

			// get texture filenames for this material
			const tex1Name = textureNames[material.texture1];
			const tex2Name = textureNames[material.texture2];
			const tex3Name = textureNames[material.texture3];

			const textureFileNames = [tex1Name || null, tex2Name || null, tex3Name || null];
			this.materialTextures.set(i, textureFileNames);

			for (const textureName of textureFileNames) {
				if (!textureName)
					continue;

				if (this.textures.has(textureName))
					continue;

				const ribbonSlot = this.useRibbon ? textureRibbon.addSlot() : null;
				if (ribbonSlot !== null)
					textureRibbon.setSlotFile(ribbonSlot, textureName, this.syncID);

				try {
					const data = mpq.getFile(textureName);
					if (!data)
						continue;

					const blp = new BLPFile(new BufferWrapper(data));
					const gl_tex = new GLTexture(this.ctx);

					const wrap_s = (material.flags & 0x40) ? this.gl.CLAMP_TO_EDGE : this.gl.REPEAT;
					const wrap_t = (material.flags & 0x80) ? this.gl.CLAMP_TO_EDGE : this.gl.REPEAT;

					const pixels = blp.toUInt8Array(0, 0b1111);
					gl_tex.set_rgba(pixels, blp.width, blp.height, {
						wrap_s: wrap_s,
						wrap_t: wrap_t,
						has_alpha: blp.alphaDepth > 0,
						generate_mipmaps: true
					});

					this.textures.set(textureName, gl_tex);

					if (ribbonSlot !== null)
						textureRibbon.setSlotSrc(ribbonSlot, blp.getDataURL(0b0111), this.syncID);
				} catch (e) {
					log.write('Failed to load legacy WMO texture %s: %s', textureName, e.message);
				}
			}
		}
	}

	async _load_groups() {
		const wmo = this.wmo;
		const gl = this.gl;

		for (let i = 0; i < wmo.groupCount; i++) {
			try {
				const group = await wmo.getGroup(i);

				if (!group.renderBatches || group.renderBatches.length === 0)
					continue;

				const vao = new VertexArray(this.ctx);
				vao.bind();

				// vertex buffer
				const vbo = gl.createBuffer();
				gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
				gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(group.vertices), gl.STATIC_DRAW);
				this.buffers.push(vbo);

				// normal buffer
				const nbo = gl.createBuffer();
				gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
				gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(group.normals), gl.STATIC_DRAW);
				this.buffers.push(nbo);

				// UV buffer
				let uvo = null;
				if (group.uvs && group.uvs[0]) {
					uvo = gl.createBuffer();
					gl.bindBuffer(gl.ARRAY_BUFFER, uvo);
					gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(group.uvs[0]), gl.STATIC_DRAW);
					this.buffers.push(uvo);
				}

				// color buffer
				let cbo = null;
				if (group.vertexColours && group.vertexColours[0]) {
					cbo = gl.createBuffer();
					gl.bindBuffer(gl.ARRAY_BUFFER, cbo);
					gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(group.vertexColours[0]), gl.STATIC_DRAW);
					this.buffers.push(cbo);
				}

				// index buffer
				const ebo = gl.createBuffer();
				gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
				gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(group.indices), gl.STATIC_DRAW);
				vao.ebo = ebo;

				vao.setup_wmo_separate_buffers(vbo, nbo, uvo, cbo, null, null, null, null, null);

				// build draw calls
				const draw_calls = [];
				for (const batch of group.renderBatches) {
					const matID = ((batch.flags & 2) === 2) ? batch.possibleBox2[2] : batch.materialID;
					const shader = WMO_LEGACY_SHADERS[wmo.materials[matID]?.shader ?? 0] || WMO_LEGACY_SHADERS[0];

					draw_calls.push({
						start: batch.firstFace,
						count: batch.numFaces,
						blendMode: wmo.materials[matID]?.blendMode ?? 0,
						material_id: matID,
						shader: shader
					});
				}

				this.groups.push({
					vao: vao,
					draw_calls: draw_calls,
					visible: true,
					index: i
				});

				this.groupArray.push({
					label: wmo.groupNames?.[group.nameOfs] || `Group ${i}`,
					checked: true,
					groupIndex: i
				});
			} catch (e) {
				log.write('Failed to load legacy WMO group %d: %s', i, e.message);
			}
		}
	}

	_setup_doodad_sets() {
		const wmo = this.wmo;
		if (!wmo.doodadSets)
			return;

		const setCount = wmo.doodadSets.length;
		this.doodadSets = new Array(setCount).fill(null);

		for (let i = 0; i < setCount; i++) {
			this.setArray.push({
				label: wmo.doodadSets[i].name,
				index: i,
				checked: false
			});
		}
	}

	async loadDoodadSet(index) {
		const wmo = this.wmo;
		const set = wmo.doodadSets[index];
		const mpq = core.view.mpq;

		if (!set)
			throw new Error('Invalid doodad set: ' + index);

		log.write('Loading legacy doodad set: %s', set.name);

		using _lock = core.create_busy_lock();
		core.setToast('progress', `Loading doodad set ${set.name} (${set.doodadCount} doodads)...`, null, -1, false);

		const firstIndex = set.firstInstanceIndex;
		const count = set.doodadCount;
		const renderers = [];

		for (let i = 0; i < count; i++) {
			const doodad = wmo.doodads[firstIndex + i];

			if (!wmo.doodadNames)
				continue;

			const doodadName = wmo.doodadNames[doodad.offset];
			if (!doodadName)
				continue;

			try {
				let renderer;

				if (this.m2_renderers.has(doodadName)) {
					renderer = this.m2_renderers.get(doodadName);
				} else {
					const fileData = mpq.getFile(doodadName);
					if (!fileData)
						continue;
					const data = new BufferWrapper(fileData);
					const magic = data.readUInt32LE();
					data.seek(0);

					// legacy M2 uses MD20 magic directly
					if (magic === 0x3032444D) { // 'MD20'
						renderer = new M2LegacyRendererGL(data, this.ctx, false, false);
						await renderer.load();
						this.m2_renderers.set(doodadName, renderer);
					}
				}

				if (renderer) {
					const pos = doodad.position;
					const rot = doodad.rotation;
					const scale = doodad.scale;

					renderers.push({
						renderer: renderer,
						position: [pos[0], pos[2], pos[1] * -1],
						rotation: [rot[0], rot[2], rot[1] * -1, rot[3]],
						scale: [scale, scale, scale]
					});
				}
			} catch (e) {
				log.write('Failed to load legacy doodad %s: %s', doodadName, e.message);
			}
		}

		this.doodadSets[index] = {
			renderers: renderers,
			visible: true
		};

		core.hideToast();
	}

	updateGroups() {
		if (!this.groupArray || !this.groups)
			return;

		for (let i = 0; i < this.groups.length && i < this.groupArray.length; i++)
			this.groups[i].visible = this.groupArray[i].checked;
	}

	async updateSets() {
		if (!this.wmo || !this.setArray)
			return;

		for (let i = 0; i < this.setArray.length; i++) {
			const state = this.setArray[i].checked;
			const set = this.doodadSets[i];

			if (set) {
				set.visible = state;
			} else if (state) {
				await this.loadDoodadSet(i);
			}
		}
	}

	setTransform(position, rotation, scale) {
		this.position = position;
		this.rotation = rotation;
		this.scale = scale;
		this._update_model_matrix();
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
		if (!this.shader)
			return;

		const gl = this.gl;
		const ctx = this.ctx;
		const shader = this.shader;
		const wireframe = core.view.config.modelViewerWireframe;

		shader.use();

		shader.set_uniform_mat4('u_view_matrix', false, view_matrix);
		shader.set_uniform_mat4('u_projection_matrix', false, projection_matrix);
		shader.set_uniform_mat4('u_model_matrix', false, this.model_matrix);

		// lighting
		const lx = 0.5, ly = -0.7, lz = 0.5;
		const light_view_x = view_matrix[0] * lx + view_matrix[4] * ly + view_matrix[8] * lz;
		const light_view_y = view_matrix[1] * lx + view_matrix[5] * ly + view_matrix[9] * lz;
		const light_view_z = view_matrix[2] * lx + view_matrix[6] * ly + view_matrix[10] * lz;

		shader.set_uniform_1i('u_apply_lighting', 1);
		shader.set_uniform_3f('u_ambient_color', 0.5, 0.5, 0.5);
		shader.set_uniform_3f('u_diffuse_color', 0.7, 0.7, 0.7);
		shader.set_uniform_3f('u_light_dir', light_view_x, light_view_y, light_view_z);

		shader.set_uniform_1i('u_wireframe', wireframe ? 1 : 0);
		shader.set_uniform_4f('u_wireframe_color', 1, 1, 1, 1);

		shader.set_uniform_1i('u_use_vertex_color', 0);

		shader.set_uniform_1i('u_texture1', 0);
		shader.set_uniform_1i('u_texture2', 1);
		shader.set_uniform_1i('u_texture3', 2);
		shader.set_uniform_1i('u_texture4', 3);
		shader.set_uniform_1i('u_texture5', 4);
		shader.set_uniform_1i('u_texture6', 5);
		shader.set_uniform_1i('u_texture7', 6);
		shader.set_uniform_1i('u_texture8', 7);
		shader.set_uniform_1i('u_texture9', 8);

		ctx.set_depth_test(true);
		ctx.set_depth_write(true);
		ctx.set_cull_face(false);
		ctx.set_blend(false);

		for (const group of this.groups) {
			if (!group.visible)
				continue;

			group.vao.bind();

			for (const dc of group.draw_calls) {
				shader.set_uniform_1i('u_vertex_shader', dc.shader.VertexShader);
				shader.set_uniform_1i('u_pixel_shader', dc.shader.PixelShader);
				shader.set_uniform_1i('u_blend_mode', dc.blendMode);

				const textureFileNames = this.materialTextures.get(dc.material_id);
				for (let i = 0; i < 9; i++) {
					const textureName = textureFileNames?.[i] || null;
					const texture = textureName ? (this.textures.get(textureName) || this.default_texture) : this.default_texture;
					texture.bind(i);
				}

				gl.drawElements(
					wireframe ? gl.LINES : gl.TRIANGLES,
					dc.count,
					gl.UNSIGNED_SHORT,
					dc.start * 2
				);
			}
		}

		// render doodad sets
		for (const set of this.doodadSets) {
			if (!set || !set.visible)
				continue;

			for (const doodad of set.renderers) {
				doodad.renderer.setTransformQuat(doodad.position, doodad.rotation, doodad.scale);
				doodad.renderer.render(view_matrix, projection_matrix);
			}
		}
	}

	updateAnimation(delta_time) {
		for (const set of this.doodadSets) {
			if (!set || !set.visible)
				continue;

			for (const doodad of set.renderers)
				doodad.renderer.updateAnimation?.(delta_time);
		}
	}

	getBoundingBox() {
		if (!this.wmo)
			return null;

		const src_min = this.wmo.boundingBox1;
		const src_max = this.wmo.boundingBox2;

		if (!src_min || !src_max)
			return null;

		return {
			min: [src_min[0], src_min[2], -src_max[1]],
			max: [src_max[0], src_max[2], -src_min[1]]
		};
	}

	dispose() {
		this.groupWatcher?.();
		this.setWatcher?.();
		this.wireframeWatcher?.();

		for (const group of this.groups)
			group.vao.dispose();

		for (const buf of this.buffers)
			this.gl.deleteBuffer(buf);

		for (const tex of this.textures.values())
			tex.dispose();

		this.textures.clear();
		this.materialTextures.clear();

		if (this.default_texture) {
			this.default_texture.dispose();
			this.default_texture = null;
		}

		for (const renderer of this.m2_renderers.values())
			renderer.dispose();

		this.m2_renderers.clear();

		if (this.groupArray) this.groupArray.splice(0);
		if (this.setArray) this.setArray.splice(0);

		this.groups = [];
		this.buffers = [];
		this.doodadSets = [];
	}
}

export default WMOLegacyRendererGL;