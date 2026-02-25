const log = require('../log');
const util = require('util');
const path = require('path');
const ExportHelper = require('../casc/export-helper');
const listfile = require('../casc/listfile');
const EncryptionError = require('../casc/blte-reader').EncryptionError;
const InstallType = require('../install-type');
const listboxContext = require('../ui/listbox-context');

const BLPFile = require('../casc/blp');
const M2RendererGL = require('../3D/renderers/M2RendererGL');
const M2Exporter = require('../3D/exporters/M2Exporter');

const DBModelFileData = require('../db/caches/DBModelFileData');
const DBCreatures = require('../db/caches/DBCreatures');
const DBCreatureList = require('../db/caches/DBCreatureList');
const DBCharacterCustomization = require('../db/caches/DBCharacterCustomization');
const DBCreatureDisplayExtra = require('../db/caches/DBCreatureDisplayExtra');

const textureRibbon = require('../ui/texture-ribbon');
const textureExporter = require('../ui/texture-exporter');
const modelViewerUtils = require('../ui/model-viewer-utils');
const character_appearance = require('../ui/character-appearance');

const active_skins = new Map();
let selected_variant_texture_ids = new Array();

let active_renderer;
let active_file_data_id;
let active_creature;
let is_character_model = false;
const creature_chr_materials = new Map();

const get_creature_displays = (file_data_id) => {
	return DBCreatures.getCreatureDisplaysByFileDataID(file_data_id) ?? [];
};

const preview_creature = async (core, creature) => {
	using _lock = core.create_busy_lock();
	core.setToast('progress', util.format('Loading %s, please wait...', creature.name), null, -1, false);
	log.write('Previewing creature %s (ID: %d)', creature.name, creature.id);

	const state = modelViewerUtils.create_view_state(core, 'creature');
	textureRibbon.reset();
	modelViewerUtils.clear_texture_preview(state);

	core.view.creatureViewerSkins = [];
	core.view.creatureViewerSkinsSelection = [];
	core.view.creatureViewerAnims = [];
	core.view.creatureViewerAnimSelection = null;

	try {
		if (active_renderer) {
			active_renderer.dispose();
			active_renderer = null;
			active_file_data_id = null;
			active_creature = null;
		}

		character_appearance.dispose_materials(creature_chr_materials);
		active_skins.clear();
		selected_variant_texture_ids.length = 0;
		is_character_model = false;

		const display_info = DBCreatures.getDisplayInfo(creature.displayID);

		if (display_info?.extendedDisplayInfoID > 0) {
			// character-model creature
			const extra = DBCreatureDisplayExtra.get_extra(display_info.extendedDisplayInfoID);
			if (!extra) {
				core.setToast('error', util.format('No extended display info found for creature %s.', creature.name), null, -1);
				return;
			}

			const chr_model_id = DBCharacterCustomization.get_chr_model_id(extra.DisplayRaceID, extra.DisplaySexID);
			if (chr_model_id === undefined) {
				core.setToast('error', util.format('No character model found for creature %s (race %d, sex %d).', creature.name, extra.DisplayRaceID, extra.DisplaySexID), null, -1);
				return;
			}

			const file_data_id = DBCharacterCustomization.get_model_file_data_id(chr_model_id);
			if (!file_data_id) {
				core.setToast('error', util.format('No model file found for creature %s.', creature.name), null, -1);
				return;
			}

			const file = await core.view.casc.getFile(file_data_id);
			const gl_context = core.view.creatureViewerContext?.gl_context;

			core.view.creatureViewerActiveType = 'm2';

			active_renderer = new M2RendererGL(file, gl_context, true, true);
			active_renderer.geosetKey = 'creatureViewerGeosets';
			await active_renderer.load();

			// apply customization geosets
			const geosets = core.view.creatureViewerGeosets;
			const customization_choices = DBCreatureDisplayExtra.get_customization_choices(display_info.extendedDisplayInfoID);
			character_appearance.apply_customization_geosets(geosets, customization_choices);
			active_renderer.updateGeosets();

			// resolve baked NPC texture
			let baked_npc_blp = null;
			const bake_id = extra.HDBakeMaterialResourcesID || extra.BakeMaterialResourcesID;
			if (bake_id > 0) {
				const bake_fdid = DBCharacterCustomization.get_texture_file_data_id(bake_id);
				if (bake_fdid) {
					try {
						const bake_data = await core.view.casc.getFile(bake_fdid);
						baked_npc_blp = new BLPFile(bake_data);
					} catch (e) {
						log.write('Failed to load baked NPC texture %d: %s', bake_fdid, e.message);
					}
				}
			}

			// apply customization textures + baked NPC texture
			const layout_id = DBCharacterCustomization.get_texture_layout_id(chr_model_id);
			await character_appearance.apply_customization_textures(
				active_renderer,
				customization_choices,
				layout_id,
				creature_chr_materials,
				baked_npc_blp
			);
			await character_appearance.upload_textures_to_gpu(active_renderer, creature_chr_materials);

			core.view.creatureViewerAnims = modelViewerUtils.extract_animations(active_renderer);
			core.view.creatureViewerAnimSelection = 'none';

			active_file_data_id = file_data_id;
			active_creature = creature;
			is_character_model = true;
		} else {
			// standard creature model
			const file_data_id = DBCreatures.getFileDataIDByDisplayID(creature.displayID);
			if (!file_data_id) {
				core.setToast('error', util.format('No model data found for creature %s.', creature.name), null, -1);
				return;
			}

			const file = await core.view.casc.getFile(file_data_id);
			const gl_context = core.view.creatureViewerContext?.gl_context;

			const model_type = modelViewerUtils.detect_model_type(file);
			const file_name = listfile.getByID(file_data_id) ?? listfile.formatUnknownFile(file_data_id, modelViewerUtils.get_model_extension(model_type));

			if (model_type === modelViewerUtils.MODEL_TYPE_M2)
				core.view.creatureViewerActiveType = 'm2';
			else if (model_type === modelViewerUtils.MODEL_TYPE_WMO)
				core.view.creatureViewerActiveType = 'wmo';
			else
				core.view.creatureViewerActiveType = 'm3';

			active_renderer = modelViewerUtils.create_renderer(file, model_type, gl_context, core.view.config.modelViewerShowTextures, file_name);

			if (model_type === modelViewerUtils.MODEL_TYPE_M2)
				active_renderer.geosetKey = 'creatureViewerGeosets';
			else if (model_type === modelViewerUtils.MODEL_TYPE_WMO) {
				active_renderer.wmoGroupKey = 'creatureViewerWMOGroups';
				active_renderer.wmoSetKey = 'creatureViewerWMOSets';
			}

			await active_renderer.load();

			if (model_type === modelViewerUtils.MODEL_TYPE_M2) {
				const displays = get_creature_displays(file_data_id);

				const skin_list = [];
				let model_name = listfile.getByID(file_data_id);
				model_name = path.basename(model_name, 'm2');

				for (const display of displays) {
					if (display.textures.length === 0)
						continue;

					const texture = display.textures[0];

					let clean_skin_name = '';
					let skin_name = listfile.getByID(texture);
					if (skin_name !== undefined) {
						skin_name = path.basename(skin_name, '.blp');
						clean_skin_name = skin_name.replace(model_name, '').replace('_', '');
					} else {
						skin_name = 'unknown_' + texture;
					}

					if (clean_skin_name.length === 0)
						clean_skin_name = 'base';

					if (display.extraGeosets?.length > 0)
						skin_name += display.extraGeosets.join(',');

					clean_skin_name += ' (' + display.ID + ')';

					if (active_skins.has(skin_name))
						continue;

					skin_list.push({ id: skin_name, label: clean_skin_name });
					active_skins.set(skin_name, display);
				}

				core.view.creatureViewerSkins = skin_list;

				const matching_skin = skin_list.find(skin => active_skins.get(skin.id)?.ID === creature.displayID);
				core.view.creatureViewerSkinsSelection = matching_skin ? [matching_skin] : skin_list.slice(0, 1);

				core.view.creatureViewerAnims = modelViewerUtils.extract_animations(active_renderer);
				core.view.creatureViewerAnimSelection = 'none';
			}

			active_file_data_id = file_data_id;
			active_creature = creature;
		}

		const has_content = active_renderer.draw_calls?.length > 0 || active_renderer.groups?.length > 0;

		if (!has_content) {
			core.setToast('info', util.format('The model %s doesn\'t have any 3D data associated with it.', creature.name), null, 4000);
		} else {
			core.hideToast();

			if (core.view.creatureViewerAutoAdjust)
				requestAnimationFrame(() => core.view.creatureViewerContext?.fitCamera?.());
		}
	} catch (e) {
		if (e instanceof EncryptionError) {
			core.setToast('error', util.format('The model %s is encrypted with an unknown key (%s).', creature.name, e.key), null, -1);
			log.write('Failed to decrypt model %s (%s)', creature.name, e.key);
		} else {
			core.setToast('error', 'Unable to preview creature ' + creature.name, { 'View Log': () => log.openRuntimeLog() }, -1);
			log.write('Failed to open CASC file: %s', e.message);
		}
	}
};

const export_files = async (core, entries) => {
	const export_paths = core.openLastExportStream();
	const format = core.view.config.exportCreatureFormat;

	if (format === 'PNG' || format === 'CLIPBOARD') {
		if (active_file_data_id) {
			const canvas = document.getElementById('creature-preview').querySelector('canvas');
			const export_name = ExportHelper.sanitizeFilename(active_creature?.name ?? 'creature_' + active_file_data_id);
			await modelViewerUtils.export_preview(core, format, canvas, export_name, 'creatures');
		} else {
			core.setToast('error', 'The selected export option only works for model previews. Preview something first!', null, -1);
		}

		export_paths?.close();
		return;
	}

	const casc = core.view.casc;
	const helper = new ExportHelper(entries.length, 'creature');
	helper.start();

	for (const entry of entries) {
		if (helper.isCancelled())
			break;

		const creature = typeof entry === 'object' ? entry : DBCreatureList.get_creature_by_id(entry);
		if (!creature)
			continue;

		const file_manifest = [];
		const creature_name = ExportHelper.sanitizeFilename(creature.name);

		const display_info = DBCreatures.getDisplayInfo(creature.displayID);

		if (display_info?.extendedDisplayInfoID > 0) {
			// character-model creature export
			try {
				const extra = DBCreatureDisplayExtra.get_extra(display_info.extendedDisplayInfoID);
				if (!extra) {
					helper.mark(creature_name, false, 'No extended display info found');
					continue;
				}

				const chr_model_id = DBCharacterCustomization.get_chr_model_id(extra.DisplayRaceID, extra.DisplaySexID);
				const file_data_id = chr_model_id !== undefined ? DBCharacterCustomization.get_model_file_data_id(chr_model_id) : undefined;
				if (!file_data_id) {
					helper.mark(creature_name, false, 'No character model found');
					continue;
				}

				const data = await casc.getFile(file_data_id);
				const file_name = listfile.getByID(file_data_id) ?? listfile.formatUnknownFile(file_data_id, '.m2');
				const export_path = ExportHelper.getExportPath('creatures/' + creature_name + '.m2');

				const is_active = file_data_id === active_file_data_id && is_character_model;

				if (format === 'RAW') {
					const exporter = new M2Exporter(data, [], file_data_id);
					await export_paths?.writeLine(export_path);
					await exporter.exportRaw(export_path, helper, file_manifest);
					helper.mark(creature_name, true);
				} else {
					const ext = modelViewerUtils.EXPORT_EXTENSIONS[format] ?? '.gltf';
					const final_path = ExportHelper.replaceExtension(export_path, ext);
					const exporter = new M2Exporter(data, [], file_data_id);

					// apply character textures if this is the active preview
					if (is_active) {
						for (const [texture_type, chr_material] of creature_chr_materials)
							exporter.addURITexture(texture_type, chr_material.getURI());

						exporter.setGeosetMask(core.view.creatureViewerGeosets);
					} else {
						// build textures for export
						const export_materials = new Map();
						const customization_choices = DBCreatureDisplayExtra.get_customization_choices(display_info.extendedDisplayInfoID);
						const layout_id = DBCharacterCustomization.get_texture_layout_id(chr_model_id);

						let baked_npc_blp = null;
						const bake_id = extra.HDBakeMaterialResourcesID || extra.BakeMaterialResourcesID;
						if (bake_id > 0) {
							const bake_fdid = DBCharacterCustomization.get_texture_file_data_id(bake_id);
							if (bake_fdid) {
								try {
									const bake_data = await casc.getFile(bake_fdid);
									baked_npc_blp = new BLPFile(bake_data);
								} catch (e) {
									log.write('Failed to load baked NPC texture %d: %s', bake_fdid, e.message);
								}
							}
						}

						await character_appearance.apply_customization_textures(null, customization_choices, layout_id, export_materials, baked_npc_blp);

						for (const [texture_type, chr_material] of export_materials) {
							await chr_material.update();
							exporter.addURITexture(texture_type, chr_material.getURI());
						}

						character_appearance.dispose_materials(export_materials);
					}

					const mark_file_name = ExportHelper.getRelativeExport(final_path);

					if (format === 'OBJ')
						await exporter.exportAsOBJ(final_path, false, helper, file_manifest);
					else if (format === 'STL')
						await exporter.exportAsSTL(final_path, false, helper, file_manifest);
					else
						await exporter.exportAsGLTF(final_path, helper, format.toLowerCase());

					await export_paths?.writeLine('M2_' + format + ':' + final_path);
					helper.mark(mark_file_name, true);
				}
			} catch (e) {
				helper.mark(creature_name, false, e.message, e.stack);
			}

			continue;
		}

		const file_data_id = DBCreatures.getFileDataIDByDisplayID(creature.displayID);
		if (!file_data_id) {
			helper.mark(creature_name, false, 'No model data found');
			continue;
		}

		try {
			const data = await casc.getFile(file_data_id);
			const model_type = modelViewerUtils.detect_model_type(data);
			const file_ext = modelViewerUtils.get_model_extension(model_type);
			const file_name = listfile.getByID(file_data_id) ?? listfile.formatUnknownFile(file_data_id, file_ext);
			const export_path = ExportHelper.getExportPath('creatures/' + creature_name + file_ext);

			const is_active = file_data_id === active_file_data_id;

			const mark_name = await modelViewerUtils.export_model({
				core,
				data,
				file_data_id,
				file_name,
				format,
				export_path,
				helper,
				file_manifest,
				variant_textures: is_active ? selected_variant_texture_ids : [],
				geoset_mask: is_active ? core.view.creatureViewerGeosets : null,
				wmo_group_mask: is_active ? core.view.creatureViewerWMOGroups : null,
				wmo_set_mask: is_active ? core.view.creatureViewerWMOSets : null,
				export_paths
			});

			helper.mark(mark_name, true);
		} catch (e) {
			helper.mark(creature_name, false, e.message, e.stack);
		}
	}

	helper.finish();
	export_paths?.close();
};

module.exports = {
	register() {
		this.registerNavButton('Creatures', 'nessy.svg', InstallType.CASC);
	},

	template: `
		<div class="tab list-tab" id="tab-creatures">
			<div class="list-container">
				<component :is="$components.Listbox" v-model:selection="$core.view.selectionCreatures" v-model:filter="$core.view.userInputFilterCreatures" :items="$core.view.listfileCreatures" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="creature" persistscrollkey="creatures" @contextmenu="handle_listbox_context"></component>
				<component :is="$components.ContextMenu" :node="$core.view.contextMenus.nodeListbox" v-slot:default="context" @close="$core.view.contextMenus.nodeListbox = null">
					<span @click.self="copy_creature_names(context.node.selection)">Copy name{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="copy_creature_ids(context.node.selection)">Copy ID{{ context.node.count > 1 ? 's' : '' }}</span>
				</component>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="$core.view.userInputFilterCreatures" placeholder="Filter creatures..."/>
			</div>
			<div class="preview-container">
				<component :is="$components.ResizeLayer" @resize="$core.view.onTextureRibbonResize" id="texture-ribbon" v-if="$core.view.config.modelViewerShowTextures && $core.view.textureRibbonStack.length > 0">
					<div id="texture-ribbon-prev" v-if="$core.view.textureRibbonPage > 0" @click.self="$core.view.textureRibbonPage--"></div>
					<div v-for="slot in $core.view.textureRibbonDisplay" :title="slot.displayName" :style="{ backgroundImage: 'url(' + slot.src + ')' }" class="slot" @click="$core.view.contextMenus.nodeTextureRibbon = slot"></div>
					<div id="texture-ribbon-next" v-if="$core.view.textureRibbonPage < $core.view.textureRibbonMaxPages - 1" @click.self="$core.view.textureRibbonPage++"></div>
					<component :is="$components.ContextMenu" :node="$core.view.contextMenus.nodeTextureRibbon" v-slot:default="context" @close="$core.view.contextMenus.nodeTextureRibbon = null">
						<span @click.self="preview_texture(context.node.fileDataID, context.node.displayName)">Preview {{ context.node.displayName }}</span>
						<span @click.self="export_ribbon_texture(context.node.fileDataID, context.node.displayName)">Export {{ context.node.displayName }}</span>
						<span @click.self="$core.view.copyToClipboard(context.node.fileDataID)">Copy file data ID to clipboard</span>
						<span @click.self="$core.view.copyToClipboard(context.node.displayName)">Copy texture name to clipboard</span>
					</component>
				</component>
				<div id="creature-texture-preview" v-if="$core.view.creatureTexturePreviewURL.length > 0" class="preview-background">
					<div id="creature-texture-preview-toast" @click="$core.view.creatureTexturePreviewURL = ''">Close Preview</div>
					<div class="image" :style="{ 'max-width': $core.view.creatureTexturePreviewWidth + 'px', 'max-height': $core.view.creatureTexturePreviewHeight + 'px' }">
						<div class="image" :style="{ 'background-image': 'url(' + $core.view.creatureTexturePreviewURL + ')' }"></div>
						<div class="uv-overlay" v-if="$core.view.creatureTexturePreviewUVOverlay" :style="{ 'background-image': 'url(' + $core.view.creatureTexturePreviewUVOverlay + ')' }"></div>
					</div>
					<div id="uv-layer-buttons" v-if="$core.view.creatureViewerUVLayers.length > 0">
						<button
							v-for="layer in $core.view.creatureViewerUVLayers"
							:key="layer.name"
							:class="{ active: layer.active }"
							@click="toggle_uv_layer(layer.name)"
							class="uv-layer-button"
						>
							{{ layer.name }}
						</button>
					</div>
				</div>
				<div class="preview-background" id="creature-preview">
					<input v-if="$core.view.config.modelViewerShowBackground" type="color" id="background-color-input" v-model="$core.view.config.modelViewerBackgroundColor" title="Click to change background color"/>
					<component :is="$components.ModelViewerGL" v-if="$core.view.creatureViewerContext" :context="$core.view.creatureViewerContext"></component>
					<div v-if="$core.view.creatureViewerAnims && $core.view.creatureViewerAnims.length > 0 && !$core.view.creatureTexturePreviewURL" class="preview-dropdown-overlay">
						<select v-model="$core.view.creatureViewerAnimSelection">
							<option v-for="animation in $core.view.creatureViewerAnims" :key="animation.id" :value="animation.id">
								{{ animation.label }}
							</option>
						</select>
						<div v-if="$core.view.creatureViewerAnimSelection !== 'none'" class="anim-controls">
							<button class="anim-btn anim-step-left" :class="{ disabled: !$core.view.creatureViewerAnimPaused }" @click="step_animation(-1)" title="Previous frame"></button>
							<button class="anim-btn" :class="$core.view.creatureViewerAnimPaused ? 'anim-play' : 'anim-pause'" @click="toggle_animation_pause()" :title="$core.view.creatureViewerAnimPaused ? 'Play' : 'Pause'"></button>
							<button class="anim-btn anim-step-right" :class="{ disabled: !$core.view.creatureViewerAnimPaused }" @click="step_animation(1)" title="Next frame"></button>
							<div class="anim-scrubber" @mousedown="start_scrub" @mouseup="end_scrub">
								<input type="range" min="0" :max="$core.view.creatureViewerAnimFrameCount - 1" :value="$core.view.creatureViewerAnimFrame" @input="seek_animation($event.target.value)" />
								<div class="anim-frame-display">{{ $core.view.creatureViewerAnimFrame }}</div>
							</div>
						</div>
					</div>
				</div>
			</div>
			<div class="preview-controls">
				<component :is="$components.MenuButton" :options="$core.view.menuButtonCreatures" :default="$core.view.config.exportCreatureFormat" @change="$core.view.config.exportCreatureFormat = $event" class="upward" :disabled="$core.view.isBusy" @click="export_creatures"></component>
			</div>
			<div id="creature-sidebar" class="sidebar">
				<span class="header">Preview</span>
				<label class="ui-checkbox" title="Automatically preview a creature when selecting it">
					<input type="checkbox" v-model="$core.view.config.creatureAutoPreview"/>
					<span>Auto Preview</span>
				</label>
				<label class="ui-checkbox" title="Automatically adjust camera when selecting a new creature">
					<input type="checkbox" v-model="$core.view.creatureViewerAutoAdjust"/>
					<span>Auto Camera</span>
				</label>
				<label class="ui-checkbox" title="Show a grid in the 3D viewport">
					<input type="checkbox" v-model="$core.view.config.modelViewerShowGrid"/>
					<span>Show Grid</span>
				</label>
				<label class="ui-checkbox" title="Render the preview model as a wireframe">
					<input type="checkbox" v-model="$core.view.config.modelViewerWireframe"/>
					<span>Show Wireframe</span>
				</label>
				<label class="ui-checkbox" title="Show the model's bone structure">
					<input type="checkbox" v-model="$core.view.config.modelViewerShowBones"/>
					<span>Show Bones</span>
				</label>
				<label class="ui-checkbox" title="Show model textures in the preview pane">
					<input type="checkbox" v-model="$core.view.config.modelViewerShowTextures"/>
					<span>Show Textures</span>
				</label>
				<label class="ui-checkbox" title="Show a background color in the 3D viewport">
					<input type="checkbox" v-model="$core.view.config.modelViewerShowBackground"/>
					<span>Show Background</span>
				</label>
				<span class="header">Export</span>
				<label class="ui-checkbox" title="Include textures when exporting models">
					<input type="checkbox" v-model="$core.view.config.modelsExportTextures"/>
					<span>Textures</span>
				</label>
				<label v-if="$core.view.config.modelsExportTextures" class="ui-checkbox" title="Include alpha channel in exported model textures">
					<input type="checkbox" v-model="$core.view.config.modelsExportAlpha"/>
					<span>Texture Alpha</span>
				</label>
				<label v-if="$core.view.config.exportCreatureFormat === 'GLTF' && $core.view.creatureViewerActiveType === 'm2'" class="ui-checkbox" title="Include animations in export">
					<input type="checkbox" v-model="$core.view.config.modelsExportAnimations"/>
					<span>Export animations</span>
				</label>
				<template v-if="$core.view.creatureViewerActiveType === 'm2'">
					<span class="header">Geosets</span>
					<component :is="$components.Checkboxlist" :items="$core.view.creatureViewerGeosets"></component>
					<div class="list-toggles">
						<a @click="$core.view.setAllCreatureGeosets(true)">Enable All</a> / <a @click="$core.view.setAllCreatureGeosets(false)">Disable All</a>
					</div>
					<template v-if="$core.view.config.modelsExportTextures">
						<span class="header">Skins</span>
						<component :is="$components.Listboxb" :items="$core.view.creatureViewerSkins" v-model:selection="$core.view.creatureViewerSkinsSelection" :single="true"></component>
					</template>
				</template>
				<template v-if="$core.view.creatureViewerActiveType === 'wmo'">
					<span class="header">WMO Groups</span>
					<component :is="$components.Checkboxlist" :items="$core.view.creatureViewerWMOGroups"></component>
					<div class="list-toggles">
						<a @click="$core.view.setAllCreatureWMOGroups(true)">Enable All</a> / <a @click="$core.view.setAllCreatureWMOGroups(false)">Disable All</a>
					</div>
					<span class="header">Doodad Sets</span>
					<component :is="$components.Checkboxlist" :items="$core.view.creatureViewerWMOSets"></component>
				</template>
			</div>
		</div>
	`,

	methods: {
		async initialize() {
			this.$core.showLoadingScreen(5);

			await this.$core.progressLoadingScreen('Loading model file data...');
			await DBModelFileData.initializeModelFileData();

			await this.$core.progressLoadingScreen('Loading creature data...');
			await DBCreatures.initializeCreatureData();

			await this.$core.progressLoadingScreen('Loading character customization data...');
			await DBCharacterCustomization.ensureInitialized();

			await this.$core.progressLoadingScreen('Loading creature display extras...');
			await DBCreatureDisplayExtra.ensureInitialized();

			await this.$core.progressLoadingScreen('Loading creature list...');
			await DBCreatureList.initialize_creature_list();

			const creatures = DBCreatureList.get_all_creatures();
			const entries = [];

			for (const [id, creature] of creatures)
				entries.push(`${creature.name} [${id}]`);

			entries.sort((a, b) => {
				const name_a = a.replace(/\s+\[\d+\]$/, '').toLowerCase();
				const name_b = b.replace(/\s+\[\d+\]$/, '').toLowerCase();
				return name_a.localeCompare(name_b);
			});

			this.$core.view.listfileCreatures = entries;

			if (!this.$core.view.creatureViewerContext)
				this.$core.view.creatureViewerContext = Object.seal({ getActiveRenderer: () => active_renderer, gl_context: null, fitCamera: null });

			this.$core.hideLoadingScreen();
		},

		handle_listbox_context(data) {
			listboxContext.handle_context_menu(data);
		},

		copy_creature_names(selection) {
			const names = selection.map(entry => {
				if (typeof entry === 'string') {
					const match = entry.match(/^(.+)\s+\[(\d+)\]$/);
					return match ? match[1] : entry;
				}
				return entry.name || entry;
			});
			nw.Clipboard.get().set(names.join('\n'), 'text');
		},

		copy_creature_ids(selection) {
			const ids = selection.map(entry => {
				if (typeof entry === 'string') {
					const match = entry.match(/\[(\d+)\]$/);
					return match ? match[1] : '';
				}
				return entry.id?.toString() || '';
			}).filter(id => id);
			nw.Clipboard.get().set(ids.join('\n'), 'text');
		},

		async preview_texture(file_data_id, display_name) {
			const state = modelViewerUtils.create_view_state(this.$core, 'creature');
			await modelViewerUtils.preview_texture_by_id(this.$core, state, active_renderer, file_data_id, display_name);
		},

		async export_ribbon_texture(file_data_id, display_name) {
			await textureExporter.exportSingleTexture(file_data_id);
		},

		toggle_uv_layer(layer_name) {
			const state = modelViewerUtils.create_view_state(this.$core, 'creature');
			modelViewerUtils.toggle_uv_layer(state, active_renderer, layer_name);
		},

		async export_creatures() {
			const user_selection = this.$core.view.selectionCreatures;
			if (user_selection.length === 0) {
				this.$core.setToast('info', 'You didn\'t select any creatures to export; you should do that first.');
				return;
			}

			const creature_items = user_selection.map(entry => {
				if (typeof entry === 'string') {
					const match = entry.match(/\[(\d+)\]$/);
					if (match)
						return DBCreatureList.get_creature_by_id(parseInt(match[1]));
				}
				return entry;
			}).filter(item => item);

			await export_files(this.$core, creature_items);
		},

		toggle_animation_pause() {
			if (!active_renderer)
				return;

			const state = modelViewerUtils.create_view_state(this.$core, 'creature');
			const paused = !state.animPaused;
			state.animPaused = paused;
			active_renderer.set_animation_paused(paused);
		},

		step_animation(delta) {
			const state = modelViewerUtils.create_view_state(this.$core, 'creature');
			if (!state.animPaused || !active_renderer)
				return;

			active_renderer.step_animation_frame(delta);
			state.animFrame = active_renderer.get_animation_frame();
		},

		seek_animation(frame) {
			const state = modelViewerUtils.create_view_state(this.$core, 'creature');
			if (!active_renderer)
				return;

			active_renderer.set_animation_frame(parseInt(frame));
			state.animFrame = parseInt(frame);
		},

		start_scrub() {
			const state = modelViewerUtils.create_view_state(this.$core, 'creature');
			this._was_paused_before_scrub = state.animPaused;
			if (!this._was_paused_before_scrub) {
				state.animPaused = true;
				active_renderer?.set_animation_paused?.(true);
			}
		},

		end_scrub() {
			const state = modelViewerUtils.create_view_state(this.$core, 'creature');
			if (!this._was_paused_before_scrub) {
				state.animPaused = false;
				active_renderer?.set_animation_paused?.(false);
			}
		}
	},

	async mounted() {
		await this.initialize();

		this.$core.view.$watch('creatureViewerSkinsSelection', async selection => {
			if (!active_renderer || active_skins.size === 0)
				return;

			const selected = selection[0];
			if (!selected)
				return;

			const display = active_skins.get(selected.id);

			let curr_geosets = this.$core.view.creatureViewerGeosets;

			if (display.extraGeosets !== undefined) {
				for (const geoset of curr_geosets) {
					if (geoset.id > 0 && geoset.id < 900)
						geoset.checked = false;
				}

				for (const extra_geoset of display.extraGeosets) {
					for (const geoset of curr_geosets) {
						if (geoset.id === extra_geoset)
							geoset.checked = true;
					}
				}
			} else {
				for (const geoset of curr_geosets) {
					const id = geoset.id.toString();
					geoset.checked = (id.endsWith('0') || id.endsWith('01'));
				}
			}

			if (display.textures.length > 0)
				selected_variant_texture_ids = [...display.textures];

			active_renderer.applyReplaceableTextures(display);
		});

		const state = modelViewerUtils.create_view_state(this.$core, 'creature');

		this.$core.view.$watch('creatureViewerAnimSelection', async selected_animation_id => {
			if (this.$core.view.creatureViewerAnims.length === 0)
				return;

			await modelViewerUtils.handle_animation_change(
				active_renderer,
				state,
				selected_animation_id,
				() => this.$core.view.creatureViewerContext?.fitCamera?.()
			);
		});

		this.$core.view.$watch('selectionCreatures', async selection => {
			if (!this.$core.view.config.creatureAutoPreview)
				return;

			const first = selection[0];
			if (!first || this.$core.view.isBusy)
				return;

			let creature_id;
			if (typeof first === 'string') {
				const match = first.match(/\[(\d+)\]$/);
				if (match)
					creature_id = parseInt(match[1]);
			}

			if (!creature_id)
				return;

			const creature = DBCreatureList.get_creature_by_id(creature_id);
			if (creature)
				preview_creature(this.$core, creature);
		});

		this.$core.events.on('toggle-uv-layer', (layer_name) => {
			const state = modelViewerUtils.create_view_state(this.$core, 'creature');
			modelViewerUtils.toggle_uv_layer(state, active_renderer, layer_name);
		});
	},

	getActiveRenderer: () => active_renderer
};
