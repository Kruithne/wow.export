import log from '../log.js';
import { listfile } from '../../views/main/rpc.js';
import BLPFile from '../casc/blp.js';
import BufferWrapper from '../buffer.js';
import ExportHelper from '../export-helper.js';
import { db as db2 } from '../../views/main/rpc.js';
import textureExporter from '../ui/texture-exporter.js';
import listboxContext from '../ui/listbox-context.js';
import InstallType from '../install-type.js';

const texture_atlas_entries = new Map();
const texture_atlas_regions = new Map();
const texture_atlas_map = new Map();

let has_loaded_atlas_table = false;
let has_loaded_unknown_textures = false;
let selected_file_data_id = 0;
let resize_observer = null;

const preview_texture_by_id = async (core, file_data_id, texture = null) => {
	texture = texture ?? (await listfile.getByID(file_data_id)) ?? listfile.formatUnknownFile(file_data_id);

	using _lock = core.create_busy_lock();
	core.setToast('progress', `Loading ${texture}, please wait...`, null, -1, false);
	log.write('Previewing texture file %s', texture);

	try {
		const file = await core.view.casc.getFile(file_data_id);
		const blp = new BLPFile(file);

		core.view.texturePreviewURL = blp.getDataURL(core.view.config.exportChannelMask);
		core.view.texturePreviewWidth = blp.width;
		core.view.texturePreviewHeight = blp.height;

		let info = '';
		switch (blp.encoding) {
			case 1:
				info = 'Palette';
				break;
			case 2:
				info = 'Compressed ' + (blp.alphaDepth > 1 ? (blp.alphaEncoding === 7 ? 'DXT5' : 'DXT3') : 'DXT1');
				break;
			case 3:
				info = 'ARGB';
				break;
			default:
				info = 'Unsupported [' + blp.encoding + ']';
		}

		const base_name = texture.substring(texture.lastIndexOf('/') + 1) || texture.substring(texture.lastIndexOf('\\') + 1) || texture;
		core.view.texturePreviewInfo = `${base_name} ${blp.width} x ${blp.height} (${info})`;
		selected_file_data_id = file_data_id;

		update_texture_atlas_overlay(core);
		core.hideToast();
	} catch (e) {
		if (e.name === 'EncryptionError') {
			core.setToast('error', `The texture ${texture} is encrypted with an unknown key (${e.key}).`, null, -1);
			log.write('Failed to decrypt texture %s (%s)', texture, e.key);
		} else {
			core.setToast('error', 'Unable to preview texture ' + texture, { 'View Log': () => log.openRuntimeLog() }, -1);
			log.write('Failed to open CASC file: %s', e.message);
		}
	}
};

const load_texture_atlas_data = async (core) => {
	if (!has_loaded_atlas_table && core.view.config.showTextureAtlas) {
		await core.progressLoadingScreen('Parsing texture atlases...');

		for (const [id, row] of await db2.UiTextureAtlas.getAllRows()) {
			texture_atlas_map.set(row.FileDataID, id);
			texture_atlas_entries.set(id, {
				width: row.AtlasWidth,
				height: row.AtlasHeight,
				regions: []
			});
		}

		let loaded_regions = 0;
		for (const [id, row] of await db2.UiTextureAtlasMember.getAllRows()) {
			const entry = texture_atlas_entries.get(row.UiTextureAtlasID);
			if (!entry)
				continue;

			entry.regions.push(id);
			texture_atlas_regions.set(id, {
				name: row.CommittedName,
				width: row.Width,
				height: row.Height,
				left: row.CommittedLeft,
				top: row.CommittedTop
			});

			loaded_regions++;
		}

		log.write('Loaded %d texture atlases with %d regions', texture_atlas_entries.size, loaded_regions);
		has_loaded_atlas_table = true;
	}
};

const reload_texture_atlas_data = async (core) => {
	if (!has_loaded_atlas_table && core.view.config.showTextureAtlas && !core.view.isBusy) {
		core.showLoadingScreen(1);

		try {
			await load_texture_atlas_data(core);
			core.hideLoadingScreen();
		} catch (error) {
			core.hideLoadingScreen();
			log.write('Failed to load texture atlas data: %o', error);
			core.setToast('error', 'Failed to load texture atlas data. Check the log for details.');
		}
	}
};

const update_texture_atlas_overlay_scaling = (core) => {
	const overlay = document.getElementById('atlas-overlay');
	if (!overlay)
		return;

	const container = overlay.parentElement;
	const texture_width = core.view.texturePreviewWidth;
	const texture_height = core.view.texturePreviewHeight;

	if (!texture_width || !texture_height)
		return;

	const container_width = container.clientWidth;
	const container_height = container.clientHeight;

	const width_ratio = container_width / texture_width;
	const height_ratio = container_height / texture_height;
	const scale = Math.min(width_ratio, height_ratio);

	const render_width = texture_width * scale;
	const render_height = texture_height * scale;

	overlay.style.width = render_width + 'px';
	overlay.style.height = render_height + 'px';
	overlay.style.left = ((container_width - render_width) / 2) + 'px';
	overlay.style.top = ((container_height - render_height) / 2) + 'px';
};

const attach_overlay_listener = (core) => {
	const atlas_overlay = document.getElementById('atlas-overlay');
	if (!atlas_overlay || !atlas_overlay.parentElement)
		return;

	resize_observer?.disconnect();
	resize_observer = new ResizeObserver(() => update_texture_atlas_overlay_scaling(core));
	resize_observer.observe(atlas_overlay.parentElement);

	const overlay = document.getElementById('atlas-overlay');
	if (overlay) {
		overlay.addEventListener('mousemove', (e) => {
			const region = e.target.closest('.atlas-region');
			if (region) {
				const rect = region.getBoundingClientRect();
				const x = e.clientX - rect.left;
				const y = e.clientY - rect.top;

				const is_bottom = y > (rect.height / 2);
				const is_right = x > (rect.width / 2);

				region.classList.remove('tooltip-top-left', 'tooltip-top-right', 'tooltip-bottom-left', 'tooltip-bottom-right');

				if (is_bottom && is_right)
					region.classList.add('tooltip-bottom-right');
				else if (is_bottom && !is_right)
					region.classList.add('tooltip-bottom-left');
				else if (!is_bottom && is_right)
					region.classList.add('tooltip-top-right');
				else
					region.classList.add('tooltip-top-left');
			}
		});
	}
};

const update_texture_atlas_overlay = (core) => {
	const atlas_id = texture_atlas_map.get(selected_file_data_id);
	const entry = texture_atlas_entries.get(atlas_id);
	const render_regions = [];

	if (entry) {
		core.view.textureAtlasOverlayWidth = entry.width;
		core.view.textureAtlasOverlayHeight = entry.height;

		for (const id of entry.regions) {
			const region = texture_atlas_regions.get(id);
			render_regions.push({
				id,
				name: region.name,
				width: ((region.width / entry.width) * 100) + '%',
				height: ((region.height / entry.height) * 100) + '%',
				top: ((region.top / entry.height) * 100) + '%',
				left: ((region.left / entry.width) * 100) + '%',
			});
		}
	}

	core.view.textureAtlasOverlayRegions = render_regions;

	if (entry) {
		core.view.$nextTick(() => {
			update_texture_atlas_overlay_scaling(core);
		});
	}
};

const export_texture_atlas_regions = async (core, file_data_id) => {
	const atlas_id = texture_atlas_map.get(file_data_id);
	const atlas = texture_atlas_entries.get(atlas_id);

	const file_name = await listfile.getByID(file_data_id);
	const export_dir = ExportHelper.replaceExtension(file_name);

	const helper = new ExportHelper(atlas.regions.length, 'texture');
	helper.start();

	let export_file_name = file_name;
	const format = core.view.config.exportTextureFormat;
	const ext = format === 'WEBP' ? '.webp' : '.png';
	const mime_type = format === 'WEBP' ? 'image/webp' : 'image/png';

	try {
		const data = await core.view.casc.getFile(file_data_id);
		const blp = new BLPFile(data);

		const canvas = blp.toCanvas();
		const ctx = canvas.getContext('2d');

		for (const region_id of atlas.regions) {
			if (helper.isCancelled())
				return;

			const region = texture_atlas_regions.get(region_id);

			export_file_name = export_dir + '/' + region.name;
			const export_path = ExportHelper.getExportPath(export_file_name + ext);

			const crop = ctx.getImageData(region.left, region.top, region.width, region.height);

			const save_canvas = document.createElement('canvas');
			save_canvas.width = region.width;
			save_canvas.height = region.height;

			const save_ctx = save_canvas.getContext('2d');
			save_ctx.putImageData(crop, 0, 0);

			const buf = await BufferWrapper.fromCanvas(save_canvas, mime_type, core.view.config.exportWebPQuality);
			await buf.writeToFile(export_path);

			helper.mark(export_file_name, true);
		}
	} catch (e) {
		helper.mark(export_file_name, false, e.message, e.stack);
	}

	helper.finish();
};

const is_baked_npc_texture = (core) => {
	if (core.view.selectionTextures.length === 0)
		return false;

	const first = listfile.stripFileEntry(core.view.selectionTextures[0]);
	if (!first)
		return false;

	return first.toLowerCase().startsWith('textures/bakednpctextures/');
};

export default {
	register() {
		this.registerNavButton('Textures', 'image.svg', InstallType.CASC);
	},

	template: `
		<div id="toast" v-if="!$core.view.toast && $core.view.overrideTextureList.length > 0" class="progress">
			Filtering textures for item: {{ $core.view.overrideTextureName }}
			<span @click="remove_override_textures">Remove</span>
			<div class="close" @click="remove_override_textures"></div>
		</div>
		<div class="tab list-tab" id="tab-textures">
			<div class="list-container">
				<component :is="$components.Listbox" v-model:selection="$core.view.selectionTextures" :items="$core.view.listfileTextures" :override="$core.view.overrideTextureList" :filter="$core.view.userInputFilterTextures" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="texture" persistscrollkey="textures" @contextmenu="handle_listbox_context"></component>
				<component :is="$components.ContextMenu" :node="$core.view.contextMenus.nodeListbox" v-slot:default="context" @close="$core.view.contextMenus.nodeListbox = null">
					<span @click.self="copy_file_paths(context.node.selection)">Copy file path{{ context.node.count > 1 ? 's' : '' }}</span>
					<span v-if="context.node.hasFileDataIDs" @click.self="copy_listfile_format(context.node.selection)">Copy file path{{ context.node.count > 1 ? 's' : '' }} (listfile format)</span>
					<span v-if="context.node.hasFileDataIDs" @click.self="copy_file_data_ids(context.node.selection)">Copy file data ID{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="copy_export_paths(context.node.selection)">Copy export path{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="open_export_directory(context.node.selection)">Open export directory</span>
				</component>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="$core.view.userInputFilterTextures" placeholder="Filter textures..."/>
			</div>
			<div class="preview-container">
				<div class="preview-info" v-if="$core.view.texturePreviewInfo.length > 0">{{ $core.view.texturePreviewInfo }}</div>
				<ul class="preview-channels" v-if="$core.view.texturePreviewURL.length > 0">
					<li id="channel-red" :class="{ selected: ($core.view.config.exportChannelMask & 0b1) }" @click.self="$core.view.config.exportChannelMask ^= 0b1" title="Toggle red colour channel.">R</li>
					<li id="channel-green" :class="{ selected: ($core.view.config.exportChannelMask & 0b10) }" @click.self="$core.view.config.exportChannelMask ^= 0b10" title="Toggle green colour channel.">G</li>
					<li id="channel-blue" :class="{ selected: ($core.view.config.exportChannelMask & 0b100) }" @click.self="$core.view.config.exportChannelMask ^= 0b100" title="Toggle blue colour channel.">B</li>
					<li id="channel-alpha" :class="{ selected: ($core.view.config.exportChannelMask & 0b1000) }" @click.self="$core.view.config.exportChannelMask ^= 0b1000" title="Toggle alpha channel.">A</li>
				</ul>
				<div class="preview-background" id="texture-preview" :style="{ 'max-width': $core.view.texturePreviewWidth + 'px', 'max-height': $core.view.texturePreviewHeight + 'px' }">
					<div id="atlas-overlay" v-if="$core.view.config.showTextureAtlas">
						<div class="atlas-region" v-for="region of $core.view.textureAtlasOverlayRegions" :style="{ left: region.left, top: region.top, width: region.width, height: region.height }">
							<span>{{ region.name }}</span>
						</div>
					</div>
					<div class="image" :style="{ 'background-image': 'url(' + $core.view.texturePreviewURL + ')' }"></div>
				</div>
			</div>
			<div class="preview-controls">
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.config.showTextureAtlas"/>
					<span>Atlas Regions</span>
				</label>
				<input v-if="is_baked_npc_texture()" type="button" value="Apply to Character" @click="apply_baked_npc_texture" :class="{ disabled: $core.view.isBusy }" style="margin-right: 5px"/>
				<input v-if="$core.view.config.showTextureAtlas" type="button" value="Export Atlas Regions" @click="export_atlas_regions" :class="{ disabled: $core.view.isBusy }" style="margin-right: 5px"/>
				<component :is="$components.MenuButton" :options="$core.view.menuButtonTextures" :default="$core.view.config.exportTextureFormat" @change="$core.view.config.exportTextureFormat = $event" :disabled="$core.view.isBusy" @click="export_textures"></component>
			</div>
		</div>
	`,

	previewTextureByID(core, file_data_id, texture = null) {
		return preview_texture_by_id(core, file_data_id, texture);
	},

	methods: {
		handle_listbox_context(data) {
			listboxContext.handle_context_menu(data);
		},

		copy_file_paths(selection) {
			listboxContext.copy_file_paths(selection);
		},

		copy_listfile_format(selection) {
			listboxContext.copy_listfile_format(selection);
		},

		copy_file_data_ids(selection) {
			listboxContext.copy_file_data_ids(selection);
		},

		copy_export_paths(selection) {
			listboxContext.copy_export_paths(selection);
		},

		open_export_directory(selection) {
			listboxContext.open_export_directory(selection);
		},

		is_baked_npc_texture() {
			return is_baked_npc_texture(this.$core);
		},

		remove_override_textures() {
			this.$core.view.removeOverrideTextures();
		},

		async export_textures() {
			const user_selection = this.$core.view.selectionTextures;
			if (user_selection.length > 0) {
				await textureExporter.exportFiles(user_selection);
			} else if (selected_file_data_id > 0) {
				await textureExporter.exportFiles([selected_file_data_id]);
			} else {
				this.$core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
			}
		},

		async export_atlas_regions() {
			await export_texture_atlas_regions(this.$core, selected_file_data_id);
		},

		async initialize() {
			const needs_unknown_textures = this.$core.view.config.enableUnknownFiles && !has_loaded_unknown_textures;
			const needs_atlas_data = !has_loaded_atlas_table && this.$core.view.config.showTextureAtlas;

			if (needs_unknown_textures || needs_atlas_data) {
				let step_count = 0;
				if (needs_unknown_textures)
					step_count += 2;

				if (needs_atlas_data)
					step_count += 1;

				this.$core.showLoadingScreen(step_count);

				if (needs_unknown_textures) {
					await this.$core.progressLoadingScreen('Loading texture file data...');
					await this.$core.progressLoadingScreen('Loading unknown textures...');
					await listfile.loadUnknownTextures();
					has_loaded_unknown_textures = true;
				}

				if (needs_atlas_data)
					await load_texture_atlas_data(this.$core);

				this.$core.hideLoadingScreen();
			}
		},

		async apply_baked_npc_texture() {
			if (!is_baked_npc_texture(this.$core))
				return;

			using _lock = this.$core.create_busy_lock();
			this.$core.setToast('progress', 'loading baked npc texture...', null, -1, false);

			try {
				const first = listfile.stripFileEntry(this.$core.view.selectionTextures[0]);
				const file_data_id = await listfile.getByFilename(first);
				const file = await this.$core.view.casc.getFile(file_data_id);
				const blp = new BLPFile(file);

				this.$core.view.chrCustBakedNPCTexture = blp;
				this.$core.setToast('success', 'baked npc texture applied to character', null, 3000);
				log.write('applied baked npc texture %s to character', first);
			} catch (e) {
				this.$core.setToast('error', 'failed to load baked npc texture', { 'view log': () => log.openRuntimeLog() }, -1);
				log.write('failed to load baked npc texture: %s', e.message);
			}
		}
	},

	async mounted() {
		await this.initialize();

		attach_overlay_listener(this.$core);

		this.$core.view.$watch('config.exportTextureAlpha', () => {
			if (!this.$core.view.isBusy && selected_file_data_id > 0)
				preview_texture_by_id(this.$core, selected_file_data_id);
		});

		this.$core.view.$watch('selectionTextures', async selection => {
			const first = listfile.stripFileEntry(selection[0]);
			if (first && !this.$core.view.isBusy) {
				const file_data_id = await listfile.getByFilename(first);
				if (selected_file_data_id !== file_data_id)
					preview_texture_by_id(this.$core, file_data_id);
			}
		});

		this.$core.view.$watch('config.exportChannelMask', () => {
			if (!this.$core.view.isBusy && selected_file_data_id > 0)
				preview_texture_by_id(this.$core, selected_file_data_id);
		});

		this.$core.view.$watch('config.showTextureAtlas', async () => {
			await reload_texture_atlas_data(this.$core);
			update_texture_atlas_overlay(this.$core);
		});

		// register drop handler
		this.$core.registerDropHandler({
			ext: ['.blp'],
			prompt: count => `Export ${count} textures as ${this.$core.view.config.exportTextureFormat}`,
			process: files => textureExporter.exportFiles(files, true)
		});
	}
};
