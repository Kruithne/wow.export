/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue';

const util = require('util');
const path = require('path');
const log = require('/js/log');
const listfile = require('/js/casc/listfile');
const BLPFile = require('/js/casc/blp');
const EncryptionError = require('/js/casc/blte-reader').EncryptionError;
const textureExporter = require('/js/ui/texture-exporter');

import useTextureAtlas from './textures/texture-atlas.mjs';
import useUiState from './textures/ui-state.mjs';

export default {
	components: {
	},
	setup() {
		const core = inject('core');
		const app = inject('app');

		let textureAtlas = useTextureAtlas();
		let textureAtlasLoaded = ref(false);

		onMounted(async () => {
			if (!app.isBusy && app.config.showTextureAtlas) {
				await textureAtlas.load();
				textureAtlasLoaded.value = true;
			}
		});

		const isLoaded = computed(() => (app.config.showTextureAtlas && textureAtlasLoaded.value) || !app.config.showTextureAtlas);

		const uiState = useUiState();
		const { texturePreviewURL } = uiState;

		let selectedFileDataID = 0;

		/**
		 * Preview a texture by the given fileDataID.
		 * @param {number} fileDataID
		 * @param {string} [texture]
		 */
		const previewTextureByID = async (fileDataID, texture = null) => {
			texture = texture ?? listfile.getByID(fileDataID) ?? listfile.formatUnknownFile(fileDataID);

			app.isBusy++;
			core.setToast('progress', util.format('Loading %s, please wait...', texture), null, -1, false);
			log.write('Previewing texture file %s', texture);

			try {
				const file = await app.casc.getFile(fileDataID);

				const blp = new BLPFile(file);

				texturePreviewURL.value = blp.getDataURL(app.config.exportChannelMask);
				app.texturePreviewWidth = blp.width;
				app.texturePreviewHeight = blp.height;

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

				app.texturePreviewInfo = util.format('%s %d x %d (%s)', path.basename(texture), blp.width, blp.height, info);
				selectedFileDataID = fileDataID;

				textureAtlas.updateOverlay(fileDataID);

				core.hideToast();
			} catch (e) {
				if (e instanceof EncryptionError) {
					// Missing decryption key.
					core.setToast('error', util.format('The texture %s is encrypted with an unknown key (%s).', texture, e.key), null, -1);
					log.write('Failed to decrypt texture %s (%s)', texture, e.key);
				} else {
					// Error reading/parsing texture.
					core.setToast('error', 'Unable to preview texture ' + texture, { 'View Log': () => log.openRuntimeLog() }, -1);
					log.write('Failed to open CASC file: %s', e.message);
				}
			}

			app.isBusy--;
		};

		const atlasOverlayRef = ref(null);

		const updateTextureAtlasOverlayScaling = () => {
			const overlay = atlasOverlayRef.value;
			if (!overlay.value) return;

			const container = overlay.parentElement;

			const texture_width = textureAtlas.overlayWidth.value;
			const texture_height = textureAtlas.overlayHeight.value;

			const container_width = container.clientWidth;
			const render_width = Math.min(texture_width, container_width);

			const final_height = texture_height * (render_width / texture_width);

			overlay.style.width = render_width + 'px';
			overlay.style.height = final_height + 'px';
		};

		let observer;
		onMounted(() => {
			observer = new ResizeObserver(updateTextureAtlasOverlayScaling);
			if (atlasOverlayRef.value)
				observer.observe(atlasOverlayRef.value.parentElement);
		});
		onUnmounted(() => {
			if (observer != null)
				observer.disconnect();
		});

		// Track when user toggles the "Show Atlas Regions" checkbox.
		watch(() => app.config.showTextureAtlas, async () => {
			await textureAtlas.load();
			if (textureAtlas.updateOverlay(selectedFileDataID)) 
				updateTextureAtlasOverlayScaling();
		});


		// Register a drop handler for BLP files.
		core.registerDropHandler({
			ext: ['.blp'],
			prompt: count => util.format('Export %d textures as %s', count, app.config.exportTextureFormat),
			process: files => textureExporter.exportFiles(files, true)
		});

		core.events.on('rcp-export-textures', (files, id) => {
			// RCP should provide an array of fileDataIDs to export.
			textureExporter.exportFiles(files, false, id);
		});

		// Track changes to exportTextureAlpha. If it changes, re-render the
		// currently displayed texture to ensure we match desired alpha.
		watch(() => app.config.exportTextureAlpha, () => {
			if (!app.isBusy && selectedFileDataID > 0)
				previewTextureByID(selectedFileDataID);
		});

		// Track selection changes on the texture listbox and preview first texture.
		watch(() => app.selectionTextures, async selection => {
			// Check if the first file in the selection is "new".
			const first = listfile.stripFileEntry(selection[0]);
			if (first && !app.isBusy) {
				const fileDataID = listfile.getByFilename(first);
				if (selectedFileDataID !== fileDataID)
					previewTextureByID(fileDataID);
			}
		});

		const exportTexture = async () => {
			const userSelection = app.selectionTextures;
			if (userSelection.length > 0) {
				// In most scenarios, we have a user selection to export.
				await textureExporter.exportFiles(userSelection);
			} else if (selectedFileDataID > 0) {
				// Less common, but we might have a direct preview that isn't selected.
				await textureExporter.exportFiles([selectedFileDataID]);
			} else {
				// Nothing to be exported, show the user an error.
				core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
			}
		};

		// Track when the user changes the colour channel mask.
		watch(() => app.config.exportChannelMask, () => {
			if (!app.isBusy && selectedFileDataID > 0)
				previewTextureByID(selectedFileDataID);
		});

		return {
			app,
			config: app.config,
			isLoaded,
			texturePreviewURL,
			atlasOverlayRef,
			textureAtlasOverlayRegions: textureAtlas.overlayRegions,
			exportTextureAtlasRegions: textureAtlas.exportRegions,
			exportTexture,
		};
	},
	template: `
		<div class="tab list-tab" id="tab-textures" aaa="">
			<div class="list-container">
				<listbox v-model:selection="app.selectionTextures" :items="app.listfileTextures" :override="app.overrideTextureList" :filter="app.userInputFilterTextures" :keyinput="true" :regex="config.regexFilters" :copymode="config.copyMode" :pasteselection="config.pasteSelection" :copytrimwhitespace="config.removePathSpacesCopy" :includefilecount="true" unittype="texture" persistscrollkey="textures"></listbox>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="config.regexFilters" :title="regexTooltip">Regex Enabled</div>
				<input type="text" v-model="app.userInputFilterTextures" placeholder="Filter textures..."/>
			</div>
			<div class="preview-container">
				<div class="preview-info" v-if="config.showTextureInfo && app.texturePreviewInfo.length > 0">{{ app.texturePreviewInfo }}</div>
				<ul class="preview-channels" v-if="texturePreviewURL.length > 0">
					<li id="channel-red" :class="{ selected: (config.exportChannelMask & 0b1) }" @click.self="config.exportChannelMask ^= 0b1" title="Toggle red colour channel.">R</li>
					<li id="channel-green" :class="{ selected: (config.exportChannelMask & 0b10) }" @click.self="config.exportChannelMask ^= 0b10" title="Toggle green colour channel.">G</li>
					<li id="channel-blue" :class="{ selected: (config.exportChannelMask & 0b100) }" @click.self="config.exportChannelMask ^= 0b100" title="Toggle blue colour channel.">B</li>
					<li id="channel-alpha" :class="{ selected: (config.exportChannelMask & 0b1000) }" @click.self="config.exportChannelMask ^= 0b1000" title="Toggle alpha channel.">A</li>
				</ul>
				<div class="preview-background" id="texture-preview" :style="{ 'max-width': app.texturePreviewWidth + 'px', 'max-height': app.texturePreviewHeight + 'px' }">
					<div :ref="atlasOverlayRef" v-if="config.showTextureAtlas">
						<div class="atlas-region" v-for="region of textureAtlasOverlayRegions" :style="{ left: region.left, top: region.top, width: region.width, height: region.height }">
							<span>{{ region.name }}</span>
						</div>
					</div>
					<div class="image" :style="{ 'background-image': 'url(' + texturePreviewURL + ')' }"></div>
				</div>
			</div>
			<div class="preview-controls">
				<label class="ui-checkbox">
					<input type="checkbox" v-model="config.showTextureAtlas"/>
					<span>Show Atlas Regions</span>
				</label>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="config.showTextureInfo"/>
					<span>Show Info</span>
				</label>
				<label class="ui-checkbox">
					<input type="checkbox" :checked="(config.exportChannelMask & 0b1000)" @change="$event.target.checked ? config.exportChannelMask |= 0b1000 : config.exportChannelMask &= 0b0111"/>
					<span>Transparency</span>
				</label>
				<input v-if="config.showTextureAtlas" type="button" value="Export Atlas Regions" @click="exportTextureAtlasRegions" :class="{ disabled: app.isBusy }" style="margin-right: 5px"/>
				<menu-button :options="app.menuButtonTextures" :default="config.exportTextureFormat" @change="config.exportTextureFormat = $event" :disabled="app.isBusy" @click="exportTexture"></menu-button>
			</div>
		</div>
	`
};
