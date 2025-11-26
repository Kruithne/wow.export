const log = require('../log');
const BLPFile = require('../casc/blp');
const BufferWrapper = require('../buffer');
const textureExporter = require('../ui/texture-exporter');
const InstallType = require('../install-type');

let selected_file = null;

const preview_texture = async (core, filename) => {
	const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();

	using _lock = core.create_busy_lock();
	log.write('previewing texture file %s', filename);

	try {
		const data = core.view.mpq.getFile(filename);
		if (!data) {
			log.write('failed to load texture: %s', filename);
			return;
		}

		if (ext === '.blp') {
			const buffer = Buffer.from(data);
			const wrapped = new BufferWrapper(buffer);
			const blp = new BLPFile(wrapped);

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

			core.view.texturePreviewInfo = `${blp.width}x${blp.height} (${info})`;
		} else if (ext === '.png' || ext === '.jpg') {
			const buffer = Buffer.from(data);
			const base64 = buffer.toString('base64');
			const mime_type = ext === '.png' ? 'image/png' : 'image/jpeg';
			const data_url = `data:${mime_type};base64,${base64}`;

			const img = new Image();
			img.onload = () => {
				core.view.texturePreviewWidth = img.width;
				core.view.texturePreviewHeight = img.height;
				core.view.texturePreviewInfo = `${img.width}x${img.height} (${ext.slice(1).toUpperCase()})`;
			};
			img.src = data_url;

			core.view.texturePreviewURL = data_url;
		}

		selected_file = filename;
	} catch (e) {
		log.write('failed to preview legacy texture %s: %o', filename, e);
		core.setToast('error', 'unable to preview texture ' + filename, { 'view log': () => log.openRuntimeLog() }, -1);
	}
};

const refresh_blp_preview = (core) => {
	if (!selected_file)
		return;

	const ext = selected_file.slice(selected_file.lastIndexOf('.')).toLowerCase();
	if (ext !== '.blp')
		return;

	try {
		const data = core.view.mpq.getFile(selected_file);
		if (data) {
			const buffer = Buffer.from(data);
			const wrapped = new BufferWrapper(buffer);
			const blp = new BLPFile(wrapped);
			core.view.texturePreviewURL = blp.getDataURL(core.view.config.exportChannelMask);
		}
	} catch (e) {
		log.write('failed to refresh preview for %s: %o', selected_file, e);
	}
};

const load_texture_list = async (core) => {
	if (core.view.listfileTextures.length === 0 && !core.view.isBusy) {
		using _lock = core.create_busy_lock();

		try {
			const blp_files = core.view.mpq.getFilesByExtension('.blp');
			const png_files = core.view.mpq.getFilesByExtension('.png');
			const jpg_files = core.view.mpq.getFilesByExtension('.jpg');

			core.view.listfileTextures = [...blp_files, ...png_files, ...jpg_files];
		} catch (e) {
			log.write('failed to load legacy textures: %o', e);
		}
	}
};

module.exports = {
	register() {
		this.registerNavButton('Textures', 'image.svg', InstallType.MPQ);
	},

	template: `
		<div class="tab list-tab" id="legacy-tab-textures">
			<div class="list-container">
				<component :is="$components.Listbox" v-model:selection="$core.view.selectionTextures" :items="$core.view.listfileTextures" :filter="$core.view.userInputFilterTextures" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="texture" persistscrollkey="textures"></component>
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
					<div class="image" :style="{ 'background-image': 'url(' + $core.view.texturePreviewURL + ')' }"></div>
				</div>
			</div>
			<div class="preview-controls">
				<component :is="$components.MenuButton" :options="$core.view.menuButtonTextures" :default="$core.view.config.exportTextureFormat" @change="$core.view.config.exportTextureFormat = $event" :disabled="$core.view.isBusy" @click="export_textures"></component>
			</div>
		</div>
	`,

	methods: {
		async export_textures() {
			const selected = this.$core.view.selectionTextures;
			if (selected.length === 0) {
				log.write('no textures selected for export');
				return;
			}

			await textureExporter.exportFiles(selected, false, -1, true);
		}
	},

	async mounted() {
		await load_texture_list(this.$core);

		this.$core.view.$watch('selectionTextures', async selection => {
			if (selection.length === 0)
				return;

			const filename = selection[0];
			if (filename !== selected_file && !this.$core.view.isBusy)
				await preview_texture(this.$core, filename);
		});

		this.$core.view.$watch('config.exportChannelMask', () => {
			if (!this.$core.view.isBusy)
				refresh_blp_preview(this.$core);
		});
	}
};
