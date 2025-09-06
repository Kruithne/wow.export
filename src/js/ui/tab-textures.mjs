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


export const TabTexturesContent = {
	props: ['uiState', 'textureAtlas', 'previewTextureById'],
	setup({previewTextureById}) {
		const core = inject('core');
		const app = inject('app');

		const uiState = useUiState();
		const textureAtlas = useTextureAtlas();

		let textureAtlasLoaded = ref(false);

		onMounted(async () => {
			if (!app.isBusy && app.config.showTextureAtlas) {
				await textureAtlas.load();
				textureAtlasLoaded.value = true;
			}
		});

		const isLoaded = computed(() => (app.config.showTextureAtlas && textureAtlasLoaded.value) || !app.config.showTextureAtlas);

		const { 
			selectedFileDataID,
			selectionTextures,
		} = uiState;

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
			if (textureAtlas.updateOverlay(selectedFileDataID.value)) 
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
			if (!app.isBusy && selectedFileDataID.value > 0)
				previewTextureById(selectedFileDataID.value);
		});

		// Track selection changes on the texture listbox and preview first texture.
		watch(selectionTextures, async selection => {
			// Check if the first file in the selection is "new".
			const first = listfile.stripFileEntry(selection[0]);
			if (first && !app.isBusy) {
				const fileDataID = listfile.getByFilename(first);
				if (selectedFileDataID.value !== fileDataID)
					previewTextureById(fileDataID);
			}
		});

		const exportTexture = async () => {
			const userSelection = selectionTextures.value;
			if (userSelection.length > 0) {
				// In most scenarios, we have a user selection to export.
				await textureExporter.exportFiles(userSelection);
			} else if (selectedFileDataID.value > 0) {
				// Less common, but we might have a direct preview that isn't selected.
				await textureExporter.exportFiles([selectedFileDataID.value]);
			} else {
				// Nothing to be exported, show the user an error.
				core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
			}
		};

		// Track when the user changes the colour channel mask.
		watch(() => app.config.exportChannelMask, () => {
			if (!app.isBusy && selectedFileDataID.value > 0)
				previewTextureById(selectedFileDataID.value);
		});

		return {
			app,
			config: app.config,
			isLoaded,
			atlasOverlayRef,
			textureAtlasOverlayRegions: textureAtlas.overlayRegions,
			exportTextureAtlasRegions: textureAtlas.exportRegions,
			exportTexture,
			menuButtonTextures: [
				{ label: 'Export as PNG', value: 'PNG' },
				{ label: 'Export as BLP (Raw)', value: 'BLP' },
				{ label: 'Copy to Clipboard', value: 'CLIPBOARD' }
			],
			...uiState,
		};
	},
	template: `
		<div class="tab list-tab" id="tab-textures" v-if="isLoaded">
			<div class="list-container">
				<listbox v-model:selection="selectionTextures" :items="app.listfileTextures" :override="overrideTextureList" :filter="userInputFilterTextures" :keyinput="true" :regex="config.regexFilters" :copymode="config.copyMode" :pasteselection="config.pasteSelection" :copytrimwhitespace="config.removePathSpacesCopy" :includefilecount="true" unittype="texture" persistscrollkey="textures"></listbox>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="config.regexFilters" :title="regexTooltip">Regex Enabled</div>
				<input type="text" v-model="userInputFilterTextures" placeholder="Filter textures..."/>
			</div>
			<div class="preview-container">
				<div class="preview-info" v-if="config.showTextureInfo && texturePreviewInfo.length > 0">{{ texturePreviewInfo }}</div>
				<ul class="preview-channels" v-if="texturePreviewURL.length > 0">
					<li id="channel-red" :class="{ selected: (config.exportChannelMask & 0b1) }" @click.self="config.exportChannelMask ^= 0b1" title="Toggle red colour channel.">R</li>
					<li id="channel-green" :class="{ selected: (config.exportChannelMask & 0b10) }" @click.self="config.exportChannelMask ^= 0b10" title="Toggle green colour channel.">G</li>
					<li id="channel-blue" :class="{ selected: (config.exportChannelMask & 0b100) }" @click.self="config.exportChannelMask ^= 0b100" title="Toggle blue colour channel.">B</li>
					<li id="channel-alpha" :class="{ selected: (config.exportChannelMask & 0b1000) }" @click.self="config.exportChannelMask ^= 0b1000" title="Toggle alpha channel.">A</li>
				</ul>
				<div class="preview-background" id="texture-preview" :style="{ 'max-width': texturePreviewWidth + 'px', 'max-height': texturePreviewHeight + 'px' }">
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
				<menu-button :options="menuButtonTextures" :default="config.exportTextureFormat" @change="config.exportTextureFormat = $event" :disabled="app.isBusy" @click="exportTexture"></menu-button>
			</div>
		</div>
	`
};

export default {
	components: {
		TabTexturesContent
	},
	setup() {
		const app = inject('app');
		const core = inject('core');

		const uiState = useUiState();
		const textureAtlas = useTextureAtlas();

		const {
			overrideTextureList,
			overrideTextureName,
			selectionTextures,
			selectedFileDataID,
			texturePreviewURL,
			texturePreviewWidth,
			texturePreviewHeight,
			userInputFilterTextures,
			texturePreviewInfo,
		} = uiState;

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
				texturePreviewWidth.value = blp.width;
				texturePreviewHeight.value = blp.height;

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

				texturePreviewInfo.value = util.format('%s %d x %d (%s)', path.basename(texture), blp.width, blp.height, info);
				selectedFileDataID.value = fileDataID;

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
		
		onMounted(() => {
			app.apis.texture = {
				/**
				 * Switches to the textures tab and filters for the given file.
				 * @param {number} fileDataID 
				 */
				goToTexture (fileDataID) {
					app.setScreen('tab-textures');

					// Directly preview the requested file, even if it's not in the listfile.
					previewTextureByID(fileDataID);

					// Since we're doing a direct preview, we need to reset the users current
					// selection, so if they hit export, they get the expected result.
					selectionTextures.value.splice(0);

					// Despite direct preview, *attempt* to filter for the file as well.
					if (app.config.listfileShowFileDataIDs) {
					// If the user has fileDataIDs shown, filter by that.
						if (app.config.regexFilters)
							userInputFilterTextures.value = '\\[' + fileDataID + '\\]';
						else
							userInputFilterTextures.value = '[' + fileDataID + ']';
					} else {
					// Without fileDataIDs, lookup the texture name and filter by that.
						const fileName = listfile.getByID(fileDataID);
						if (fileName !== undefined)
							userInputFilterTextures.value = listfile.getByID(fileName);
						else if (app.config.enableUnknownFiles)
							userInputFilterTextures.value = listfile.formatUnknownFile(fileDataID, '.blp');
					}
				},

				setOverrides(overrides) {
					for (const prop in overrides) 
						uiState[prop].value = overrides[prop];
				}
			};
		});

		return {
			app,
			overrideTextureList,
			overrideTextureName,
			previewTextureByID,

			/**
			 * Invoked when a user cancels a texture override filter.
			 */
			removeOverrideTextures() {
				overrideTextureList.value = [];
				overrideTextureName.value = '';

			},
		};
	},
	template: `
		<div id="toast" v-if="!app.toast && app.screen === 'tab-textures' && overrideTextureList.length > 0" class="progress">
			Filtering textures for item: {{ overrideTextureName }}
			<span @click="removeOverrideTextures">Remove</span>
			<div class="close" @click="removeOverrideTextures"></div>
		</div>
		<tab-textures-content
			v-if="app.screen === 'tab-textures'"
			:preview-texture-by-id="previewTextureByID"
		></tab-textures-content>
	`
};
