/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

const util = require('util');
const fs = require('fs');
const path = require('path');
const core = require('../../core');
const log = require('../../log');
const constants = require('../../constants');

const BLPFile = require('../../casc/blp');
const Texture = require('../Texture');
const WMOLoader = require('../loaders/WMOLoader');
const M2RendererGL = require('./M2RendererGL');
const listfile = require('../../casc/listfile');
const WMOShaderMapper = require('../WMOShaderMapper');

const GLContext = require('../gl/GLContext');
const ShaderProgram = require('../gl/ShaderProgram');
const VertexArray = require('../gl/VertexArray');
const GLTexture = require('../gl/GLTexture');

const textureRibbon = require('../../ui/texture-ribbon');

const IDENTITY_MAT4 = new Float32Array([
	1, 0, 0, 0,
	0, 1, 0, 0,
	0, 0, 1, 0,
	0, 0, 0, 1
]);

class WMORendererGL {
	/**
	 * @param {BufferWrapper} data
	 * @param {string|number} fileID
	 * @param {GLContext} gl_context
	 * @param {boolean} [useRibbon=true]
	 */
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

	/**
	 * Load shader program (cached per context)
	 */
	static async load_shaders(ctx) {
		return ctx.get_cached_shader('wmo', (ctx) => {
			const shader_path = constants.SHADER_PATH;
			const vert_source = fs.readFileSync(path.join(shader_path, 'wmo.vertex.shader'), 'utf8');
			const frag_source = fs.readFileSync(path.join(shader_path, 'wmo.fragment.shader'), 'utf8');

			const program = new ShaderProgram(ctx, vert_source, frag_source);
			if (!program.is_valid())
				throw new Error('Failed to compile WMO shader');

			return program;
		});
	}

	async load() {
		// parse WMO data
		this.wmo = new WMOLoader(this.data, this.fileID, true);
		await this.wmo.load();

		// load shader program
		this.shader = await WMORendererGL.load_shaders(this.ctx);

		// create default texture
		this._create_default_texture();

		// load textures
		await this._load_textures();

		// load groups
		await this._load_groups();

		// setup doodad sets
		this._setup_doodad_sets();

		// setup reactive controls
		const view = core.view;
		view.modelViewerWMOGroups = this.groupArray;
		view.modelViewerWMOSets = this.setArray;
		this.groupWatcher = view.$watch('modelViewerWMOGroups', () => this.updateGroups(), { deep: true });
		this.setWatcher = view.$watch('modelViewerWMOSets', () => this.updateSets(), { deep: true });
		this.wireframeWatcher = view.$watch('config.modelViewerWireframe', () => {}, { deep: true });

		// drop reference to raw data
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

		if (this.useRibbon)
			this.syncID = textureRibbon.reset();

		const isClassic = !!wmo.textureNames;

		for (let i = 0; i < materials.length; i++) {
			const material = materials[i];

			const pixelShader = WMOShaderMapper.WMOShaderMap[material.shader].PixelShader;

			// Don't load LOD textures
			if(pixelShader == 18) 
				continue;

			let textureFileDataIDs = [];

			if(isClassic){
				textureFileDataIDs.push(listfile.getByFilename(wmo.textureNames[material.texture1]) || 0);
				textureFileDataIDs.push(listfile.getByFilename(wmo.textureNames[material.texture2]) || 0);
				textureFileDataIDs.push(listfile.getByFilename(wmo.textureNames[material.texture3]) || 0);
			}else{
				textureFileDataIDs.push(material.texture1);
				textureFileDataIDs.push(material.texture2);
				textureFileDataIDs.push(material.texture3);
			}
	
			if(pixelShader == 19) // MapObjParallax
			{
				textureFileDataIDs.push(material.color2);
				textureFileDataIDs.push(material.flags3);
				textureFileDataIDs.push(material.runtimeData[0]);
			} 
			else if(pixelShader == 20)
			{
				textureFileDataIDs.push(material.color3);
				for (const rtdTexture of material.runtimeData)
					textureFileDataIDs.push(rtdTexture);
			}

			this.materialTextures.set(i, textureFileDataIDs);

			for (const textureFileDataID of textureFileDataIDs) {
				if(textureFileDataID == 0)
					continue;

				if (this.textures.has(textureFileDataID))
					continue;
				
				const texture = new Texture(material.flags);
				texture.fileDataID = textureFileDataID;

				const ribbonSlot = this.useRibbon ? textureRibbon.addSlot() : null;
				if (ribbonSlot !== null)
					textureRibbon.setSlotFile(ribbonSlot, textureFileDataID, this.syncID);

				try {
					const data = await texture.getTextureFile();
					const blp = new BLPFile(data);
					const gl_tex = new GLTexture(this.ctx);

					// WMO wrap flags are inverted (0x40/0x80 = clamp)
					const wrap_s = (material.flags & 0x40) ? this.gl.CLAMP_TO_EDGE : this.gl.REPEAT;
					const wrap_t = (material.flags & 0x80) ? this.gl.CLAMP_TO_EDGE : this.gl.REPEAT;

					const pixels = blp.toUInt8Array(0, 0b1111);
					gl_tex.set_rgba(pixels, blp.width, blp.height, {
						wrap_s: wrap_s,
						wrap_t: wrap_t,
						has_alpha: blp.alphaDepth > 0,
						generate_mipmaps: true
					});

					this.textures.set(textureFileDataID, gl_tex);

					if (ribbonSlot !== null)
						textureRibbon.setSlotSrc(ribbonSlot, blp.getDataURL(0b0111), this.syncID);
				} catch (e) {
					log.write('Failed to load WMO texture %d: %s', textureFileDataID, e.message);
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

				// create VAO for this group
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
				let uv2o = null;
				let uv3o = null;
				let uv4o = null;
				if (group.uvs) {
					if(group.uvs[0]) {
						uvo = gl.createBuffer();
						gl.bindBuffer(gl.ARRAY_BUFFER, uvo);
						gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(group.uvs[0]), gl.STATIC_DRAW);
						this.buffers.push(uvo);
					}

					if(group.uvs[1]) {
						uv2o = gl.createBuffer();
						gl.bindBuffer(gl.ARRAY_BUFFER, uv2o);
						gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(group.uvs[1]), gl.STATIC_DRAW);
						this.buffers.push(uv2o);
					}

					if(group.uvs[2]) {
						uv3o = gl.createBuffer();
						gl.bindBuffer(gl.ARRAY_BUFFER, uv3o);
						gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(group.uvs[2]), gl.STATIC_DRAW);
						this.buffers.push(uv3o);
					}	

					if(group.uvs[3]) {
						uv4o = gl.createBuffer();
						gl.bindBuffer(gl.ARRAY_BUFFER, uv4o);
						gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(group.uvs[3]), gl.STATIC_DRAW);
						this.buffers.push(uv4o);
					}
				}

				// Color buffer
				let cbo = null;
				let cbo2 = null;
				if (group.vertexColours) {
					cbo = gl.createBuffer();
					gl.bindBuffer(gl.ARRAY_BUFFER, cbo);
					gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(group.vertexColours), gl.STATIC_DRAW);
					this.buffers.push(cbo);
				}

				if(group.colors2){
					cbo2 = gl.createBuffer();
					gl.bindBuffer(gl.ARRAY_BUFFER, cbo2);
					gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(group.colors2), gl.STATIC_DRAW);
					this.buffers.push(cbo2);
				}

				// index buffer (managed by vao.dispose())
				const ebo = gl.createBuffer();
				gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
				gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(group.indices), gl.STATIC_DRAW);
				vao.ebo = ebo;

				// set up vertex attributes
				// TODO: MOCVx2 + MOC2 in color buffers
				vao.setup_wmo_separate_buffers(vbo, nbo, uvo, cbo, cbo2, uv2o, uv3o, uv4o);

				// build draw calls for each batch
				const draw_calls = [];
				for (const batch of group.renderBatches) {
					const matID = ((batch.flags & 2) === 2) ? batch.possibleBox2[2] : batch.materialID;

					draw_calls.push({
						start: batch.firstFace,
						count: batch.numFaces,
						blendMode: wmo.materials[matID]?.blendMode ?? 0,
						material_id: matID,
						shader: WMOShaderMapper.WMOShaderMap[wmo.materials[matID]?.shader ?? 0]
					});
				}

				this.groups.push({
					vao: vao,
					draw_calls: draw_calls,
					visible: true,
					index: i
				});

				this.groupArray.push({
					label: wmo.groupNames[group.nameOfs] || `Group ${i}`,
					checked: true,
					groupIndex: i
				});
			} catch (e) {
				log.write('Failed to load WMO group %d: %s', i, e.message);
			}
		}
	}

	_setup_doodad_sets() {
		const wmo = this.wmo;
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

	/**
	 * Load a doodad set
	 * @param {number} index
	 */
	async loadDoodadSet(index) {
		const wmo = this.wmo;
		const set = wmo.doodadSets[index];
		const casc = core.view.casc;

		if (!set)
			throw new Error('Invalid doodad set: ' + index);

		log.write('Loading doodad set: %s', set.name);

		using _lock = core.create_busy_lock();
		core.setToast('progress', util.format('Loading doodad set %s (%d doodads)...', set.name, set.doodadCount), null, -1, false);

		const firstIndex = set.firstInstanceIndex;
		const count = set.doodadCount;
		const renderers = [];

		for (let i = 0; i < count; i++) {
			const doodad = wmo.doodads[firstIndex + i];
			let fileDataID = 0;

			if (wmo.fileDataIDs)
				fileDataID = wmo.fileDataIDs[doodad.offset];
			else
				fileDataID = listfile.getByFilename(wmo.doodadNames[doodad.offset]) || 0;

			if (fileDataID > 0) {
				try {
					let renderer;

					if (this.m2_renderers.has(fileDataID)) {
						// reuse existing renderer data
						renderer = this.m2_renderers.get(fileDataID);
					} else {
						const data = await casc.getFile(fileDataID);
						const magic = data.readUInt32LE();
						data.seek(0);

						if (magic === constants.MAGIC.MD21) {
							renderer = new M2RendererGL(data, this.ctx, false, false);
							await renderer.load();
							await renderer.loadSkin(0);
							this.m2_renderers.set(fileDataID, renderer);
						}
					}

					if (renderer) {
						// apply doodad transform (convert WoW coords to WebGL)
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
					log.write('Failed to load doodad %d: %s', fileDataID, e.message);
				}
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

	updateWireframe() {
		// handled in render()
	}

	/**
	 * Set model transformation
	 * @param {number[]} position
	 * @param {number[]} rotation
	 * @param {number[]} scale
	 */
	setTransform(position, rotation, scale) {
		this.position = position;
		this.rotation = rotation;
		this.scale = scale;
		this._update_model_matrix();
	}

	_update_model_matrix() {
		// build model matrix from position/rotation/scale (TRS order)
		const m = this.model_matrix;
		const [px, py, pz] = this.position;
		const [rx, ry, rz] = this.rotation;
		const [sx, sy, sz] = this.scale;

		// rotation (ZYX euler order, column-major)
		const cx = Math.cos(rx), sinx = Math.sin(rx);
		const cy = Math.cos(ry), siny = Math.sin(ry);
		const cz = Math.cos(rz), sinz = Math.sin(rz);

		// column 0 (scaled by sx)
		m[0] = cy * cz * sx;
		m[1] = cy * sinz * sx;
		m[2] = -siny * sx;
		m[3] = 0;

		// column 1 (scaled by sy)
		m[4] = (sinx * siny * cz - cx * sinz) * sy;
		m[5] = (sinx * siny * sinz + cx * cz) * sy;
		m[6] = sinx * cy * sy;
		m[7] = 0;

		// column 2 (scaled by sz)
		m[8] = (cx * siny * cz + sinx * sinz) * sz;
		m[9] = (cx * siny * sinz - sinx * cz) * sz;
		m[10] = cx * cy * sz;
		m[11] = 0;

		// column 3 (translation)
		m[12] = px;
		m[13] = py;
		m[14] = pz;
		m[15] = 1;
	}

	/**
	 * Render the model
	 * @param {Float32Array} view_matrix
	 * @param {Float32Array} projection_matrix
	 */
	render(view_matrix, projection_matrix) {
		if (!this.shader)
			return;

		const gl = this.gl;
		const ctx = this.ctx;
		const shader = this.shader;
		const wireframe = core.view.config.modelViewerWireframe;

		shader.use();

		// set scene uniforms
		shader.set_uniform_mat4('u_view_matrix', false, view_matrix);
		shader.set_uniform_mat4('u_projection_matrix', false, projection_matrix);
		shader.set_uniform_mat4('u_model_matrix', false, this.model_matrix);

		// lighting - transform light direction to view space
		const lx = 0.5, ly = -0.7, lz = 0.5;
		const light_view_x = view_matrix[0] * lx + view_matrix[4] * ly + view_matrix[8] * lz;
		const light_view_y = view_matrix[1] * lx + view_matrix[5] * ly + view_matrix[9] * lz;
		const light_view_z = view_matrix[2] * lx + view_matrix[6] * ly + view_matrix[10] * lz;

		shader.set_uniform_1i('u_apply_lighting', 1);
		shader.set_uniform_3f('u_ambient_color', 0.5, 0.5, 0.5);
		shader.set_uniform_3f('u_diffuse_color', 0.7, 0.7, 0.7);
		shader.set_uniform_3f('u_light_dir', light_view_x, light_view_y, light_view_z);

		// wireframe
		shader.set_uniform_1i('u_wireframe', wireframe ? 1 : 0);
		shader.set_uniform_4f('u_wireframe_color', 1, 1, 1, 1);

		// vertex color
		shader.set_uniform_1i('u_use_vertex_color', 0);

		// texture samplers
		shader.set_uniform_1i('u_texture1', 0);
		shader.set_uniform_1i('u_texture2', 1);
		shader.set_uniform_1i('u_texture3', 2);
		shader.set_uniform_1i('u_texture4', 3);
		shader.set_uniform_1i('u_texture5', 4);
		shader.set_uniform_1i('u_texture6', 5);
		shader.set_uniform_1i('u_texture7', 6);
		shader.set_uniform_1i('u_texture8', 7);
		shader.set_uniform_1i('u_texture9', 8);

		// render state
		ctx.set_depth_test(true);
		ctx.set_depth_write(true);
		ctx.set_cull_face(false);
		ctx.set_blend(false);

		// render each group
		for (const group of this.groups) {
			if (!group.visible)
				continue;

			group.vao.bind();

			for (const dc of group.draw_calls) {
				// set shader mode
				shader.set_uniform_1i('u_vertex_shader', dc.shader.VertexShader);
				shader.set_uniform_1i('u_pixel_shader', dc.shader.PixelShader);

				// set blend mode
				shader.set_uniform_1i('u_blend_mode', dc.blendMode);

				// bind texture
				const textureFileDataIDs = this.materialTextures.get(dc.material_id);
				for(let i = 0; i < 9; i++) {
					const textureFileDataID = textureFileDataIDs[i] || 0;
					const texture = this.textures.get(textureFileDataID) || this.default_texture;
					texture.bind(i);
				}

				// draw
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
		// update doodad animations
		for (const set of this.doodadSets) {
			if (!set || !set.visible)
				continue;

			for (const doodad of set.renderers)
				doodad.renderer.updateAnimation?.(delta_time);
		}
	}

	/**
	 * Get model bounding box (converted from WoW Z-up to WebGL Y-up)
	 * @returns {{ min: number[], max: number[] } | null}
	 */
	getBoundingBox() {
		if (!this.wmo)
			return null;

		const src_min = this.wmo.boundingBox1;
		const src_max = this.wmo.boundingBox2;

		// wow coords: X=right, Y=forward, Z=up
		// webgl coords: X=right, Y=up, Z=forward (negated)
		return {
			min: [src_min[0], src_min[2], -src_max[1]],
			max: [src_max[0], src_max[2], -src_min[1]]
		};
	}

	dispose() {
		// unregister watchers
		this.groupWatcher?.();
		this.setWatcher?.();
		this.wireframeWatcher?.();

		// dispose groups
		for (const group of this.groups)
			group.vao.dispose();

		// dispose buffers
		for (const buf of this.buffers)
			this.gl.deleteBuffer(buf);

		// dispose textures
		for (const tex of this.textures.values())
			tex.dispose();

		this.textures.clear();
		this.materialTextures.clear();

		if (this.default_texture) {
			this.default_texture.dispose();
			this.default_texture = null;
		}

		// dispose M2 renderers
		for (const renderer of this.m2_renderers.values())
			renderer.dispose();

		this.m2_renderers.clear();

		// clear arrays
		if (this.groupArray) this.groupArray.splice(0);
		if (this.setArray) this.setArray.splice(0);

		this.groups = [];
		this.buffers = [];
		this.doodadSets = [];
	}
}

module.exports = WMORendererGL;
