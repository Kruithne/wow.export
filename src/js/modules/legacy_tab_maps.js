const util = require('util');
const crypto = require('crypto');
const path = require('path');
const core = require('../core');
const log = require('../log');
const constants = require('../constants');
const InstallType = require('../install-type');
const DBCReader = require('../db/DBCReader');
const BufferWrapper = require('../buffer');
const BLPFile = require('../casc/blp');
const Shaders = require('../3D/Shaders');
const WDTLoader = require('../3D/loaders/WDTLoader');
const ADTLoader = require('../3D/loaders/ADTLoader');
const ExportHelper = require('../casc/export-helper');
const OBJWriter = require('../3D/writers/OBJWriter');
const MTLWriter = require('../3D/writers/MTLWriter');
const CSVWriter = require('../3D/writers/CSVWriter');
const JSONWriter = require('../3D/writers/JSONWriter');
const PNGWriter = require('../png-writer');
const TiledPNGWriter = require('../tiled-png-writer');
const generics = require('../generics');

const MAP_SIZE = constants.GAME.MAP_SIZE;
const TILE_SIZE = constants.GAME.TILE_SIZE;
const CHUNK_SIZE = TILE_SIZE / 16;
const UNIT_SIZE = CHUNK_SIZE / 8;
const UNIT_SIZE_HALF = UNIT_SIZE / 2;

const TEX0_ATLAS_RES = 1024;
const TEX0_CHUNK_RES = 64;
const TEX0_TILE_REPEAT = 4;
const LEGACY_TEX_SCALE = 2;

let gl_shader_prog;
let gl_canvas;
let gl;

const compile_shaders_legacy = () => {
	const sources = Shaders.get_source('adt_old');
	gl_shader_prog = gl.createProgram();

	const frag_shader = gl.createShader(gl.FRAGMENT_SHADER);
	gl.shaderSource(frag_shader, sources.frag);
	gl.compileShader(frag_shader);

	if (!gl.getShaderParameter(frag_shader, gl.COMPILE_STATUS))
		throw new Error('Failed to compile fragment shader: ' + gl.getShaderInfoLog(frag_shader));

	const vert_shader = gl.createShader(gl.VERTEX_SHADER);
	gl.shaderSource(vert_shader, sources.vert);
	gl.compileShader(vert_shader);

	if (!gl.getShaderParameter(vert_shader, gl.COMPILE_STATUS))
		throw new Error('Failed to compile vertex shader: ' + gl.getShaderInfoLog(vert_shader));

	gl.attachShader(gl_shader_prog, frag_shader);
	gl.attachShader(gl_shader_prog, vert_shader);
	gl.linkProgram(gl_shader_prog);

	if (!gl.getProgramParameter(gl_shader_prog, gl.LINK_STATUS))
		throw new Error('Failed to link shader program: ' + gl.getProgramInfoLog(gl_shader_prog));

	gl.useProgram(gl_shader_prog);
};

const build_texture_array_legacy = (tex_list) => {
	const target_size = 512;
	const tex_array = gl.createTexture();

	gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex_array);
	gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA, target_size, target_size, tex_list.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

	for (let i = 0; i < tex_list.length; i++) {
		const data = get_mpq_file(tex_list[i]);
		if (!data)
			continue;

		const blp = new BLPFile(data);
		const blp_rgba = blp.toUInt8Array(0);

		if (blp.width === target_size && blp.height === target_size) {
			gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, target_size, target_size, 1, gl.RGBA, gl.UNSIGNED_BYTE, blp_rgba);
		} else {
			const resized = new Uint8Array(target_size * target_size * 4);
			const scale_x = blp.width / target_size;
			const scale_y = blp.height / target_size;

			for (let y = 0; y < target_size; y++) {
				for (let x = 0; x < target_size; x++) {
					const src_x = Math.floor(x * scale_x);
					const src_y = Math.floor(y * scale_y);
					const src_idx = (src_y * blp.width + src_x) * 4;
					const dst_idx = (y * target_size + x) * 4;

					resized[dst_idx] = blp_rgba[src_idx];
					resized[dst_idx + 1] = blp_rgba[src_idx + 1];
					resized[dst_idx + 2] = blp_rgba[src_idx + 2];
					resized[dst_idx + 3] = blp_rgba[src_idx + 3];
				}
			}

			gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, target_size, target_size, 1, gl.RGBA, gl.UNSIGNED_BYTE, resized);
		}
	}

	gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
	return tex_array;
};

const fix_alpha_layer = (layer, needs_fix) => {
	if (!needs_fix)
		return layer;

	const fixed = new Array(64 * 64);
	for (let j = 0; j < 64 * 64; j++) {
		const is_last_col = (j % 64) === 63;
		const is_last_row = j >= 63 * 64;

		if (is_last_col && !is_last_row)
			fixed[j] = layer[j - 1];
		else if (is_last_row)
			fixed[j] = layer[j - 64];
		else
			fixed[j] = layer[j];
	}

	return fixed;
};

const bind_alpha_layer = (layer) => {
	const texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);

	const data = new Uint8Array(layer.length * 4);
	for (let i = 0, j = 0, n = layer.length; i < n; i++, j += 4)
		data[j] = data[j + 1] = data[j + 2] = data[j + 3] = layer[i];

	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 64, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
	gl.generateMipmap(gl.TEXTURE_2D);

	return texture;
};

const unbind_all_textures = () => {
	for (let i = 0, n = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS); i < n; i++) {
		gl.activeTexture(gl.TEXTURE0 + i);
		gl.bindTexture(gl.TEXTURE_2D, null);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
	}
};

const clear_canvas = () => {
	gl.viewport(0, 0, gl_canvas.width, gl_canvas.height);
	gl.clearColor(0, 0, 0, 1);
	gl.clear(gl.COLOR_BUFFER_BIT);
};

let selected_map_id = null;
let selected_map_dir = null;
let selected_map_name = null;
let selected_wdt = null;
let minimap_translate = null;

const get_mpq_file = (file_path) => {
	const raw = core.view.mpq.getFile(file_path);
	if (!raw)
		return null;

	return new BufferWrapper(Buffer.from(raw));
};

const load_minimap_translate = () => {
	const trs_paths = [
		'textures\\Minimap\\md5translate.trs',
		'textures\\minimap\\md5translate.trs'
	];

	let raw = null;
	for (const trs_path of trs_paths) {
		raw = core.view.mpq.getFile(trs_path);
		if (raw)
			break;
	}

	if (!raw) {
		log.write('md5translate.trs not found in MPQ');
		return new Map();
	}

	const text = new TextDecoder('utf-8').decode(raw);
	const lines = text.split(/[\r\n]+/);
	const lookup = new Map();

	for (const line of lines) {
		if (line.length === 0 || line.startsWith('dir'))
			continue;

		const tab_idx = line.indexOf('\t');
		if (tab_idx === -1)
			continue;

		const target = line.substring(0, tab_idx).trim().toLowerCase();
		const source = line.substring(tab_idx + 1).trim();

		if (target.length > 0 && source.length > 0)
			lookup.set(target, source);
	}

	log.write('loaded minimap translate table: %d entries', lookup.size);
	return lookup;
};

const parse_map_entry = (entry) => {
	const match = entry.match(/\[(\d+)\]\31([^\31]+)\31\(([^)]+)\)/);
	if (!match)
		throw new Error('unexpected map entry');

	return { id: parseInt(match[1]), name: match[2], dir: match[3] };
};

const load_map_tile = async (x, y, size) => {
	if (!selected_map_dir)
		return false;

	try {
		const padded_x = x.toString().padStart(2, '0');
		const padded_y = y.toString().padStart(2, '0');
		const tile_key = util.format('%s\\map%s_%s.blp', selected_map_dir, padded_x, padded_y);

		let data = null;

		// modern path (world\minimaps\<dir>\mapXX_YY.blp)
		const direct_path = 'world\\minimaps\\' + tile_key;
		data = get_mpq_file(direct_path);

		// md5translate fallback for pre-cata clients
		if (!data && minimap_translate) {
			const hash_file = minimap_translate.get(tile_key);
			if (hash_file)
				data = get_mpq_file('textures\\minimap\\' + hash_file);
		}

		if (!data)
			return false;

		const blp = new BLPFile(data);
		const canvas = blp.toCanvas(0b0111);

		const scale = size / blp.scaledWidth;
		const scaled = document.createElement('canvas');
		scaled.width = size;
		scaled.height = size;

		const ctx = scaled.getContext('2d');
		ctx.scale(scale, scale);
		ctx.drawImage(canvas, 0, 0);

		return ctx.getImageData(0, 0, size, size);
	} catch (e) {
		return false;
	}
};

const load_legacy_adt = (map_dir, tile_y, tile_x) => {
	const adt_path = util.format('world\\maps\\%s\\%s_%d_%d.adt', map_dir, map_dir, tile_y, tile_x);
	const data = get_mpq_file(adt_path);
	if (!data)
		return null;

	const adt = new ADTLoader(data);

	// monolithic pre-cata ADT: load root chunks (geometry)
	adt.loadRoot(true);

	// rewind and load obj chunks (M2/WMO placements)
	data.seek(0);
	adt.loadObj();

	// rewind and load tex chunks (texture layers/alpha maps)
	data.seek(0);
	adt.loadTex(selected_wdt ?? { flags: 0 }, true);

	return adt;
};

const calculate_required_images = (layer_count) => {
	if (layer_count <= 1)
		return 0;

	return Math.ceil((layer_count - 1) / 4);
};

const load_blp_from_mpq = (texture_path) => {
	const data = get_mpq_file(texture_path);
	if (!data)
		return null;

	const blp = new BLPFile(data);
	return { pixels: blp.toUInt8Array(0, 0b0111), width: blp.scaledWidth, height: blp.scaledHeight };
};

const composite_tex0_legacy = (adt) => {
	const tex_names = adt.textures;
	if (!tex_names || Object.keys(tex_names).length === 0)
		return null;

	const tex_list = Object.values(tex_names);
	const textures = new Array(tex_list.length);
	for (let i = 0; i < tex_list.length; i++)
		textures[i] = load_blp_from_mpq(tex_list[i]);

	const atlas = new Uint8Array(TEX0_ATLAS_RES * TEX0_ATLAS_RES * 4);

	for (let cx = 0; cx < 16; cx++) {
		for (let cy = 0; cy < 16; cy++) {
			const chunk = adt.texChunks[cx * 16 + cy];
			if (!chunk?.layers || chunk.layers.length === 0)
				continue;

			const layers = chunk.layers;
			const alpha_layers = chunk.alphaLayers;
			const base_px = cy * TEX0_CHUNK_RES;
			const base_py = cx * TEX0_CHUNK_RES;

			for (let py = 0; py < TEX0_CHUNK_RES; py++) {
				for (let px = 0; px < TEX0_CHUNK_RES; px++) {
					const u = (px / TEX0_CHUNK_RES) * TEX0_TILE_REPEAT;
					const v = (py / TEX0_CHUNK_RES) * TEX0_TILE_REPEAT;

					let r = 0, g = 0, b = 0;

					for (let li = 0; li < layers.length; li++) {
						const tex = textures[layers[li].textureId];
						if (!tex)
							continue;

						const tx = Math.floor(u * tex.width) % tex.width;
						const ty = Math.floor(v * tex.height) % tex.height;
						const ti = (ty * tex.width + tx) * 4;

						if (li === 0) {
							r = tex.pixels[ti];
							g = tex.pixels[ti + 1];
							b = tex.pixels[ti + 2];
						} else {
							const a = alpha_layers?.[li] ? alpha_layers[li][py * 64 + px] / 255 : 0;
							r += (tex.pixels[ti] - r) * a;
							g += (tex.pixels[ti + 1] - g) * a;
							b += (tex.pixels[ti + 2] - b) * a;
						}
					}

					const dst = ((base_py + py) * TEX0_ATLAS_RES + (base_px + px)) * 4;
					atlas[dst] = r;
					atlas[dst + 1] = g;
					atlas[dst + 2] = b;
					atlas[dst + 3] = 255;
				}
			}
		}
	}

	return atlas;
};

const export_alpha_maps = async (adt, tile_id, dir, config) => {
	const tex_names = adt.textures;
	if (!tex_names || Object.keys(tex_names).length === 0)
		return;

	const is_splitting = config.splitAlphaMaps;
	const use_posix = config.pathFormat === 'posix';

	// export raw diffuse textures and build material metadata
	const tex_list = Object.values(tex_names);
	const materials = new Array(tex_list.length);
	for (let i = 0; i < tex_list.length; i++) {
		const tex_path = tex_list[i];
		const base_name = path.basename(tex_path).replace(/\.blp$/i, '.png');
		let tex_file, tex_out_path;

		if (config.enableSharedTextures) {
			tex_out_path = ExportHelper.getExportPath(tex_path.replace(/\.blp$/i, '.png'));
			tex_file = path.relative(dir, tex_out_path);
		} else {
			tex_out_path = path.join(dir, base_name);
			tex_file = base_name;
		}

		if (config.overwriteFiles || !await generics.fileExists(tex_out_path)) {
			const data = get_mpq_file(tex_path);
			if (data) {
				const blp = new BLPFile(data);
				await blp.saveToPNG(tex_out_path);
			}
		}

		materials[i] = {
			file: use_posix ? ExportHelper.win32ToPosix(tex_file) : tex_file,
			source: tex_path,
			scale: 1
		};
	}

	const chunks = adt.texChunks;
	const chunk_count = chunks.length;
	const layers = [];

	if (is_splitting) {
		for (let chunk_index = 0; chunk_index < chunk_count; chunk_index++) {
			const tex_chunk = chunks[chunk_index];
			if (!tex_chunk?.layers)
				continue;

			const root_chunk = adt.chunks[chunk_index];
			const fix_alpha = !(root_chunk.flags & (1 << 15));
			const alpha_layers = tex_chunk.alphaLayers || [];
			const required_images = calculate_required_images(alpha_layers.length);
			const prefix = tile_id + '_' + chunk_index;

			for (let image_index = 0; image_index < Math.max(1, required_images); image_index++) {
				const png = new PNGWriter(64, 64);
				const pixel_data = png.getPixelData();

				for (let j = 0; j < 64 * 64; j++) {
					const po = j * 4;
					pixel_data[po] = 0;
					pixel_data[po + 1] = 0;
					pixel_data[po + 2] = 0;
					pixel_data[po + 3] = 255;
				}

				const start_layer = (image_index * 4) + 1;
				const end_layer = Math.min(start_layer + 4, alpha_layers.length);

				for (let li = start_layer; li < end_layer; li++) {
					const layer = alpha_layers[li];
					const channel = li - start_layer;

					for (let j = 0; j < layer.length; j++) {
						const is_last_col = (j % 64) === 63;
						const is_last_row = j >= 63 * 64;

						if (fix_alpha) {
							if (is_last_col && !is_last_row)
								pixel_data[(j * 4) + channel] = layer[j - 1];
							else if (is_last_row)
								pixel_data[(j * 4) + channel] = layer[j - 64];
							else
								pixel_data[(j * 4) + channel] = layer[j];
						} else {
							pixel_data[(j * 4) + channel] = layer[j];
						}
					}
				}

				const suffix = image_index === 0 ? '' : '_' + image_index;
				await png.write(path.join(dir, 'tex_' + prefix + suffix + '.png'));
			}

			// json metadata per chunk
			const chunk_layers = [];
			for (let i = 0; i < tex_chunk.layers.length; i++) {
				const layer = tex_chunk.layers[i];
				const mat = materials[layer.textureId];
				if (!mat)
					continue;

				chunk_layers.push(Object.assign({
					index: i,
					effectID: layer.effectID,
					imageIndex: i === 0 ? 0 : Math.floor((i - 1) / 4),
					channelIndex: i === 0 ? -1 : (i - 1) % 4
				}, mat));
			}

			const json = new JSONWriter(path.join(dir, 'tex_' + prefix + '.json'));
			json.addProperty('layers', chunk_layers);
			await json.write();
		}
	} else {
		// combined alpha maps
		let max_layers_needed = 1;
		for (let chunk_index = 0; chunk_index < chunk_count; chunk_index++) {
			const tex_chunk = chunks[chunk_index];
			const alpha_layers = tex_chunk?.alphaLayers || [];
			max_layers_needed = Math.max(max_layers_needed, calculate_required_images(alpha_layers.length));
		}

		for (let image_index = 0; image_index < max_layers_needed; image_index++) {
			const png = new PNGWriter(64 * 16, 64 * 16);
			const pixel_data = png.getPixelData();

			for (let i = 0; i < pixel_data.length; i += 4) {
				pixel_data[i] = 0;
				pixel_data[i + 1] = 0;
				pixel_data[i + 2] = 0;
				pixel_data[i + 3] = 255;
			}

			for (let chunk_index = 0; chunk_index < chunk_count; chunk_index++) {
				const tex_chunk = chunks[chunk_index];
				if (!tex_chunk?.alphaLayers)
					continue;

				const root_chunk = adt.chunks[chunk_index];
				const fix_alpha = !(root_chunk.flags & (1 << 15));
				const alpha_layers = tex_chunk.alphaLayers;

				const chunk_x = chunk_index % 16;
				const chunk_y = Math.floor(chunk_index / 16);

				const start_layer = (image_index * 4) + 1;
				const end_layer = Math.min(start_layer + 4, alpha_layers.length);

				for (let li = start_layer; li < end_layer; li++) {
					const layer = alpha_layers[li];
					const channel = li - start_layer;

					for (let j = 0; j < layer.length; j++) {
						const local_x = j % 64;
						const local_y = Math.floor(j / 64);
						const global_x = chunk_x * 64 + local_x;
						const global_y = chunk_y * 64 + local_y;
						const idx = (global_y * (64 * 16) + global_x) * 4 + channel;

						const is_last_col = local_x === 63;
						const is_last_row = local_y === 63;

						if (fix_alpha) {
							if (is_last_col && !is_last_row)
								pixel_data[idx] = layer[j - 1];
							else if (is_last_row)
								pixel_data[idx] = layer[j - 64];
							else
								pixel_data[idx] = layer[j];
						} else {
							pixel_data[idx] = layer[j];
						}
					}
				}
			}

			const suffix = image_index === 0 ? '' : '_' + image_index;
			await png.write(path.join(dir, 'tex_' + tile_id + suffix + '.png'));
		}

		// combined json metadata
		for (let chunk_index = 0; chunk_index < chunk_count; chunk_index++) {
			const tex_chunk = chunks[chunk_index];
			if (!tex_chunk?.layers)
				continue;

			for (let i = 0; i < tex_chunk.layers.length; i++) {
				const layer = tex_chunk.layers[i];
				const mat = materials[layer.textureId];
				if (!mat)
					continue;

				layers.push(Object.assign({
					index: i,
					chunkIndex: chunk_index,
					effectID: layer.effectID,
					imageIndex: i === 0 ? 0 : Math.floor((i - 1) / 4),
					channelIndex: i === 0 ? -1 : (i - 1) % 4
				}, mat));
			}
		}

		const json = new JSONWriter(path.join(dir, 'tex_' + tile_id + '.json'));
		json.addProperty('layers', layers);
		await json.write();
	}
};

const resolve_m2_filename = (adt, model) => {
	if (!adt.m2Names || !adt.m2Offsets)
		return null;

	return adt.m2Names[adt.m2Offsets[model.mmidEntry]] ?? null;
};

const resolve_wmo_filename = (adt, model) => {
	if (!adt.wmoNames || !adt.wmoOffsets)
		return null;

	return adt.wmoNames[adt.wmoOffsets[model.mwidEntry]] ?? null;
};

const export_terrain_obj = async (map_dir, tile_index, dir, config, helper, quality) => {
	const tile_x = tile_index % MAP_SIZE;
	const tile_y = Math.floor(tile_index / MAP_SIZE);
	const tile_id = tile_y + '_' + tile_x;

	const adt = load_legacy_adt(map_dir, tile_y, tile_x);
	if (!adt || !adt.chunks)
		throw new Error('failed to load ADT');

	const obj_out = path.join(dir, 'adt_' + tile_id + '.obj');
	const obj = new OBJWriter(obj_out);
	const mtl = new MTLWriter(path.join(dir, 'adt_' + tile_id + '.mtl'));

	const vertices = [];
	const normals = [];
	const uvs = [];
	const uvs_bake = [];
	const vertex_colors = [];
	const chunk_meshes = new Array(256);

	const first_chunk = adt.chunks[0];
	const first_chunk_x = first_chunk.position[0];
	const first_chunk_y = first_chunk.position[1];
	const include_holes = config.mapsIncludeHoles;
	const is_gpu_bake = quality >= 1024;
	const is_alpha_maps = quality === -1;
	const is_tex0 = quality === -2;
	const is_splitting_alpha = is_alpha_maps && config.splitAlphaMaps;

	let ofs = 0;
	let chunk_id = 0;

	for (let x = 0, mid_x = 0; x < 16; x++) {
		for (let y = 0; y < 16; y++) {
			const indices = [];
			const chunk_index = x * 16 + y;
			const chunk = adt.chunks[chunk_index];

			if (!chunk || !chunk.vertices)
				continue;

			const chunk_x = chunk.position[0];
			const chunk_y = chunk.position[1];
			const chunk_z = chunk.position[2];

			for (let row = 0, idx = 0; row < 17; row++) {
				const is_short = !!(row % 2);
				const col_count = is_short ? 8 : 9;

				for (let col = 0; col < col_count; col++) {
					let vx = chunk_y - (col * UNIT_SIZE);
					let vy = chunk.vertices[idx] + chunk_z;
					let vz = chunk_x - (row * UNIT_SIZE_HALF);

					if (is_short)
						vx -= UNIT_SIZE_HALF;

					vertices.push(vx, vy, vz);

					const normal = chunk.normals[idx];
					normals.push(normal[0] / 127, normal[1] / 127, normal[2] / 127);

					if (is_splitting_alpha) {
						const uv_idx = is_short ? col + 0.5 : col;
						uvs.push(uv_idx / 8, 1 - (row / 16));
					} else {
						const uv_raw_u = -(vx - first_chunk_x) / TILE_SIZE;
						const uv_raw_v = (vz - first_chunk_y) / TILE_SIZE;
						uvs.push(uv_raw_u, uv_raw_v);

						if (is_gpu_bake)
							uvs_bake.push(uv_raw_u, uv_raw_v);
					}

					if (is_gpu_bake) {

						if (chunk.vertexShading) {
							const color = chunk.vertexShading[idx];
							vertex_colors.push(color.b / 255, color.g / 255, color.r / 255, color.a / 255);
						} else {
							vertex_colors.push(0.5, 0.5, 0.5, 1);
						}
					}

					idx++;
					mid_x++;
				}
			}

			const holes_high_res = chunk.holesHighRes;
			for (let j = 9, xx = 0, yy = 0; j < 145; j++, xx++) {
				if (xx >= 8) {
					xx = 0;
					yy++;
				}

				let is_hole = false;
				if (include_holes) {
					if (!(chunk.flags & 0x10000)) {
						const current = Math.trunc(Math.pow(2, Math.floor(xx / 2) + Math.floor(yy / 2) * 4));
						if (chunk.holesLowRes & current)
							is_hole = true;
					} else {
						if ((holes_high_res[yy] >> xx) & 1)
							is_hole = true;
					}
				}

				if (!is_hole) {
					const ind_ofs = ofs + j;
					indices.push(ind_ofs, ind_ofs - 9, ind_ofs + 8);
					indices.push(ind_ofs, ind_ofs - 8, ind_ofs - 9);
					indices.push(ind_ofs, ind_ofs + 9, ind_ofs - 8);
					indices.push(ind_ofs, ind_ofs + 8, ind_ofs + 9);
				}

				if (!((j + 1) % (9 + 8)))
					j += 9;
			}

			ofs = mid_x;
			chunk_meshes[chunk_index] = indices;

			if (is_splitting_alpha) {
				const obj_name = tile_id + '_' + chunk_id;
				const mat_name = 'tex_' + obj_name;
				mtl.addMaterial(mat_name, mat_name + '.png');
				obj.addMesh(obj_name, indices, mat_name);
			} else {
				obj.addMesh(chunk_id, indices, 'tex_' + tile_id);
			}

			chunk_id++;
		}
	}

	if (is_alpha_maps) {
		await export_alpha_maps(adt, tile_id, dir, config);

		if (!config.splitAlphaMaps)
			mtl.addMaterial('tex_' + tile_id, 'tex_' + tile_id + '.png');
	} else if (is_tex0) {
		const tex_file = 'tex_' + tile_id + '.png';
		const tex_out_path = path.join(dir, tex_file);

		if (config.overwriteFiles || !await generics.fileExists(tex_out_path)) {
			const atlas = composite_tex0_legacy(adt);
			if (atlas) {
				const png = new PNGWriter(TEX0_ATLAS_RES, TEX0_ATLAS_RES);
				png.getPixelData().set(atlas);
				await png.write(tex_out_path);
			}
		}

		if (await generics.fileExists(path.join(dir, tex_file)))
			mtl.addMaterial('tex_' + tile_id, tex_file);
	} else if (is_gpu_bake) {
		const tex_file = 'tex_' + tile_id + '.png';
		const tex_out_path = path.join(dir, tex_file);

		if (config.overwriteFiles || !await generics.fileExists(tex_out_path)) {
			if (!gl) {
				gl_canvas = document.createElement('canvas');
				gl = gl_canvas.getContext('webgl2');

				if (!gl)
					throw new Error('WebGL2 not supported');

				compile_shaders_legacy();
			}

			const tex_names = adt.textures;
			const tex_list = tex_names ? Object.values(tex_names) : [];

			const diffuse_array = build_texture_array_legacy(tex_list);

			const a_vertex_position = gl.getAttribLocation(gl_shader_prog, 'aVertexPosition');
			const a_tex_coord = gl.getAttribLocation(gl_shader_prog, 'aTextureCoord');
			const a_vertex_color = gl.getAttribLocation(gl_shader_prog, 'aVertexColor');

			const u_diffuse_layers = gl.getUniformLocation(gl_shader_prog, 'uDiffuseLayers');
			const u_height_layers = gl.getUniformLocation(gl_shader_prog, 'uHeightLayers');
			const u_layer_count = gl.getUniformLocation(gl_shader_prog, 'uLayerCount');

			const u_alpha_blends = [];
			for (let i = 0; i < 7; i++)
				u_alpha_blends[i] = gl.getUniformLocation(gl_shader_prog, 'uAlphaBlend' + i);

			const u_translation = gl.getUniformLocation(gl_shader_prog, 'uTranslation');
			const u_resolution = gl.getUniformLocation(gl_shader_prog, 'uResolution');
			const u_zoom = gl.getUniformLocation(gl_shader_prog, 'uZoom');

			gl_canvas.width = quality / 16;
			gl_canvas.height = quality / 16;

			const rotate_canvas = new OffscreenCanvas(gl_canvas.width, gl_canvas.height);
			const rotate_ctx = rotate_canvas.getContext('2d');
			rotate_ctx.translate(rotate_canvas.width / 2, rotate_canvas.height / 2);
			rotate_ctx.rotate(Math.PI);

			const composite = new OffscreenCanvas(quality, quality);
			const composite_ctx = composite.getContext('2d');

			clear_canvas();

			gl.uniform2f(u_resolution, TILE_SIZE, TILE_SIZE);

			const vertex_buffer = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
			gl.enableVertexAttribArray(a_vertex_position);
			gl.vertexAttribPointer(a_vertex_position, 3, gl.FLOAT, false, 0, 0);

			const uv_buffer = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, uv_buffer);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs_bake), gl.STATIC_DRAW);
			gl.enableVertexAttribArray(a_tex_coord);
			gl.vertexAttribPointer(a_tex_coord, 2, gl.FLOAT, false, 0, 0);

			const vc_buffer = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, vc_buffer);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertex_colors), gl.STATIC_DRAW);
			gl.enableVertexAttribArray(a_vertex_color);
			gl.vertexAttribPointer(a_vertex_color, 4, gl.FLOAT, false, 0, 0);

			const delta_x = first_chunk.position[1] - TILE_SIZE;
			const delta_y = first_chunk.position[0] - TILE_SIZE;

			gl.uniform1f(u_zoom, 0.0625);

			unbind_all_textures();

			const tile_size = quality / 16;

			for (let x = 0; x < 16; x++) {
				for (let y = 0; y < 16; y++) {
					clear_canvas();

					const ofs_x = -delta_x - (CHUNK_SIZE * 7.5) + (y * CHUNK_SIZE);
					const ofs_y = -delta_y - (CHUNK_SIZE * 7.5) + (x * CHUNK_SIZE);

					gl.uniform2f(u_translation, ofs_x, ofs_y);

					const chunk_index = x * 16 + y;
					const tex_chunk = adt.texChunks[chunk_index];
					const indices = chunk_meshes[chunk_index];

					if (!indices || !tex_chunk?.layers)
						continue;

					const tex_layers = tex_chunk.layers;
					const chunk_layer_count = Math.min(tex_layers.length, 8);
					gl.uniform1i(u_layer_count, chunk_layer_count);

					unbind_all_textures();

					gl.activeTexture(gl.TEXTURE0);
					gl.bindTexture(gl.TEXTURE_2D_ARRAY, diffuse_array);
					gl.uniform1i(u_diffuse_layers, 0);

					// bind same array as height (unused by legacy shader but uniform must be valid)
					gl.activeTexture(gl.TEXTURE1);
					gl.bindTexture(gl.TEXTURE_2D_ARRAY, diffuse_array);
					gl.uniform1i(u_height_layers, 1);

					// bind alpha layers
					const root_chunk = adt.chunks[chunk_index];
					const needs_fix = !(root_chunk.flags & (1 << 15));
					const alpha_layers = tex_chunk.alphaLayers || [];
					const alpha_textures = new Array(8);

					for (let i = 1; i < Math.min(alpha_layers.length, 8); i++) {
						gl.activeTexture(gl.TEXTURE0 + 2 + (i - 1));
						const alpha_tex = bind_alpha_layer(fix_alpha_layer(alpha_layers[i], needs_fix));
						gl.bindTexture(gl.TEXTURE_2D, alpha_tex);
						gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
						gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
						alpha_textures[i - 1] = alpha_tex;
					}

					for (let i = 0; i < 7; i++)
						gl.uniform1i(u_alpha_blends[i], 2 + i);

					// per-layer uniforms
					const layer_scales = new Array(8).fill(LEGACY_TEX_SCALE);
					const height_scales = new Array(8).fill(0);
					const height_offsets = new Array(8).fill(1);
					const diffuse_indices = new Array(8).fill(0);
					const height_indices = new Array(8).fill(0);

					for (let i = 0; i < chunk_layer_count; i++) {
						diffuse_indices[i] = tex_layers[i].textureId;
						height_indices[i] = tex_layers[i].textureId;
					}

					for (let i = 0; i < 8; i++) {
						gl.uniform1f(gl.getUniformLocation(gl_shader_prog, `uLayerScales[${i}]`), layer_scales[i]);
						gl.uniform1f(gl.getUniformLocation(gl_shader_prog, `uHeightScales[${i}]`), height_scales[i]);
						gl.uniform1f(gl.getUniformLocation(gl_shader_prog, `uHeightOffsets[${i}]`), height_offsets[i]);
						gl.uniform1f(gl.getUniformLocation(gl_shader_prog, `uDiffuseIndices[${i}]`), diffuse_indices[i]);
						gl.uniform1f(gl.getUniformLocation(gl_shader_prog, `uHeightIndices[${i}]`), height_indices[i]);
					}

					const index_buffer = gl.createBuffer();
					gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index_buffer);
					gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
					gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);

					for (const tex of alpha_textures) {
						if (tex)
							gl.deleteTexture(tex);
					}

					// composite chunk into tile
					rotate_ctx.drawImage(gl_canvas, -(rotate_canvas.width / 2), -(rotate_canvas.height / 2));

					const chunk_x = chunk_index % 16;
					const chunk_y = Math.floor(chunk_index / 16);
					composite_ctx.drawImage(rotate_canvas, chunk_x * tile_size, chunk_y * tile_size);
				}
			}

			gl.deleteTexture(diffuse_array);
			gl.bindBuffer(gl.ARRAY_BUFFER, null);

			const buf = await BufferWrapper.fromCanvas(composite, 'image/png');
			await buf.writeToFile(tex_out_path);
		}

		mtl.addMaterial('tex_' + tile_id, 'tex_' + tile_id + '.png');
	} else if (quality !== 0) {
		// minimap-based texture
		const padded_x = tile_y.toString().padStart(2, '0');
		const padded_y = tile_x.toString().padStart(2, '0');
		const tile_key = util.format('%s\\map%s_%s.blp', map_dir, padded_x, padded_y);

		let minimap_data = get_mpq_file('world\\minimaps\\' + tile_key);
		if (!minimap_data && minimap_translate) {
			const hash_file = minimap_translate.get(tile_key);
			if (hash_file)
				minimap_data = get_mpq_file('textures\\minimap\\' + hash_file);
		}

		if (minimap_data) {
			const tex_file = 'tex_' + tile_id + '.png';
			const tex_out_path = path.join(dir, tex_file);

			if (config.overwriteFiles || !await generics.fileExists(tex_out_path)) {
				const blp = new BLPFile(minimap_data);
				await blp.saveToPNG(tex_out_path);
			}

			mtl.addMaterial('tex_' + tile_id, tex_file);
		}
	}

	obj.setVertArray(vertices);
	obj.setNormalArray(normals);
	obj.addUVArray(uvs);

	if (!mtl.isEmpty)
		obj.setMaterialLibrary(path.basename(mtl.out));

	await obj.write(config.overwriteFiles);
	await mtl.write(config.overwriteFiles);

	// export M2/WMO placements
	if (config.mapsIncludeWMO || config.mapsIncludeM2)
		await export_placements(adt, map_dir, tile_id, dir, config, helper);

	return obj_out;
};

const export_placements = async (adt, map_dir, tile_id, dir, config, helper) => {
	const csv_path = path.join(dir, 'adt_' + tile_id + '_ModelPlacementInformation.csv');
	if (!config.overwriteFiles && await generics.fileExists(csv_path))
		return;

	const csv = new CSVWriter(csv_path);
	csv.addField('ModelFile', 'PositionX', 'PositionY', 'PositionZ', 'RotationX', 'RotationY', 'RotationZ', 'RotationW', 'ScaleFactor', 'ModelId', 'Type', 'SourceFile');

	const exported_files = new Set();
	const use_posix = config.pathFormat === 'posix';

	if (config.mapsIncludeM2 && adt.models) {
		helper?.setCurrentTaskName('Tile ' + tile_id + ', doodads');
		helper?.setCurrentTaskMax(adt.models.length);

		for (let i = 0; i < adt.models.length; i++) {
			helper?.setCurrentTaskValue(i);

			const model = adt.models[i];
			const filename = resolve_m2_filename(adt, model);
			if (!filename)
				continue;

			// extract raw M2 file
			if (!exported_files.has(filename)) {
				const raw = core.view.mpq.getFile(filename);
				if (raw) {
					const out_name = path.basename(filename);
					const out_path = path.join(dir, out_name);

					if (config.overwriteFiles || !await generics.fileExists(out_path)) {
						const buf = new BufferWrapper(Buffer.from(raw));
						await buf.writeToFile(out_path);
					}

					exported_files.add(filename);
				}
			}

			let model_file = path.basename(filename);
			if (use_posix)
				model_file = ExportHelper.win32ToPosix(model_file);

			csv.addRow({
				ModelFile: model_file,
				PositionX: model.position[0],
				PositionY: model.position[1],
				PositionZ: model.position[2],
				RotationX: model.rotation[0],
				RotationY: model.rotation[1],
				RotationZ: model.rotation[2],
				RotationW: 0,
				ScaleFactor: model.scale / 1024,
				ModelId: model.uniqueId,
				Type: 'm2',
				SourceFile: filename
			});
		}
	}

	if (config.mapsIncludeWMO && adt.worldModels) {
		helper?.setCurrentTaskName('Tile ' + tile_id + ', WMOs');
		helper?.setCurrentTaskMax(adt.worldModels.length);

		for (let i = 0; i < adt.worldModels.length; i++) {
			helper?.setCurrentTaskValue(i);

			const model = adt.worldModels[i];
			const filename = resolve_wmo_filename(adt, model);
			if (!filename)
				continue;

			// extract raw WMO root file
			if (!exported_files.has(filename)) {
				const raw = core.view.mpq.getFile(filename);
				if (raw) {
					const out_name = path.basename(filename);
					const out_path = path.join(dir, out_name);

					if (config.overwriteFiles || !await generics.fileExists(out_path)) {
						const buf = new BufferWrapper(Buffer.from(raw));
						await buf.writeToFile(out_path);
					}

					exported_files.add(filename);
				}
			}

			let model_file = path.basename(filename);
			if (use_posix)
				model_file = ExportHelper.win32ToPosix(model_file);

			csv.addRow({
				ModelFile: model_file,
				PositionX: model.position[0],
				PositionY: model.position[1],
				PositionZ: model.position[2],
				RotationX: model.rotation[0],
				RotationY: model.rotation[1],
				RotationZ: model.rotation[2],
				RotationW: 0,
				ScaleFactor: model.scale / 1024,
				ModelId: model.uniqueId,
				Type: 'wmo',
				SourceFile: filename
			});
		}
	}

	await csv.write();
};

module.exports = {
	register() {
		this.registerNavButton('Maps', 'map.svg', InstallType.MPQ);
	},

	template: `
		<div class="tab list-tab" id="tab-maps">
			<div class="map-placeholder"></div>
			<div class="list-container" id="maps-list-container">
				<component :is="$components.ListboxMaps" id="listbox-maps" class="listbox-icons" v-model:selection="$core.view.selectionMaps" :items="$core.view.mapViewerMaps" :filter="$core.view.userInputFilterMaps" :expansion-filter="-1" :keyinput="true" :single="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="map" persistscrollkey="maps" @contextmenu="handle_map_context"></component>
				<component :is="$components.ContextMenu" :node="$core.view.contextMenus.nodeMap" v-slot:default="context" @close="$core.view.contextMenus.nodeMap = null">
					<span @click.self="copy_map_names(context.node.selection)">Copy map name{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="copy_map_internal_names(context.node.selection)">Copy internal name{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="copy_map_ids(context.node.selection)">Copy map ID{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="copy_map_export_paths(context.node.selection)">Copy export path{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="open_map_export_directory(context.node.selection)">Open export directory</span>
				</component>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="$core.view.userInputFilterMaps" placeholder="Filter maps..."/>
			</div>
			<component :is="$components.MapViewer" :map="$core.view.mapViewerSelectedMap" :loader="$core.view.mapViewerTileLoader" :tile-size="512" :zoom="12" :mask="$core.view.mapViewerChunkMask" :grid-size="$core.view.mapViewerGridSize" v-model:selection="$core.view.mapViewerSelection" :selectable="true"></component>
			<div class="spaced-preview-controls">
				<component :is="$components.MenuButton" :options="menuButtonExport" :default="$core.view.config.exportMapFormat" @change="$core.view.config.exportMapFormat = $event" :disabled="$core.view.isBusy || $core.view.mapViewerSelection.length === 0" @click="export_map"></component>
			</div>

			<div id="maps-sidebar" class="sidebar">
				<span class="header">Export Options</span>
				<label class="ui-checkbox" title="Include WMO objects (large objects such as buildings)">
					<input type="checkbox" v-model="$core.view.config.mapsIncludeWMO"/>
					<span>Export WMO (Raw)</span>
				</label>
				<label class="ui-checkbox" v-if="$core.view.config.mapsIncludeWMO" title="Include objects inside WMOs (interior decorations)">
					<input type="checkbox" v-model="$core.view.config.mapsIncludeWMOSets"/>
					<span>Export WMO Sets</span>
				</label>
				<label class="ui-checkbox" title="Export M2 objects on this tile (smaller objects such as trees)">
					<input type="checkbox" v-model="$core.view.config.mapsIncludeM2"/>
					<span>Export M2 (Raw)</span>
				</label>
				<label class="ui-checkbox" title="Include terrain holes for WMOs">
					<input type="checkbox" v-model="$core.view.config.mapsIncludeHoles"/>
					<span>Include Holes</span>
				</label>
				<span class="header">Terrain Texture Quality</span>
				<component :is="$components.MenuButton" :options="menuButtonTextureQuality" :default="$core.view.config.exportMapQuality" @change="$core.view.config.exportMapQuality = $event" :disabled="$core.view.isBusy" :dropdown="true"></component>
			</div>
		</div>
	`,

	data() {
		return {
			menuButtonExport: [
				{ label: 'Export OBJ', value: 'OBJ' },
				{ label: 'Export PNG', value: 'PNG' },
				{ label: 'Export Minimap Tiles', value: 'MINIMAP' }
			],
			menuButtonTextureQuality: [
				{ label: 'Alpha Maps', value: -1 },
				{ label: 'None', value: 0 },
				{ label: 'Minimap (512)', value: 512 },
				{ label: 'Baked (1k)', value: -2 },
				{ label: 'Low (1k)', value: 1024 },
				{ label: 'Medium (4k)', value: 4096 },
				{ label: 'High (8k)', value: 8192 },
				{ label: 'Ultra (16k)', value: 16384 }
			]
		};
	},

	methods: {
		handle_map_context(data) {
			this.$core.view.contextMenus.nodeMap = {
				selection: data.selection,
				count: data.selection.length
			};
		},

		copy_map_names(selection) {
			const names = selection.map(e => parse_map_entry(e).name);
			nw.Clipboard.get().set(names.join('\n'), 'text');
		},

		copy_map_internal_names(selection) {
			const names = selection.map(e => parse_map_entry(e).dir);
			nw.Clipboard.get().set(names.join('\n'), 'text');
		},

		copy_map_ids(selection) {
			const ids = selection.map(e => parse_map_entry(e).id);
			nw.Clipboard.get().set(ids.join('\n'), 'text');
		},

		copy_map_export_paths(selection) {
			const paths = selection.map(e => {
				const map = parse_map_entry(e);
				return ExportHelper.getExportPath(path.join('maps', map.dir));
			});
			nw.Clipboard.get().set(paths.join('\n'), 'text');
		},

		open_map_export_directory(selection) {
			if (selection.length === 0)
				return;

			const map = parse_map_entry(selection[0]);
			const dir = ExportHelper.getExportPath(path.join('maps', map.dir));
			nw.Shell.openItem(dir);
		},

		async load_map(map_id, map_dir, map_name) {
			const map_dir_lower = map_dir.toLowerCase();

			this.$core.hideToast();

			selected_map_id = map_id;
			selected_map_dir = map_dir_lower;
			selected_map_name = map_name ?? null;
			selected_wdt = null;

			this.$core.view.mapViewerHasWorldModel = false;
			this.$core.view.mapViewerIsWMOMinimap = false;
			this.$core.view.mapViewerGlobalWMO = null;
			this.$core.view.mapViewerGridSize = null;
			this.$core.view.mapViewerSelection.splice(0);

			const wdt_path = util.format('world\\maps\\%s\\%s.wdt', map_dir_lower, map_dir_lower);
			log.write('loading map preview for %s (%d)', map_dir_lower, map_id);

			try {
				const data = get_mpq_file(wdt_path);
				if (!data)
					throw new Error('WDT not found in MPQ');

				const wdt = selected_wdt = new WDTLoader(data);
				wdt.load();

				this.$core.view.mapViewerTileLoader = load_map_tile;
				this.$core.view.mapViewerChunkMask = wdt.tiles;
				this.$core.view.mapViewerSelectedMap = map_id;
				this.$core.view.mapViewerSelectedDir = map_dir;
			} catch (e) {
				log.write('cannot load %s, defaulting to all chunks enabled', wdt_path);
				this.$core.view.mapViewerTileLoader = load_map_tile;
				this.$core.view.mapViewerChunkMask = null;
				this.$core.view.mapViewerSelectedMap = map_id;
				this.$core.view.mapViewerSelectedDir = map_dir;
			}
		},

		async export_map() {
			const format = this.$core.view.config.exportMapFormat;

			if (format === 'OBJ')
				await this.export_selected_map();
			else if (format === 'PNG')
				await this.export_selected_map_as_png();
			else if (format === 'MINIMAP')
				await this.export_selected_minimap_tiles();
		},

		async export_selected_map() {
			const export_tiles = this.$core.view.mapViewerSelection;
			const quality = this.$core.view.config.exportMapQuality;

			if (export_tiles.length === 0)
				return this.$core.setToast('error', 'You haven\'t selected any tiles; hold shift and click on a map tile to select it.', null, -1);

			const helper = new ExportHelper(export_tiles.length, 'tile');
			helper.start();

			const dir = ExportHelper.getExportPath(path.join('maps', selected_map_dir));
			const export_paths = this.$core.openLastExportStream();
			const mark_path = path.join('maps', selected_map_dir, selected_map_dir);

			for (const index of export_tiles) {
				if (helper.isCancelled())
					break;

				try {
					const obj_path = await export_terrain_obj(selected_map_dir, index, dir, this.$core.view.config, helper, quality);
					await export_paths?.writeLine('ADT_OBJ:' + obj_path);
					helper.mark(mark_path, true);
				} catch (e) {
					helper.mark(mark_path, false, e.message, e.stack);
				}
			}

			export_paths?.close();
			helper.finish();
		},

		async export_selected_map_as_png() {
			const export_tiles = this.$core.view.mapViewerSelection;

			if (export_tiles.length === 0)
				return this.$core.setToast('error', 'You haven\'t selected any tiles; hold shift and click on a map tile to select it.', null, -1);

			const helper = new ExportHelper(export_tiles.length + 1, 'tile');
			helper.start();

			try {
				const tile_coords = export_tiles.map(index => ({
					index,
					x: Math.floor(index / MAP_SIZE),
					y: index % MAP_SIZE
				}));

				const min_x = Math.min(...tile_coords.map(t => t.x));
				const max_x = Math.max(...tile_coords.map(t => t.x));
				const min_y = Math.min(...tile_coords.map(t => t.y));
				const max_y = Math.max(...tile_coords.map(t => t.y));

				const first_tile = await load_map_tile(tile_coords[0].x, tile_coords[0].y, 512);
				if (!first_tile)
					throw new Error('unable to load first tile to determine tile size');

				const tile_size = first_tile.width;
				const tiles_wide = (max_x - min_x) + 1;
				const tiles_high = (max_y - min_y) + 1;
				const final_width = tiles_wide * tile_size;
				const final_height = tiles_high * tile_size;

				const writer = new TiledPNGWriter(final_width, final_height, tile_size);

				for (const tile_coord of tile_coords) {
					if (helper.isCancelled())
						break;

					const tile_data = await load_map_tile(tile_coord.x, tile_coord.y, tile_size);
					if (tile_data) {
						writer.addTile(tile_coord.x - min_x, tile_coord.y - min_y, tile_data);
						helper.mark(util.format('Tile %d %d', tile_coord.x, tile_coord.y), true);
					} else {
						helper.mark(util.format('Tile %d %d', tile_coord.x, tile_coord.y), false, 'Tile not available');
					}
				}

				const sorted_tiles = [...export_tiles].sort((a, b) => a - b);
				const tile_hash = crypto.createHash('md5').update(sorted_tiles.join(',')).digest('hex').substring(0, 8);

				const filename = selected_map_dir + '_' + tile_hash + '.png';
				const out_path = ExportHelper.getExportPath(path.join('maps', selected_map_dir, filename));

				await writer.write(out_path);

				const export_paths = this.$core.openLastExportStream();
				await export_paths?.writeLine('png:' + out_path);
				export_paths?.close();

				helper.mark(path.join('maps', selected_map_dir, filename), true);
			} catch (e) {
				helper.mark('PNG export', false, e.message, e.stack);
			}

			helper.finish();
		},

		async export_selected_minimap_tiles() {
			const export_tiles = this.$core.view.mapViewerSelection;

			if (export_tiles.length === 0)
				return this.$core.setToast('error', 'You haven\'t selected any tiles; hold shift and click on a map tile to select it.', null, -1);

			const helper = new ExportHelper(export_tiles.length, 'tile');
			helper.start();

			const dir = ExportHelper.getExportPath(path.join('maps', selected_map_dir, 'minimap'));
			const export_paths = this.$core.openLastExportStream();

			for (const index of export_tiles) {
				if (helper.isCancelled())
					break;

				const x = Math.floor(index / MAP_SIZE);
				const y = index % MAP_SIZE;
				const tile_name = util.format('map%s_%s', x.toString().padStart(2, '0'), y.toString().padStart(2, '0'));
				const mark_path = path.join('maps', selected_map_dir, 'minimap', tile_name);

				try {
					const tile_data = await load_map_tile(x, y, 512);
					if (!tile_data)
						throw new Error('minimap tile not available');

					const png = new PNGWriter(tile_data.width, tile_data.height);
					png.getPixelData().set(tile_data.data);

					const out_path = path.join(dir, tile_name + '.png');
					await png.write(out_path);

					await export_paths?.writeLine('png:' + out_path);
					helper.mark(mark_path, true);
				} catch (e) {
					helper.mark(mark_path, false, e.message, e.stack);
				}
			}

			export_paths?.close();
			helper.finish();
		},

		async initialize() {
			this.$core.showLoadingScreen(2);
			await this.$core.progressLoadingScreen('Loading map database...');

			try {
				const mpq = this.$core.view.mpq;
				const build_id = mpq.build_id ?? '1.12.1.5875';

				minimap_translate = load_minimap_translate();

				const raw_data = mpq.getFile('DBFilesClient\\Map.dbc');
				if (!raw_data)
					throw new Error('Map.dbc not found in MPQ archives');

				const data = new BufferWrapper(Buffer.from(raw_data));
				const dbc = new DBCReader('Map.dbc', build_id);
				await dbc.parse(data);

				const rows = await dbc.getAllRows();
				const maps = [];

				for (const [id, row] of rows) {
					const dir = row.Directory;
					const name = row.MapName_lang ?? row.MapName ?? ('Map ' + id);

					if (!dir || dir.length === 0)
						continue;

					// verify WDT exists in MPQ via listfile lookup (avoids full extraction)
					const wdt_key = util.format('world\\maps\\%s\\%s.wdt', dir.toLowerCase(), dir.toLowerCase());
					if (!mpq.listfile.has(wdt_key))
						continue;

					maps.push(util.format('0\x19[%d]\x19%s\x19(%s)', id, name, dir));
				}

				this.$core.view.mapViewerMaps = maps;
				log.write('loaded %d maps from Map.dbc', maps.length);
			} catch (e) {
				log.write('failed to load maps: %s', e.message);
				this.$core.setToast('error', 'Failed to load map list. Check the log for details.', { 'View Log': () => log.openRuntimeLog() }, -1);
			}

			this.$core.hideLoadingScreen();
		}
	},

	async mounted() {
		this.$core.view.mapViewerTileLoader = load_map_tile;

		this.$core.view.$watch('selectionMaps', async selection => {
			const first = selection[0];

			if (!this.$core.view.isBusy && first) {
				const map = parse_map_entry(first);
				if (selected_map_id !== map.id)
					this.load_map(map.id, map.dir, map.name);
			}
		});

		await this.initialize();
	}
};
