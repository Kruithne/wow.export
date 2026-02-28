/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
import log from '../log.js';
import * as platform from '../platform.js';
import BufferWrapper from '../buffer.js';
import generics from '../generics.js';
import CharMaterialRenderer from '../3D/renderers/CharMaterialRenderer.js';
import M2RendererGL from '../3D/renderers/M2RendererGL.js';
import M2Exporter from '../3D/exporters/M2Exporter.js';
import CharacterExporter from '../3D/exporters/CharacterExporter.js';
import { listfile, dbc } from '../../views/main/rpc.js';
import db2 from '../db2-proxy.js';
import ExportHelper from '../export-helper.js';
import { wmv_parse } from '../wmv.js';
import { wowhead_parse } from '../wowhead.js';
import InstallType from '../install-type.js';
import charTextureOverlay from '../ui/char-texture-overlay.js';
import PNGWriter from '../png-writer.js';
import { EQUIPMENT_SLOTS, ATTACHMENT_ID, get_slot_name, get_attachment_ids_for_slot, get_slot_layer } from '../wow/EquipmentSlots.js';
import character_appearance from '../ui/character-appearance.js';
import { DBCharacterCustomization, DBItems, DBItemCharTextures, DBItemGeosets, DBItemModels, DBGuildTabard } from '../db-proxy.js';
import AnimMapper from '../3D/AnimMapper.js';

// geoset group constants (CG enum from DBItemGeosets)
const CG = {
	SLEEVES: 8,
	KNEEPADS: 9,
	CHEST: 10,
	PANTS: 11,
	TABARD: 12,
	TROUSERS: 13,
	CLOAK: 15,
	BELT: 18,
	FEET: 20,
	TORSO: 22,
	HAND_ATTACHMENT: 23,
	SHOULDERS: 26,
	HELM: 27,
	ARM_UPPER: 28,
	BOOTS: 5,
	GLOVES: 4,
	SKULL: 21
};

// slot id to geoset group mapping for collection models
const SLOT_TO_GEOSET_GROUPS = {
	1: [{ group_index: 0, char_geoset: CG.HELM }, { group_index: 1, char_geoset: CG.SKULL }],
	5: [{ group_index: 0, char_geoset: CG.SLEEVES }, { group_index: 1, char_geoset: CG.CHEST }, { group_index: 2, char_geoset: CG.TROUSERS }, { group_index: 3, char_geoset: CG.TORSO }, { group_index: 4, char_geoset: CG.ARM_UPPER }],
	6: [{ group_index: 0, char_geoset: CG.BELT }],
	7: [{ group_index: 0, char_geoset: CG.PANTS }, { group_index: 1, char_geoset: CG.KNEEPADS }, { group_index: 2, char_geoset: CG.TROUSERS }],
	8: [{ group_index: 0, char_geoset: CG.BOOTS }, { group_index: 1, char_geoset: CG.FEET }],
	10: [{ group_index: 0, char_geoset: CG.GLOVES }, { group_index: 1, char_geoset: CG.HAND_ATTACHMENT }],
	15: [{ group_index: 0, char_geoset: CG.CLOAK }]
};

function get_slot_geoset_mapping(slot_id) {
	return SLOT_TO_GEOSET_GROUPS[slot_id] || null;
}

/**
 * Get current character race ID and gender index from view state
 * @param {object} core
 * @returns {{ raceID: number, genderIndex: number }|null}
 */
async function get_current_race_gender(core) {
	const race_selection = core.view.chrCustRaceSelection?.[0];
	const model_selection = core.view.chrCustModelSelection?.[0];

	if (!race_selection || !model_selection)
		return null;

	const race_id = race_selection.id;
	const models_for_race = await DBCharacterCustomization.get_race_models(race_id);

	if (!models_for_race)
		return null;

	// find the sex that matches the selected model ID
	for (const [sex, model_id] of models_for_race) {
		if (model_id === model_selection.id)
			return { raceID: race_id, genderIndex: sex };
	}

	return null;
}


//region state
const active_skins = new Map();
let gl_context = null;

let active_renderer;
let active_model;

const skinned_model_renderers = new Map();
const skinned_model_meshes = new Set();

const chr_materials = new Map();

// equipment model renderers (slot_id -> { renderers: [{renderer, attachment_id}], item_id })
const equipment_model_renderers = new Map();

// collection model renderers (slot_id -> { renderers: [renderer, ...], item_id })
// collection models render at origin with shared bone matrices from character
const collection_model_renderers = new Map();

let current_char_component_texture_layout_id = 0;
let watcher_cleanup_funcs = [];
let is_importing = false;

// thumbnail camera presets by race_id, then gender (0=male, 1=female)
// format: [cam_x, cam_y, cam_z, tgt_x, tgt_y, tgt_z, rot]
const THUMBNAIL_PRESETS = {
	1: { // human
		0: [0.008, 1.787, 0.813, 0.008, 1.714, 0.444, -1.711],
		1: [-0.014, 1.664, 0.736, -0.014, 1.610, 0.464, -1.711]
	},
	2: { // orc
		0: [-0.008, 1.797, 1.293, -0.008, 1.630, 0.460, -1.666],
		1: [0.036, 1.869, 0.550, 0.036, 1.842, 0.418, -1.836]
	},
	3: { // dwarf
		0: [0.032, 1.297, 0.757, 0.032, 1.253, 0.536, -1.641],
		1: [0, 1.285, 0.726, 0, 1.247, 0.537, -1.836]
	},
	4: { // night elf
		0: [0.025, 2.152, 0.852, 0.025, 2.057, 0.375, -1.581],
		1: [0.014, 2.051, 0.741, 0.014, 1.981, 0.390, -1.671]
	},
	5: { // undead
		0: [0.008, 1.570, 0.767, 0.008, 1.513, 0.484, -1.646],
		1: [-0.010, 1.643, 0.861, -0.010, 1.565, 0.473, -1.791]
	},
	6: { // tauren
		0: [-0.048, 2.186, 1.806, -0.048, 1.906, 0.405, -1.686],
		1: [-0.034, 2.389, 1.135, -0.034, 2.230, 0.340, -1.771]
	},
	7: { // gnome
		0: [0.037, 0.897, 0.893, 0.037, 0.842, 0.618, -1.761],
		1: [0.046, 0.864, 0.766, 0.046, 0.835, 0.619, -1.761]
	},
	8: { // troll
		0: [-0.014, 1.964, 1.222, -0.014, 1.805, 0.425, -1.771],
		1: [-0.043, 2.114, 0.728, -0.043, 2.044, 0.378, -1.771]
	},
	9: { // goblin
		0: [0.007, 1.081, 0.767, 0.007, 1.044, 0.578, -1.391],
		1: [0.051, 1.133, 0.666, 0.051, 1.112, 0.564, -1.761]
	},
	10: { // blood elf
		0: [-0.068, 1.930, 0.583, -0.068, 1.895, 0.407, -1.526],
		1: [0.015, 1.749, 0.543, 0.015, 1.728, 0.441, -1.496]
	},
	11: { // draenei
		0: [-0.047, 2.227, 1.112, -0.047, 2.079, 0.371, -1.611],
		1: [0.035, 2.118, 0.744, 0.035, 2.045, 0.377, -1.836]
	},
	22: { // worgen
		0: [-0.001, 1.885, 1.327, -0.001, 1.708, 0.445, -1.736],
		1: [-0.005, 2.161, 0.904, -0.005, 2.055, 0.375, -1.736]
	},
	23: { // goblin
		0: [0.025, 1.824, 0.734, 0.025, 1.764, 0.434, -1.726],
		1: [0.004, 1.703, 0.701, 0.004, 1.654, 0.456, -1.726]
	},
	24: { // pandaren
		0: [-0.026, 2.060, 0.704, -0.026, 1.997, 0.387, -1.856],
		1: [0.015, 1.903, 0.984, 0.015, 1.792, 0.428, -1.731]
	},
	27: { // nightborne
		0: [0.034, 2.124, 0.833, 0.034, 2.034, 0.380, -1.671],
		1: [0.015, 2.047, 0.706, 0.015, 1.983, 0.390, -1.671]
	},
	28: { // highmountain tauren
		0: [-0.002, 2.227, 1.927, -0.002, 1.922, 0.402, -1.541],
		1: [-0.026, 2.295, 1.345, -0.026, 2.099, 0.367, -1.541]
	},
	29: { // void elf
		0: [-0.074, 1.833, 0.784, -0.074, 1.763, 0.434, -1.666],
		1: [0.019, 1.717, 0.650, 0.019, 1.677, 0.451, -1.711]
	},
	30: { // lightforged draenei
		0: [-0.078, 2.224, 1.129, -0.078, 2.072, 0.372, -1.861],
		1: [0.050, 2.121, 0.690, 0.050, 2.058, 0.375, -1.726]
	},
	31: { // zandalari troll
		0: [-0.030, 2.455, 1.124, -0.030, 2.296, 0.327, -1.536],
		1: [-0.058, 2.430, 0.909, -0.058, 2.313, 0.324, -1.536]
	},
	32: { // kul tiran
		0: [0.037, 2.220, 1.090, 0.037, 2.076, 0.371, -1.521],
		1: [0.013, 2.148, 0.782, 0.013, 2.067, 0.373, -1.726]
	},
	34: { // dark iron dwarf
		0: [0.021, 1.312, 0.681, 0.021, 1.282, 0.530, -1.491],
		1: [0.009, 1.366, 0.620, 0.009, 1.345, 0.517, -1.491]
	},
	35: { // vulpera
		0: [0.009, 1.075, 0.801, 0.009, 1.031, 0.580, -1.736],
		1: [0.015, 1.039, 0.847, 0.015, 0.987, 0.589, -1.711]
	},
	36: { // mag'har orc
		0: [-0.022, 1.742, 1.356, -0.022, 1.565, 0.473, -1.701],
		1: [0.032, 1.831, 0.617, 0.032, 1.793, 0.428, -1.841]
	},
	37: { // mechagnome
		0: [0.028, 0.829, 0.965, 0.028, 0.763, 0.634, -1.806],
		1: [0.051, 0.823, 0.890, 0.051, 0.771, 0.632, -1.831]
	},
	52: { // dracthyr (alliance)
		0: [-0.018, 2.501, 0.863, -0.018, 2.390, 0.308, -1.326],
		1: [-0.018, 2.501, 0.863, -0.018, 2.390, 0.308, -1.326]
	},
	70: { // dracthyr (horde)
		0: [-0.018, 2.501, 0.863, -0.018, 2.390, 0.308, -1.326],
		1: [-0.018, 2.501, 0.863, -0.018, 2.390, 0.308, -1.326]
	},
	75: { // dracthyr visage (alliance)
		0: [-0.043, 1.839, 0.716, -0.043, 1.782, 0.430, -1.666],
		1: [0.009, 1.725, 0.553, 0.009, 1.704, 0.446, -1.746]
	},
	76: { // dracthyr visage (horde)
		0: [-0.043, 1.839, 0.716, -0.043, 1.782, 0.430, -1.666],
		1: [0.009, 1.725, 0.553, 0.009, 1.704, 0.446, -1.746]
	},
	84: { // earthen (horde)
		0: [0.058, 1.434, 1.022, 0.058, 1.333, 0.520, -1.746],
		1: [0.027, 1.473, 0.760, 0.027, 1.422, 0.502, -1.746]
	},
	85: { // earthen (alliance)
		0: [0.058, 1.434, 1.022, 0.058, 1.333, 0.520, -1.746],
		1: [0.027, 1.473, 0.760, 0.027, 1.422, 0.502, -1.746]
	},
	86: { // harronir
		0: [0.003, 2.222, 0.639, 0.003, 2.165, 0.353, -1.571],
		1: [0.006, 2.078, 0.637, 0.006, 2.027, 0.381, -1.571]
	}
};

function reset_module_state() {
	active_skins.clear();
	skinned_model_renderers.clear();
	skinned_model_meshes.clear();
	clear_materials();
	dispose_equipment_models();
	dispose_collection_models();
	current_char_component_texture_layout_id = 0;

	if (active_renderer) {
		active_renderer.dispose();
		active_renderer = undefined;
	}
	active_model = undefined;

	for (const cleanup of watcher_cleanup_funcs)
		cleanup();
	watcher_cleanup_funcs = [];
}

//endregion

//region appearance
async function refresh_character_appearance(core) {
	if (!active_renderer || is_importing)
		return;

	log.write('Refreshing character appearance...');

	await update_geosets(core);
	await update_textures(core);
	await update_equipment_models(core);

	log.write('Character appearance refresh complete');
}

/**
 * Updates all geoset visibility based on customization choices and equipped items.
 * Order: 1) Reset to model defaults, 2) Apply customization, 3) Apply equipment
 */
async function update_geosets(core) {
	if (!active_renderer)
		return;

	const geosets = core.view.chrCustGeosets;
	if (!geosets || geosets.length === 0)
		return;

	// steps 1+2: reset to defaults and apply customization geosets
	await character_appearance.apply_customization_geosets(geosets, core.view.chrCustActiveChoices);

	// step 3: apply equipment geosets (overrides customization where applicable)
	const equipped_items = core.view.chrEquippedItems;
	if (equipped_items && Object.keys(equipped_items).length > 0) {
		const equipment_geosets = await DBItemGeosets.calculateEquipmentGeosets(equipped_items);
		const affected_groups = await DBItemGeosets.getAffectedCharGeosets(equipped_items);

		for (const char_geoset of affected_groups) {
			const base = char_geoset * 100;
			const range_start = base + 1;
			const range_end = base + 99;

			// hide all geosets in this group's range
			for (const geoset of geosets) {
				if (geoset.id >= range_start && geoset.id <= range_end)
					geoset.checked = false;
			}

			// show the specific geoset for this group
			const value = equipment_geosets.get(char_geoset);
			if (value !== undefined) {
				const target_geoset_id = base + value;
				for (const geoset of geosets) {
					if (geoset.id === target_geoset_id)
						geoset.checked = true;
				}
			}
		}

		// apply helmet hide geosets (hair, ears, etc.)
		const head_item = equipped_items[1];
		if (head_item) {
			const char_info = await get_current_race_gender(core);
			if (char_info) {
				const hide_groups = await DBItemGeosets.getHelmetHideGeosets(head_item, char_info.raceID, char_info.genderIndex);
				for (const char_geoset of hide_groups) {
					const base = char_geoset * 100;
					const range_start = base + 1;
					const range_end = base + 99;

					for (const geoset of geosets) {
						if (geoset.id >= range_start && geoset.id <= range_end)
							geoset.checked = false;
					}
				}
			}
		}
	}

	// step 4: sync to renderer
	active_renderer.updateGeosets();
}

/**
 * Updates all character textures based on baked NPC texture, customization, and equipment.
 * Order: 1) Reset materials, 2) Baked NPC texture, 3) Customization, 4) Equipment, 5) Upload to GPU
 */
async function update_textures(core) {
	if (!active_renderer)
		return;

	// steps 1-3: reset, apply baked NPC texture, apply customization textures
	const baked_npc_texture_type = await character_appearance.apply_customization_textures(
		active_renderer,
		core.view.chrCustActiveChoices,
		current_char_component_texture_layout_id,
		chr_materials,
		core.view.chrCustBakedNPCTexture || null
	);

	// step 4: apply equipment textures
	const equipped_items = core.view.chrEquippedItems;
	if (equipped_items && Object.keys(equipped_items).length > 0) {
		const char_info = await get_current_race_gender(core);
		const sections = await DBCharacterCustomization.get_texture_sections(current_char_component_texture_layout_id);
		if (sections) {
			const section_by_type = new Map();
			for (const section of sections)
				section_by_type.set(section.SectionType, section);

			const texture_layer_map = await DBCharacterCustomization.get_model_texture_layer_map();
			let base_layer = null;
			for (const [key, layer] of texture_layer_map) {
				if (!key.startsWith(current_char_component_texture_layout_id + '-'))
					continue;

				if (layer.TextureSectionTypeBitMask === -1 && layer.TextureType === 1) {
					base_layer = layer;
					break;
				}
			}

			const layers_by_section = new Map();
			for (const [key, layer] of texture_layer_map) {
				if (!key.startsWith(current_char_component_texture_layout_id + '-'))
					continue;

				if (layer.TextureSectionTypeBitMask === -1)
					continue;

				for (let section_type = 0; section_type < 9; section_type++) {
					if ((1 << section_type) & layer.TextureSectionTypeBitMask) {
						if (!layers_by_section.has(section_type))
							layers_by_section.set(section_type, layer);
					}
				}
			}

			if (base_layer) {
				for (let section_type = 0; section_type < 9; section_type++) {
					if (!layers_by_section.has(section_type))
						layers_by_section.set(section_type, base_layer);
				}
			}

			for (const [slot_id, item_id] of Object.entries(equipped_items)) {
				// guild tabards use custom composition pipeline
				if (await DBGuildTabard.isGuildTabard(item_id))
					continue;

				const item_textures = await DBItemCharTextures.getItemTextures(item_id, char_info?.raceID, char_info?.genderIndex);
				if (!item_textures)
					continue;

				for (const texture of item_textures) {
					const section = section_by_type.get(texture.section);
					if (!section)
						continue;

					const layer = layers_by_section.get(texture.section);
					if (!layer)
						continue;

					const chr_model_material = await DBCharacterCustomization.get_model_material(current_char_component_texture_layout_id, layer.TextureType);
					if (!chr_model_material)
						continue;

					let chr_material;
					if (!chr_materials.has(chr_model_material.TextureType)) {
						chr_material = new CharMaterialRenderer(chr_model_material.TextureType, chr_model_material.Width, chr_model_material.Height);
						chr_materials.set(chr_model_material.TextureType, chr_material);
						await chr_material.init();
					} else {
						chr_material = chr_materials.get(chr_model_material.TextureType);
					}

					const slot_layer = get_slot_layer(Number(slot_id));
					const item_material = {
						ChrModelTextureTargetID: (slot_layer * 100) + texture.section,
						FileDataID: texture.fileDataID
					};

					await chr_material.setTextureTarget(item_material, section, chr_model_material, layer, true);
				}
			}

			// guild tabard texture composition
			const tabard_item_id = equipped_items[19];
			if (tabard_item_id && await DBGuildTabard.isGuildTabard(tabard_item_id)) {
				const tier = await DBGuildTabard.getTabardTier(tabard_item_id);
				const config = core.view.chrGuildTabardConfig;
				const TABARD_LAYER = get_slot_layer(19);

				// component 3 = TORSO_UPPER, component 4 = TORSO_LOWER
				const components = [3, 4];

				const tabard_layers = [];
				for (const comp of components) {
					const bg_fdid = await DBGuildTabard.getBackgroundFDID(tier, comp, config.background);
					if (bg_fdid)
						tabard_layers.push({ fdid: bg_fdid, section_type: comp, target_id: (TABARD_LAYER * 100) + comp, blend_mode: 1 });

					const emblem_fdid = await DBGuildTabard.getEmblemFDID(comp, config.emblem_design, config.emblem_color);
					if (emblem_fdid)
						tabard_layers.push({ fdid: emblem_fdid, section_type: comp, target_id: (TABARD_LAYER * 100) + 10 + comp, blend_mode: 1 });

					const border_fdid = await DBGuildTabard.getBorderFDID(tier, comp, config.border_style, config.border_color);
					if (border_fdid)
						tabard_layers.push({ fdid: border_fdid, section_type: comp, target_id: (TABARD_LAYER * 100) + 20 + comp, blend_mode: 1 });
				}

				for (const tl of tabard_layers) {
					const section = section_by_type.get(tl.section_type);
					if (!section)
						continue;

					const layer = layers_by_section.get(tl.section_type);
					if (!layer)
						continue;

					const chr_model_material = await DBCharacterCustomization.get_model_material(current_char_component_texture_layout_id, layer.TextureType);
					if (!chr_model_material)
						continue;

					let chr_material;
					if (!chr_materials.has(chr_model_material.TextureType)) {
						chr_material = new CharMaterialRenderer(chr_model_material.TextureType, chr_model_material.Width, chr_model_material.Height);
						chr_materials.set(chr_model_material.TextureType, chr_material);
						await chr_material.init();
					} else {
						chr_material = chr_materials.get(chr_model_material.TextureType);
					}

					const item_material = {
						ChrModelTextureTargetID: tl.target_id,
						FileDataID: tl.fdid
					};

					// override BlendMode on the layer for guild tabard composition
					const tabard_texture_layer = { ...layer, BlendMode: tl.blend_mode };
					await chr_material.setTextureTarget(item_material, section, chr_model_material, tabard_texture_layer, true);
				}
			}
		}
	}

	// step 5: upload all textures to GPU
	await character_appearance.upload_textures_to_gpu(active_renderer, chr_materials);
}

/**
 * Updates equipment model renderers based on equipped items.
 * Loads models for newly equipped items, disposes models for unequipped items.
 *
 * Models are split into two categories:
 * - Attachment models: rendered at M2 attachment points (weapons, shoulders, helmets, capes)
 * - Collection models: rendered at origin with shared bone matrices (chest extras, belt buckles, etc.)
 */
async function update_equipment_models(core) {
	if (!gl_context)
		return;

	const equipped_items = core.view.chrEquippedItems;
	const current_slots = new Set(Object.keys(equipped_items).map(Number));

	// dispose attachment models for slots no longer equipped
	for (const slot_id of equipment_model_renderers.keys()) {
		if (!current_slots.has(slot_id)) {
			const entry = equipment_model_renderers.get(slot_id);
			for (const { renderer } of entry.renderers)
				renderer.dispose();

			equipment_model_renderers.delete(slot_id);
			log.write('Disposed equipment models for slot %d', slot_id);
		}
	}

	// dispose collection models for slots no longer equipped
	for (const slot_id of collection_model_renderers.keys()) {
		if (!current_slots.has(slot_id)) {
			const entry = collection_model_renderers.get(slot_id);
			for (const renderer of entry.renderers)
				renderer.dispose();

			collection_model_renderers.delete(slot_id);
			log.write('Disposed collection models for slot %d', slot_id);
		}
	}

	// load models for equipped items
	for (const [slot_id_str, item_id] of Object.entries(equipped_items)) {
		const slot_id = Number(slot_id_str);

		// check if we already have renderers for this slot with same item
		const existing_equipment = equipment_model_renderers.get(slot_id);
		const existing_collection = collection_model_renderers.get(slot_id);
		if ((existing_equipment?.item_id === item_id) && (existing_collection?.item_id === item_id || !existing_collection))
			continue;

		// dispose old renderers if item changed
		if (existing_equipment) {
			for (const { renderer } of existing_equipment.renderers)
				renderer.dispose();

			equipment_model_renderers.delete(slot_id);
		}

		if (existing_collection) {
			for (const renderer of existing_collection.renderers)
				renderer.dispose();

			collection_model_renderers.delete(slot_id);
		}

		// get race/gender for model filtering
		const char_info = await get_current_race_gender(core);

		// get display data for this item (models and textures, filtered by race/gender)
		const display = await DBItemModels.getItemDisplay(item_id, char_info?.raceID, char_info?.genderIndex);
		if (!display || !display.models || display.models.length === 0)
			continue;

		// get attachment IDs for this slot (may be empty for body slots)
		// bows are held in the left hand despite being main-hand items
		let attachment_ids = get_attachment_ids_for_slot(slot_id) || [];
		if (slot_id === 16 && await DBItems.isItemBow(item_id))
			attachment_ids = [ATTACHMENT_ID.HAND_LEFT];

		// split models into attachment vs collection
		// attachment models: up to attachment_ids.length models get attached
		// collection models: remaining models render at origin with shared bones
		const attachment_model_count = Math.min(display.models.length, attachment_ids.length);
		const collection_start_index = attachment_model_count;

		// load attachment models
		if (attachment_model_count > 0) {
			const renderers = [];
			for (let i = 0; i < attachment_model_count; i++) {
				const file_data_id = display.models[i];
				const attachment_id = attachment_ids[i];

				try {
					const file = await core.view.casc.getFile(file_data_id);
					const renderer = new M2RendererGL(file, gl_context, false, false);
					await renderer.load();

					const is_collection_style = false;

					// apply textures
					if (display.textures && display.textures.length > i)
						await renderer.applyReplaceableTextures({ textures: [display.textures[i]] });

					renderers.push({ renderer, attachment_id, is_collection_style });
					log.write('Loaded attachment model %d for slot %d attachment %d (item %d)', file_data_id, slot_id, attachment_id, item_id);
				} catch (e) {
					log.write('Failed to load attachment model %d: %s', file_data_id, e.message);
				}
			}

			if (renderers.length > 0)
				equipment_model_renderers.set(slot_id, { renderers, item_id });
		}

		// load collection models (models beyond attachment count, or all models if no attachments)
		if (display.models.length > collection_start_index) {
			const renderers = [];
			for (let i = collection_start_index; i < display.models.length; i++) {
				const file_data_id = display.models[i];

				try {
					const file = await core.view.casc.getFile(file_data_id);
					// collection models use character skeleton, reactive=false
					const renderer = new M2RendererGL(file, gl_context, false, false);
					await renderer.load();

					// build bone remap table from character bones
					if (active_renderer?.bones)
						renderer.buildBoneRemapTable(active_renderer.bones);

					// apply geoset visibility using attachmentGeosetGroup
					const slot_geosets = get_slot_geoset_mapping(slot_id);

					if (slot_geosets && display.attachmentGeosetGroup) {
						renderer.hideAllGeosets();
						for (const mapping of slot_geosets) {
							const value = display.attachmentGeosetGroup[mapping.group_index];
							if (value !== undefined)
								renderer.setGeosetGroupDisplay(mapping.char_geoset, 1 + value);
						}
					}

					// use matching texture for this model index
					const texture_idx = i < display.textures?.length ? i : 0;
					const texture_fdid = display.textures?.[texture_idx];

					if (texture_fdid)
						await renderer.applyReplaceableTextures({ textures: [texture_fdid] });

					renderers.push(renderer);
					log.write('Loaded collection model %d for slot %d (item %d)', file_data_id, slot_id, item_id);
				} catch (e) {
					log.write('Failed to load collection model %d: %s', file_data_id, e.message);
				}
			}

			if (renderers.length > 0)
				collection_model_renderers.set(slot_id, { renderers, item_id });
		}
	}
}

//endregion

//region models
async function load_character_model(core, file_data_id) {
	if (!file_data_id || active_model === file_data_id)
		return;

	core.view.chrModelLoading = true;
	log.write('Loading character model %s', file_data_id);

	core.view.modelViewerSkins.splice(0, core.view.modelViewerSkins.length);
	core.view.modelViewerSkinsSelection.splice(0, core.view.modelViewerSkinsSelection.length);

	core.view.chrModelViewerAnims = [];
	core.view.chrModelViewerAnimSelection = null;

	try {
		if (active_renderer) {
			active_renderer.dispose();
			active_renderer = undefined;
			active_model = undefined;
		}

		active_skins.clear();
		dispose_skinned_models();
		dispose_equipment_models();
		dispose_collection_models();

		const file = await core.view.casc.getFile(file_data_id);

		active_renderer = new M2RendererGL(file, gl_context, true, false);
		active_renderer.geosetKey = 'chrCustGeosets';

		await active_renderer.load();
		fit_camera(core);

		const controls = core.view.chrModelViewerContext.controls;
		if (controls?.on_model_rotate)
			controls.on_model_rotate(controls.model_rotation_y);

		active_model = file_data_id;

		// populate animation list
		const anim_list = [];
		const anim_source = active_renderer.skelLoader || active_renderer.m2;

		for (let i = 0; i < anim_source.animations.length; i++) {
			const animation = anim_source.animations[i];
			anim_list.push({
				id: `${Math.floor(animation.id)}.${animation.variationIndex}`,
				animationId: animation.id,
				m2Index: i,
				label: AnimMapper.get_anim_name(animation.id) + ' (' + Math.floor(animation.id) + '.' + animation.variationIndex + ')'
			});
		}

		core.view.chrModelViewerAnims = [
			{ id: 'none', label: 'No Animation', m2Index: -1 },
			...anim_list
		];

		const stand_anim = anim_list.find(anim => anim.id === '0.0');
		core.view.chrModelViewerAnimSelection = stand_anim ? '0.0' : 'none';

		const has_content = active_renderer.draw_calls?.length > 0;
		if (!has_content)
			core.setToast('info', `The model ${file_data_id} doesn't have any 3D data associated with it.`, null, 4000);

		// refresh appearance after model is fully loaded
		await refresh_character_appearance(core);

	} catch (e) {
		core.setToast('error', 'Unable to load model ' + file_data_id, { 'View log': () => log.openRuntimeLog() }, -1);
		log.write('Failed to load character model: %s', e.message);
	}

	core.view.chrModelLoading = false;
}

function dispose_skinned_models() {
	for (const [file_data_id, skinned_model_renderer] of skinned_model_renderers)
		skinned_model_renderer.dispose();

	skinned_model_renderers.clear();
	skinned_model_meshes.clear();
}

function dispose_equipment_models() {
	for (const entry of equipment_model_renderers.values()) {
		for (const { renderer } of entry.renderers)
			renderer.dispose();
	}

	equipment_model_renderers.clear();
}

function dispose_collection_models() {
	for (const entry of collection_model_renderers.values()) {
		for (const renderer of entry.renderers)
			renderer.dispose();
	}

	collection_model_renderers.clear();
}

function clear_materials() {
	character_appearance.dispose_materials(chr_materials);
}

function fit_camera(core) {
	if (core.view.chrModelViewerContext?.fitCamera)
		core.view.chrModelViewerContext.fitCamera();
}

//endregion

//region character state
async function update_chr_model_list(core) {
	const race_selection = core.view.chrCustRaceSelection[0];
	if (!race_selection)
		return;

	const models_for_race = await DBCharacterCustomization.get_race_models(race_selection.id);
	if (!models_for_race)
		return;

	let selection_index = 0;

	if (core.view.chrCustModelSelection.length > 0) {
		const model_id_map = core.view.chrCustModels.map((model) => model.id);
		selection_index = model_id_map.indexOf(core.view.chrCustModelSelection[0].id);
	}

	core.view.chrCustModels = [];

	const listed_model_ids = [];

	for (const [chr_sex, chr_model_id] of models_for_race) {
		const new_model = { id: chr_model_id, label: 'Type ' + (chr_sex + 1) };
		core.view.chrCustModels.push(new_model);
		listed_model_ids.push(chr_model_id);
	}

	if (core.view.chrImportChrModelID != 0) {
		selection_index = listed_model_ids.indexOf(core.view.chrImportChrModelID);
		core.view.chrImportChrModelID = 0;
	} else {
		if (core.view.chrCustModels.length < selection_index || selection_index < 0)
			selection_index = 0;
	}

	core.view.chrCustModelSelection = [core.view.chrCustModels[selection_index]];
}

/**
 * Handles body type selection change - loads new model and sets up customization options.
 */
async function update_model_selection(core) {
	const state = core.view;
	const selected = state.chrCustModelSelection[0];
	if (selected === undefined)
		return;

	log.write('Model selection changed to ID %d', selected.id);

	const available_options = await DBCharacterCustomization.get_options_for_model(selected.id);
	if (available_options === undefined)
		return;

	// update texture layout for the new model
	current_char_component_texture_layout_id = await DBCharacterCustomization.get_texture_layout_id(selected.id);

	// clear materials for new model
	clear_materials();

	// update customization options list
	state.chrCustOptions.splice(0, state.chrCustOptions.length);
	state.chrCustOptionSelection.splice(0, state.chrCustOptionSelection.length);
	state.chrCustActiveChoices.splice(0, state.chrCustActiveChoices.length);

	const option_to_choices = await DBCharacterCustomization.get_option_to_choices_map();
	const default_option_ids = await DBCharacterCustomization.get_default_options();

	// use imported choices if available and we're loading the target model, otherwise use defaults
	if (state.chrImportChoices.length > 0 && state.chrImportTargetModelID === selected.id) {
		state.chrCustActiveChoices.push(...state.chrImportChoices);
		state.chrImportChoices.splice(0, state.chrImportChoices.length);
		state.chrImportTargetModelID = 0;
	} else {
		for (const option of available_options) {
			const choices = option_to_choices.get(option.id);
			if (default_option_ids.includes(option.id) && choices && choices.length > 0)
				state.chrCustActiveChoices.push({ optionID: option.id, choiceID: choices[0].id });
		}
	}

	state.chrCustOptions.push(...available_options);
	state.chrCustOptionSelection.push(...available_options.slice(0, 1));
	state.optionToChoices = option_to_choices;

	// load the model (this will call refresh_character_appearance when done)
	const file_data_id = await DBCharacterCustomization.get_model_file_data_id(selected.id);
	await load_character_model(core, file_data_id);
}

async function update_customization_type(core) {
	const state = core.view;
	const selection = state.chrCustOptionSelection;

	if (selection.length === 0)
		return;

	const selected = selection[0];

	const available_choices = await DBCharacterCustomization.get_choices_for_option(selected.id);
	if (available_choices === undefined)
		return;

	state.chrCustChoices.splice(0, state.chrCustChoices.length);
	state.chrCustChoiceSelection.splice(0, state.chrCustChoiceSelection.length);

	state.chrCustChoices.push(...available_choices);
}

function update_customization_choice(core) {
	const state = core.view;
	const selection = state.chrCustChoiceSelection;
	if (selection.length === 0)
		return;

	const selected = selection[0];
	if (state.chrCustActiveChoices.find((choice) => choice.optionID === state.chrCustOptionSelection[0].id) === undefined) {
		state.chrCustActiveChoices.push({ optionID: state.chrCustOptionSelection[0].id, choiceID: selected.id });
	} else {
		const index = state.chrCustActiveChoices.findIndex((choice) => choice.optionID === state.chrCustOptionSelection[0].id);
		state.chrCustActiveChoices[index].choiceID = selected.id;
	}
}

function update_choice_for_option(core, option_id, choice_id) {
	const state = core.view;
	const existing_choice = state.chrCustActiveChoices.find((choice) => choice.optionID === option_id);

	if (existing_choice) {
		existing_choice.choiceID = choice_id;
	} else {
		state.chrCustActiveChoices.push({ optionID: option_id, choiceID: choice_id });
	}
}

async function randomize_customization(core) {
	const state = core.view;
	const options = state.chrCustOptions;

	for (const option of options) {
		const choices = await DBCharacterCustomization.get_choices_for_option(option.id);
		if (choices && choices.length > 0) {
			const random_choice = choices[Math.floor(Math.random() * choices.length)];
			update_choice_for_option(core, option.id, random_choice.id);
		}
	}
}

//endregion

//region import
async function import_character(core) {
	core.view.characterImportMode = 'none';
	core.view.chrModelLoading = true;

	const character_name = core.view.chrImportChrName;
	const selected_realm = core.view.chrImportSelectedRealm;
	const base_region = core.view.chrImportSelectedRegion;
	const effective_region = core.view.chrImportClassicRealms ? 'classic-' + base_region : base_region;

	if (selected_realm === null) {
		core.setToast('error', 'Please enter a valid realm.', null, 3000);
		core.view.chrModelLoading = false;
		return;
	}

	const character_label = `${character_name} (${effective_region}-${selected_realm.label})`;
	const armory_template = core.view.config.armoryURL;
	const url = armory_template.replace('%s', encodeURIComponent(effective_region)).replace('%s', encodeURIComponent(selected_realm.value)).replace('%s', encodeURIComponent(character_name.toLowerCase()));
	log.write('Retrieving character data for %s from %s', character_label, url);

	const res = await generics.get(url);
	if (res.ok) {
		try {
			await apply_import_data(core, await res.json(), 'bnet');
		} catch (e) {
			log.write('Failed to parse character data: %s', e.message);
			core.setToast('error', 'Failed to import character ' + character_label, null, -1);
		}
	} else {
		log.write('Failed to retrieve character data: %d %s', res.status, res.statusText);

		if (res.status == 404)
			core.setToast('error', 'Could not find character ' + character_label, null, -1);
		else
			core.setToast('error', 'Failed to import character ' + character_label, null, -1);
	}

	core.view.chrModelLoading = false;
}

async function import_wmv_character(core) {
	const file_input = document.createElement('input');
	file_input.setAttribute('type', 'file');
	file_input.setAttribute('accept', '.chr');
	file_input.setAttribute('nwworkingdir', core.view.config.lastWMVImportPath || '');

	file_input.addEventListener('change', async () => {
		if (file_input.files.length === 0)
			return;

		const file = file_input.files[0];
		const file_path = file.path;

		if (file_path) {
			const slash_index = Math.max(file_path.lastIndexOf('/'), file_path.lastIndexOf('\\'));
			core.view.config.lastWMVImportPath = slash_index > 0 ? file_path.substring(0, slash_index) : file_path;
		}

		core.view.chrModelLoading = true;

		try {
			const file_content = await file.text();
			const wmv_data = wmv_parse(file_content);
			await apply_import_data(core, wmv_data, 'wmv');
		} catch (e) {
			log.write('failed to load .chr file: %s', e.message);
			core.setToast('error', `failed to load .chr file: ${e.message}`, null, -1);
		}

		core.view.chrModelLoading = false;
	});

	file_input.click();
}

async function import_wowhead_character(core) {
	core.view.characterImportMode = 'none';
	core.view.chrModelLoading = true;

	const wowhead_url = core.view.chrImportWowheadURL;

	if (!wowhead_url || !wowhead_url.includes('dressing-room')) {
		core.setToast('error', 'please enter a valid wowhead dressing room url', null, 3000);
		core.view.chrModelLoading = false;
		return;
	}

	try {
		const wowhead_data = wowhead_parse(wowhead_url);
		await apply_import_data(core, wowhead_data, 'wowhead');
	} catch (e) {
		log.write('failed to parse wowhead url: %s', e.message);
		core.setToast('error', `failed to import wowhead character: ${e.message}`, null, -1);
	}

	core.view.chrModelLoading = false;
}

/**
 * Unified import handler - parses import data and applies it.
 * Sets all state first, then triggers model selection which loads the model.
 */
async function apply_import_data(core, data, source) {
	let race_id, gender_index, customizations, equipment;

	if (source === 'bnet') {
		race_id = data.playable_race.id;

		// pandaren with faction -> use neutral
		if (race_id == 25 || race_id == 26)
			race_id = 24;

		// dracthyr horde -> use alliance
		if (race_id == 70)
			race_id = 52;

		// worgen/dracthyr visage
		if (race_id == 22 && core.view.chrImportLoadVisage)
			race_id = 23;

		if (race_id == 52 && core.view.chrImportLoadVisage)
			race_id = 75;

		gender_index = data.gender.type === 'MALE' ? 0 : 1;

		const chr_model_id = await DBCharacterCustomization.get_chr_model_id(race_id, gender_index);
		const available_options = await DBCharacterCustomization.get_options_for_model(chr_model_id);
		const available_options_ids = available_options.map(opt => opt.id);

		customizations = [];
		for (const customization_entry of Object.values(data.customizations)) {
			if (available_options_ids.includes(customization_entry.option.id))
				customizations.push({ optionID: customization_entry.option.id, choiceID: customization_entry.choice.id });
		}

		equipment = {};
		if (data.items && Array.isArray(data.items)) {
			for (const item of data.items) {
				const slot_id = item.internal_slot_id + 1;
				equipment[slot_id] = item.id;
			}
		}

	} else if (source === 'wmv') {
		race_id = data.race;
		gender_index = data.gender;

		const chr_model_id = await DBCharacterCustomization.get_chr_model_id(race_id, gender_index);
		const available_options = await DBCharacterCustomization.get_options_for_model(chr_model_id);
		const available_options_ids = available_options.map(opt => opt.id);

		if (data.legacy_values) {
			// legacy WMV format
			const legacy = data.legacy_values;
			const option_map = {
				'skin': legacy.skin_color,
				'face': legacy.face_type,
				'hair color': legacy.hair_color,
				'hair style': legacy.hair_style,
				'facial': legacy.facial_hair
			};

			customizations = [];
			for (const option of available_options) {
				const label_lower = option.label.toLowerCase();

				for (const [key, value] of Object.entries(option_map)) {
					if (label_lower.includes(key)) {
						const choices = await DBCharacterCustomization.get_choices_for_option(option.id);
						if (choices && choices[value]) {
							customizations.push({ optionID: option.id, choiceID: choices[value].id });
							break;
						}
					}
				}
			}
		} else {
			// modern WMV format
			customizations = [];
			for (const customization of data.customizations) {
				if (available_options_ids.includes(customization.option_id))
					customizations.push({ optionID: customization.option_id, choiceID: customization.choice_id });
			}
		}

		equipment = data.equipment || {};

	} else if (source === 'wowhead') {
		race_id = data.race;
		gender_index = data.gender;

		const chr_model_id = await DBCharacterCustomization.get_chr_model_id(race_id, gender_index);
		const available_options = await DBCharacterCustomization.get_options_for_model(chr_model_id);

		customizations = [];
		for (const choice_id of data.customizations) {
			const choice_row = db2.ChrCustomizationChoice.getRow(choice_id);
			if (!choice_row)
				continue;

			const option_id = choice_row.ChrCustomizationOptionID;
			if (available_options.find(opt => opt.id === option_id))
				customizations.push({ optionID: option_id, choiceID: choice_id });
		}

		equipment = data.equipment || {};
	}

	is_importing = true;

	try {
		core.view.chrEquippedItems = { ...equipment };

		core.view.chrImportChoices.splice(0, core.view.chrImportChoices.length);
		core.view.chrImportChoices.push(...customizations);

		const chr_model_id = await DBCharacterCustomization.get_chr_model_id(race_id, gender_index);
		core.view.chrImportChrModelID = chr_model_id;
		core.view.chrImportTargetModelID = chr_model_id;

		core.view.chrCustRaceSelection = [core.view.chrCustRaces.find(e => e.id === race_id)];

		await update_model_selection(core);
	} finally {
		is_importing = false;
	}
}

//endregion

//region saved characters
function get_default_characters_dir() {
	return platform.get_home_dir() + '/wow.export/My Characters';
}

function get_saved_characters_dir(core) {
	const custom_path = core.view.config.characterExportPath;
	if (custom_path && custom_path.trim().length > 0)
		return custom_path.trim();

	return get_default_characters_dir();
}

function generate_character_id() {
	return Math.floor(10000 + Math.random() * 90000).toString();
}

async function load_saved_characters(core) {
	const dir = get_saved_characters_dir(core);
	core.view.chrSavedCharacters = [];

	try {
		await platform.access(dir);
	} catch {
		return;
	}

	const files = await platform.readdir(dir);
	const characters = [];

	for (const file of files) {
		if (!file.endsWith('.json'))
			continue;

		const match = file.match(/^(.+)-(\d{5})\.json$/);
		if (!match)
			continue;

		const name = match[1];
		const id = match[2];
		const thumb_path = dir + '/' + `${name}-${id}.png`;

		let thumb_data = null;
		try {
			await platform.access(thumb_path);
			const thumb_buffer = await platform.read_file_bytes(thumb_path);
			thumb_data = 'data:image/png;base64,' + thumb_buffer.toString('base64');
		} catch {
			// no thumbnail
		}

		characters.push({ name, id, thumb: thumb_data, file_name: file });
	}

	core.view.chrSavedCharacters = characters;
}

async function save_character(core, name, thumb_data) {
	const dir = get_saved_characters_dir(core);
	await generics.createDirectory(dir);

	// generate unique id
	let id = generate_character_id();
	const existing_ids = core.view.chrSavedCharacters.map(c => c.id);
	while (existing_ids.includes(id))
		id = generate_character_id();

	// gather character data
	const data = {
		race_id: core.view.chrCustRaceSelection[0]?.id,
		model_id: core.view.chrCustModelSelection[0]?.id,
		choices: [...core.view.chrCustActiveChoices],
		equipment: { ...core.view.chrEquippedItems },
		guild_tabard: { ...core.view.chrGuildTabardConfig }
	};

	const json_path = dir + '/' + `${name}-${id}.json`;
	await platform.write_file(json_path, JSON.stringify(data, null, '\t'));

	// save thumbnail if provided
	if (thumb_data) {
		const thumb_path = dir + '/' + `${name}-${id}.png`;
		const base64 = thumb_data.split(',')[1];
		await platform.write_file(thumb_path, BufferWrapper.fromBase64(base64)._buf);
	}

	await load_saved_characters(core);
	core.setToast('success', `Character "${name}" saved.`, null, 3000);
}

async function delete_character(core, character) {
	const dir = get_saved_characters_dir(core);
	const json_path = dir + '/' + character.file_name;
	const thumb_path = dir + '/' + `${character.name}-${character.id}.png`;

	try {
		await platform.unlink(json_path);
	} catch (e) {
		log.write('failed to delete character json: %s', e.message);
	}

	try {
		await platform.unlink(thumb_path);
	} catch {
		// thumbnail may not exist
	}

	const index = core.view.chrSavedCharacters.findIndex(c => c.id === character.id);
	if (index !== -1)
		core.view.chrSavedCharacters.splice(index, 1);

	core.setToast('success', `Character "${character.name}" deleted.`, null, 3000);
}

async function load_character(core, character) {
	const dir = get_saved_characters_dir(core);
	const json_path = dir + '/' + character.file_name;

	try {
		const content = await platform.read_file(json_path, 'utf8');
		const data = JSON.parse(content);

		core.view.chrModelLoading = true;
		core.view.chrSavedCharactersScreen = false;

		// apply equipment
		core.view.chrEquippedItems = data.equipment || {};

		// apply guild tabard config
		if (data.guild_tabard)
			core.view.chrGuildTabardConfig = { background: 0, border_style: 0, border_color: 0, emblem_design: 0, emblem_color: 0, ...data.guild_tabard };

		// apply customization
		core.view.chrImportChoices.splice(0, core.view.chrImportChoices.length);
		core.view.chrImportChoices.push(...(data.choices || []));
		core.view.chrImportChrModelID = data.model_id;
		core.view.chrImportTargetModelID = data.model_id;

		// apply race selection
		const race = core.view.chrCustRaces.find(r => r.id === data.race_id);
		if (race)
			core.view.chrCustRaceSelection = [race];

		core.view.chrModelLoading = false;
	} catch (e) {
		log.write('failed to load character: %s', e.message);
		core.setToast('error', `Failed to load character: ${e.message}`, null, -1);
	}
}

async function capture_character_thumbnail(core) {
	const context = core.view.chrModelViewerContext;
	if (!context || !context.controls || !active_renderer)
		return null;

	const controls = context.controls;
	const camera = controls.camera;

	// store current state
	const saved_cam_pos = [...camera.position];
	const saved_target = [...controls.target];
	const saved_rotation = controls.model_rotation_y;
	const saved_anim = active_renderer.current_animation_index;
	const saved_frame = active_renderer.animation_time;

	// get race/gender preset
	const race_gender = await get_current_race_gender(core);
	let preset = null;

	if (race_gender) {
		const race_presets = THUMBNAIL_PRESETS[race_gender.raceID];
		if (race_presets)
			preset = race_presets[race_gender.genderIndex];
	}

	// apply thumbnail camera settings
	if (preset) {
		camera.position[0] = preset[0];
		camera.position[1] = preset[1];
		camera.position[2] = preset[2];
		controls.target[0] = preset[3];
		controls.target[1] = preset[4];
		controls.target[2] = preset[5];
		controls.model_rotation_y = preset[6];

		camera.lookAt(controls.target[0], controls.target[1], controls.target[2]);
		if (controls.on_model_rotate)
			controls.on_model_rotate(controls.model_rotation_y);
	}

	// set to stand animation frame 0
	if (active_renderer.setAnimation)
		active_renderer.setAnimation(0);

	active_renderer.animation_time = 0;
	if (active_renderer.updateAnimation)
		active_renderer.updateAnimation(0);

	// wait for render
	await new Promise(r => requestAnimationFrame(r));
	await new Promise(r => requestAnimationFrame(r));

	// capture from canvas
	const canvas = context.gl_context?.canvas;
	if (!canvas)
		return null;

	// get canvas dimensions and calculate 1:1 crop
	const width = canvas.width;
	const height = canvas.height;
	const size = Math.min(width, height);
	const offset_x = Math.floor((width - size) / 2);
	const offset_y = Math.floor((height - size) / 2);

	// create offscreen canvas for cropping
	const crop_canvas = document.createElement('canvas');
	crop_canvas.width = size;
	crop_canvas.height = size;
	const crop_ctx = crop_canvas.getContext('2d');
	crop_ctx.drawImage(canvas, offset_x, offset_y, size, size, 0, 0, size, size);

	const data_url = crop_canvas.toDataURL('image/png');

	// restore previous state
	camera.position[0] = saved_cam_pos[0];
	camera.position[1] = saved_cam_pos[1];
	camera.position[2] = saved_cam_pos[2];
	controls.target[0] = saved_target[0];
	controls.target[1] = saved_target[1];
	controls.target[2] = saved_target[2];
	controls.model_rotation_y = saved_rotation;

	camera.lookAt(controls.target[0], controls.target[1], controls.target[2]);
	if (controls.on_model_rotate)
		controls.on_model_rotate(controls.model_rotation_y);

	if (active_renderer.setAnimation && saved_anim !== undefined)
		active_renderer.setAnimation(saved_anim);

	active_renderer.animation_time = saved_frame || 0;

	return data_url;
}

function get_current_character_data(core) {
	return {
		race_id: core.view.chrCustRaceSelection[0]?.id,
		model_id: core.view.chrCustModelSelection[0]?.id,
		choices: [...core.view.chrCustActiveChoices],
		equipment: { ...core.view.chrEquippedItems },
		guild_tabard: { ...core.view.chrGuildTabardConfig }
	};
}

async function export_json_character(core) {
	const data = get_current_character_data(core);

	if (!data.race_id || !data.model_id) {
		core.setToast('error', 'No character loaded to export.', null, 3000);
		return;
	}

	// capture thumbnail
	const thumb_data = await capture_character_thumbnail(core);
	if (thumb_data)
		data.thumb = thumb_data;

	const file_input = document.createElement('input');
	file_input.setAttribute('nwsaveas', 'character.json');
	file_input.setAttribute('accept', '.json');
	file_input.type = 'file';

	file_input.onchange = async () => {
		const file_path = file_input.value;
		if (!file_path)
			return;

		try {
			await platform.write_file(file_path, JSON.stringify(data, null, '\t'));
			core.setToast('success', 'Character exported successfully.', null, 3000);
		} catch (e) {
			log.write('failed to export character: %s', e.message);
			core.setToast('error', `Failed to export character: ${e.message}`, null, -1);
		}
	};

	file_input.click();
}

async function export_saved_character(core, character) {
	const dir = get_saved_characters_dir(core);
	const json_path = dir + '/' + character.file_name;

	let data;
	try {
		const content = await platform.read_file(json_path, 'utf8');
		data = JSON.parse(content);
		data.name = character.name;

		// include existing thumbnail if available
		if (character.thumb)
			data.thumb = character.thumb;
	} catch (e) {
		log.write('failed to read character for export: %s', e.message);
		core.setToast('error', `Failed to read character: ${e.message}`, null, -1);
		return;
	}

	const file_input = document.createElement('input');
	file_input.setAttribute('nwsaveas', character.name + '.json');
	file_input.setAttribute('accept', '.json');
	file_input.type = 'file';

	file_input.onchange = async () => {
		const file_path = file_input.value;
		if (!file_path)
			return;

		try {
			await platform.write_file(file_path, JSON.stringify(data, null, '\t'));
			core.setToast('success', `Character "${character.name}" exported successfully.`, null, 3000);
		} catch (e) {
			log.write('failed to export character: %s', e.message);
			core.setToast('error', `Failed to export character: ${e.message}`, null, -1);
		}
	};

	file_input.click();
}

async function import_json_character(core, save_to_my_characters) {
	const file_input = document.createElement('input');
	file_input.setAttribute('accept', '.json');
	file_input.type = 'file';

	file_input.onchange = async () => {
		const file_path = file_input.value;
		if (!file_path)
			return;

		try {
			const content = await platform.read_file(file_path, 'utf8');
			const data = JSON.parse(content);

			if (!data.race_id || !data.model_id) {
				core.setToast('error', 'Invalid character file: missing race_id or model_id.', null, -1);
				return;
			}

			if (save_to_my_characters) {
				// import into My Characters
				let name = data.name;
				if (!name) {
					// use filename without extension
					const fp_slash = Math.max(file_path.lastIndexOf('/'), file_path.lastIndexOf('\\'));
					name = file_path.substring(fp_slash + 1).replace(/\.json$/i, '');
				}

				const dir = get_saved_characters_dir(core);
				await generics.createDirectory(dir);

				let id = generate_character_id();
				const existing_ids = core.view.chrSavedCharacters.map(c => c.id);
				while (existing_ids.includes(id))
					id = generate_character_id();

				// remove name/thumb from data before saving (stored separately)
				const save_data = {
					race_id: data.race_id,
					model_id: data.model_id,
					choices: data.choices || [],
					equipment: data.equipment || {}
				};

				const save_path = dir + '/' + `${name}-${id}.json`;
				await platform.write_file(save_path, JSON.stringify(save_data, null, '\t'));

				// save thumbnail if provided
				if (data.thumb) {
					const thumb_path = dir + '/' + `${name}-${id}.png`;
					const base64 = data.thumb.split(',')[1];
					await platform.write_file(thumb_path, BufferWrapper.fromBase64(base64)._buf);
				}

				await load_saved_characters(core);
				core.setToast('success', `Character "${name}" imported.`, null, 3000);
			} else {
				// load directly into viewer
				core.view.chrModelLoading = true;
				core.view.chrSavedCharactersScreen = false;

				core.view.chrEquippedItems = data.equipment || {};

				core.view.chrImportChoices.splice(0, core.view.chrImportChoices.length);
				core.view.chrImportChoices.push(...(data.choices || []));
				core.view.chrImportChrModelID = data.model_id;
				core.view.chrImportTargetModelID = data.model_id;

				const race = core.view.chrCustRaces.find(r => r.id === data.race_id);
				if (race)
					core.view.chrCustRaceSelection = [race];

				core.view.chrModelLoading = false;
				core.setToast('success', 'Character loaded.', null, 3000);
			}
		} catch (e) {
			log.write('failed to import character: %s', e.message);
			core.setToast('error', `Failed to import character: ${e.message}`, null, -1);
		}
	};

	file_input.click();
}

//endregion

//region race
async function update_chr_race_list(core) {
	const listed_model_ids = [];
	const listed_race_ids = [];

	core.view.chrCustRacesPlayable = [];
	core.view.chrCustRacesNPC = [];

	const chr_race_map = await DBCharacterCustomization.get_chr_race_map();
	const chr_race_x_chr_model_map = await DBCharacterCustomization.get_chr_race_x_chr_model_map();

	for (const [chr_race_id, chr_race_info] of chr_race_map) {
		if (!chr_race_x_chr_model_map.has(chr_race_id))
			continue;

		const chr_models = chr_race_x_chr_model_map.get(chr_race_id);
		for (const chr_model_id of chr_models.values()) {
			if (listed_model_ids.includes(chr_model_id))
				continue;

			listed_model_ids.push(chr_model_id);

			if (listed_race_ids.includes(chr_race_id))
				continue;

			listed_race_ids.push(chr_race_id);

			const new_race = { id: chr_race_info.id, label: chr_race_info.name };

			if (chr_race_info.isNPCRace)
				core.view.chrCustRacesNPC.push(new_race);
			else
				core.view.chrCustRacesPlayable.push(new_race);

			if (core.view.chrCustRaceSelection.length > 0 && new_race.id == core.view.chrCustRaceSelection[0].id)
				core.view.chrCustRaceSelection = [new_race];
		}
	}

	core.view.chrCustRacesPlayable.sort((a, b) => a.label.localeCompare(b.label));
	core.view.chrCustRacesNPC.sort((a, b) => a.label.localeCompare(b.label));

	core.view.chrCustRaces = [...core.view.chrCustRacesPlayable, ...core.view.chrCustRacesNPC];

	if (core.view.chrCustRaceSelection.length == 0 || !listed_race_ids.includes(core.view.chrCustRaceSelection[0].id))
		core.view.chrCustRaceSelection = [core.view.chrCustRacesPlayable[0]];
}

//endregion

//region export
const export_char_model = async (core) => {
	const export_paths = core.openLastExportStream();
	const format = core.view.config.exportCharacterFormat;

	if (format === 'PNG' || format === 'CLIPBOARD') {
		if (active_model) {
			core.setToast('progress', 'saving preview, hold on...', null, -1, false);

			const canvas = document.querySelector('.char-preview canvas');
			const buf = await BufferWrapper.fromCanvas(canvas, 'image/png');

			if (format === 'PNG') {
				const file_name = await listfile.getByID(active_model);
				const export_path = ExportHelper.getExportPath(file_name);
				let out_file = ExportHelper.replaceExtension(export_path, '.png');

				if (core.view.config.modelsExportPngIncrements)
					out_file = await ExportHelper.getIncrementalFilename(out_file);

				const out_dir = out_file.substring(0, Math.max(out_file.lastIndexOf('/'), out_file.lastIndexOf('\\')));

				await buf.writeToFile(out_file);
				await export_paths?.writeLine('PNG:' + out_file);

				log.write('saved 3d preview screenshot to %s', out_file);
				core.setToast('success', `successfully exported preview to ${out_file}`, { 'view in explorer': () => platform.open_path(out_dir) }, -1);
			} else if (format === 'CLIPBOARD') {
				platform.clipboard_write_image(buf.toBase64());

				log.write('copied 3d preview to clipboard (character %s)', active_model);
				core.setToast('success', '3D preview has been copied to the clipboard', null, -1, true);
			}
		} else {
			core.setToast('error', 'the selected export option only works for character previews. preview something first!', null, -1);
		}

		export_paths?.close();
		return;
	}

	const helper = new ExportHelper(1, 'model');
	helper.start();

	if (helper.isCancelled())
		return;

	const file_data_id = active_model;
	const file_name = await listfile.getByID(file_data_id);

	try {
		if (format === 'OBJ' || format === 'STL') {
			if (!active_renderer || !active_renderer.m2) {
				core.setToast('error', 'no character model loaded to export', null, -1);
				export_paths?.close();
				return;
			}

			const ext = format === 'STL' ? '.stl' : '.obj';
			const mark_file_name = ExportHelper.replaceExtension(file_name, ext);
			const export_path = ExportHelper.getExportPath(mark_file_name);

			const casc = core.view.casc;
			const data = await casc.getFile(file_data_id);
			const exporter = new M2Exporter(data, [], file_data_id);

			for (const [chr_model_texture_target, chr_material] of chr_materials)
				exporter.addURITexture(chr_model_texture_target, chr_material.getURI());

			exporter.setGeosetMask(core.view.chrCustGeosets);

			const apply_pose = core.view.config.chrExportApplyPose;
			if (apply_pose) {
				const baked = active_renderer.getBakedGeometry();
				if (baked)
					exporter.setPosedGeometry(baked.vertices, baked.normals);
			}

			// collect equipment models for export
			const char_exporter = new CharacterExporter(
				active_renderer,
				equipment_model_renderers,
				collection_model_renderers
			);

			if (char_exporter.has_equipment()) {
				const char_info = await get_current_race_gender(core);
				const equipment_data = [];

				for (const geom of char_exporter.get_equipment_geometry(apply_pose)) {
					// get textures from display info
					const display = await DBItemModels.getItemDisplay(geom.item_id, char_info?.raceID, char_info?.genderIndex);
					const textures = display?.textures || [];

					equipment_data.push({
						slot_id: geom.slot_id,
						item_id: geom.item_id,
						renderer: geom.renderer,
						vertices: geom.vertices,
						normals: geom.normals,
						uv: geom.uv,
						uv2: geom.uv2,
						textures
					});
				}

				exporter.setEquipmentModels(equipment_data);
				log.write('Exporting character with %d equipment models', equipment_data.length);
			}

			if (format === 'STL') {
				await exporter.exportAsSTL(export_path, false, helper, []);
				await export_paths?.writeLine('M2_STL:' + export_path);
			} else {
				await exporter.exportAsOBJ(export_path, false, helper, []);
				await export_paths?.writeLine('M2_OBJ:' + export_path);
			}

			if (helper.isCancelled())
				return;

			helper.mark(mark_file_name, true);
		} else {
			const casc = core.view.casc;
			const data = await casc.getFile(file_data_id);
			const mark_file_name = ExportHelper.replaceExtension(file_name, '.gltf');
			const export_path = ExportHelper.getExportPath(mark_file_name);
			const exporter = new M2Exporter(data, [], file_data_id);

			for (const [chr_model_texture_target, chr_material] of chr_materials)
				exporter.addURITexture(chr_model_texture_target, chr_material.getURI());

			exporter.setGeosetMask(core.view.chrCustGeosets);

			// collect equipment models for GLTF export (with bone data for rigging)
			const char_exporter = new CharacterExporter(
				active_renderer,
				equipment_model_renderers,
				collection_model_renderers
			);

			if (char_exporter.has_equipment()) {
				const char_info = await get_current_race_gender(core);
				const equipment_data = [];

				// for GLTF, don't apply pose - let the armature handle it
				for (const geom of char_exporter.get_equipment_geometry(false)) {
					const display = await DBItemModels.getItemDisplay(geom.item_id, char_info?.raceID, char_info?.genderIndex);
					const textures = display?.textures || [];

					equipment_data.push({
						slot_id: geom.slot_id,
						item_id: geom.item_id,
						renderer: geom.renderer,
						vertices: geom.vertices,
						normals: geom.normals,
						uv: geom.uv,
						uv2: geom.uv2,
						boneIndices: geom.boneIndices,
						boneWeights: geom.boneWeights,
						textures,
						is_collection_style: geom.is_collection_style
					});
				}

				exporter.setEquipmentModelsGLTF(equipment_data);
				log.write('Exporting GLTF character with %d equipment models', equipment_data.length);
			}

			const format_lower = format.toLowerCase();
			await exporter.exportAsGLTF(export_path, helper, format_lower);
			await export_paths?.writeLine('M2_' + format + ':' + export_path);

			if (helper.isCancelled())
				return;

			helper.mark(mark_file_name, true);
		}
	} catch (e) {
		helper.mark(file_name, false, e.message, e.stack);
	}

	helper.finish();
	export_paths?.close();
};

const export_chr_texture = async (core) => {
	const active_canvas = charTextureOverlay.getActiveLayer();
	if (!active_canvas) {
		core.setToast('error', 'no texture is currently being previewed', null, -1);
		return;
	}

	const export_paths = core.openLastExportStream();

	core.setToast('progress', 'exporting texture, hold on...', null, -1, false);

	let texture_type = null;
	let chr_material = null;
	for (const [type, material] of chr_materials) {
		if (material.getCanvas() === active_canvas) {
			texture_type = type;
			chr_material = material;
			break;
		}
	}

	if (!chr_material) {
		core.setToast('error', 'unable to find material for active texture', null, -1);
		export_paths?.close();
		return;
	}

	const file_name = await listfile.getByID(active_model);
	const fn_slash = Math.max(file_name.lastIndexOf('/'), file_name.lastIndexOf('\\'));
	const fn_dot = file_name.lastIndexOf('.');
	const base_name = fn_dot > fn_slash ? file_name.substring(fn_slash + 1, fn_dot) : file_name.substring(fn_slash + 1);
	const dir_name = fn_slash >= 0 ? file_name.substring(0, fn_slash) : '';
	const texture_file_name = (dir_name ? dir_name + '/' : '') + base_name + '_texture_' + texture_type + '.png';
	const export_path = ExportHelper.getExportPath(texture_file_name);
	const ep_slash = Math.max(export_path.lastIndexOf('/'), export_path.lastIndexOf('\\'));
	const out_dir = ep_slash >= 0 ? export_path.substring(0, ep_slash) : '';

	const pixels = chr_material.getRawPixels();
	const width = active_canvas.width;
	const height = active_canvas.height;

	const png = new PNGWriter(width, height);
	const pixel_data = png.getPixelData();
	pixel_data.set(pixels);

	const buffer = png.getBuffer();
	await buffer.writeToFile(export_path);
	await export_paths?.writeLine('PNG:' + export_path);

	log.write('exported character texture to %s', export_path);
	core.setToast('success', `exported texture to ${export_path}`, { 'view in explorer': () => platform.open_path(out_dir) }, -1);

	export_paths?.close();
};

//endregion

//region utils
function int_to_css_color(value) {
	if (value === 0)
		return 'transparent';

	const unsigned = value >>> 0;
	const hex = unsigned.toString(16).padStart(8, '0').toUpperCase();

	const r = parseInt(hex.substring(2, 4), 16);
	const g = parseInt(hex.substring(4, 6), 16);
	const b = parseInt(hex.substring(6, 8), 16);

	return `rgb(${r}, ${g}, ${b})`;
}

async function get_selected_choice(core, option_id) {
	const active_choice = core.view.chrCustActiveChoices.find(c => c.optionID === option_id);
	if (!active_choice)
		return null;

	const choices = await DBCharacterCustomization.get_choices_for_option(option_id);
	if (!choices)
		return null;

	return choices.find(c => c.id === active_choice.choiceID);
}

//endregion

//region template
export default {
	get_default_characters_dir,

	register() {
		this.registerNavButton('Characters', 'person-solid.svg', InstallType.CASC);
	},

	template: `
		<div class="tab" id="tab-characters">
			<div v-show="$core.view.chrSavedCharactersScreen" class="saved-characters-screen">
				<div class="saved-characters-header">My Characters</div>
				<div class="saved-characters-grid">
					<div v-for="character in $core.view.chrSavedCharacters" :key="character.id" class="saved-character-card" @click="on_load_character(character)">
						<div class="saved-character-thumb" :style="{ backgroundImage: character.thumb ? 'url(' + character.thumb + ')' : 'none' }">
							<div class="saved-character-actions">
								<input type="button" value="" title="Export Character" class="ui-image-button saved-char-export-btn" @click.stop="on_export_character(character)"/>
								<input type="button" value="" title="Delete Character" class="ui-image-button saved-char-delete-btn" @click.stop="on_delete_character(character)"/>
							</div>
						</div>
						<div class="saved-character-name">{{ character.name }}</div>
					</div>
				</div>
				<div class="saved-characters-gutter">
					<div class="saved-characters-gutter-left">
						<input type="button" value="Save Character" class="ui-button" @click="open_save_prompt"/>
						<input type="button" value="Import Character" class="ui-button" @click="import_json_to_saved"/>
					</div>
					<input type="button" value="Back" class="ui-button" @click="$core.view.chrSavedCharactersScreen = false"/>
				</div>
			</div>
			<div v-if="$core.view.chrSaveCharacterPrompt" class="chr-save-prompt-overlay" @click.self="$core.view.chrSaveCharacterPrompt = false">
				<div class="chr-save-prompt">
					<div class="header"><b>Save Character</b></div>
					<input type="text" v-model="$core.view.chrSaveCharacterName" placeholder="Character Name" @keyup.enter="confirm_save_character"/>
					<input type="button" value="Save" @click="confirm_save_character"/>
				</div>
			</div>
			<div v-show="!$core.view.chrSavedCharactersScreen" class="character-viewer-content">
			<div v-if="$core.view.chrModelViewerAnims && $core.view.chrModelViewerAnims.length > 0" class="preview-dropdown-overlay">
				<select v-model="$core.view.chrModelViewerAnimSelection">
					<option v-for="animation in $core.view.chrModelViewerAnims" :key="animation.id" :value="animation.id">
						{{ animation.label }}
					</option>
				</select>
				<div v-if="$core.view.chrModelViewerAnimSelection !== 'none'" class="anim-controls">
					<button class="anim-btn anim-step-left" :class="{ disabled: !$core.view.chrModelViewerAnimPaused }" @click="step_animation(-1)" title="Previous frame"></button>
					<button class="anim-btn" :class="$core.view.chrModelViewerAnimPaused ? 'anim-play' : 'anim-pause'" @click="toggle_animation_pause()" :title="$core.view.chrModelViewerAnimPaused ? 'Play' : 'Pause'"></button>
					<button class="anim-btn anim-step-right" :class="{ disabled: !$core.view.chrModelViewerAnimPaused }" @click="step_animation(1)" title="Next frame"></button>
					<div class="anim-scrubber" @mousedown="start_scrub" @mouseup="end_scrub">
						<input type="range" min="0" :max="$core.view.chrModelViewerAnimFrameCount - 1" :value="$core.view.chrModelViewerAnimFrame" @input="seek_animation($event.target.value)" />
						<div class="anim-frame-display">{{ $core.view.chrModelViewerAnimFrame }}</div>
					</div>
				</div>
			</div>
			<div class="character-import-buttons">
				<div class="character-button-group">
					<input type="button" value="My Characters" title="My Characters" class="ui-image-button character-save-button" @click="open_saved_characters"/>
					<input type="button" value="" title="Save Character" class="ui-image-button character-quick-save-button" @click="open_save_prompt"/>
				</div>
				<div class="character-button-group">
					<input type="button" value="" title="Import JSON" class="ui-image-button character-import-json-button" @click="import_json"/>
					<input type="button" value="" title="Export JSON" class="ui-image-button character-export-json-button" @click="export_json"/>
				</div>
				<div class="character-button-group">
					<input type="button" value="" title="Import from Battle.net" class="ui-image-button character-bnet-button" @click="$core.view.characterImportMode = $core.view.characterImportMode === 'BNET' ? 'none' : 'BNET'" :class="{ active: $core.view.characterImportMode === 'BNET' }"/>
					<input type="button" value="" title="Import from Wowhead" class="ui-image-button character-wowhead-button" @click="$core.view.characterImportMode = $core.view.characterImportMode === 'WHEAD' ? 'none' : 'WHEAD'" :class="{ active: $core.view.characterImportMode === 'WHEAD' }"/>
					<input type="button" value="" title="Import from WoW Model Viewer" class="ui-image-button character-wmv-button" @click="import_wmv"/>
				</div>
			</div>
			<div v-if="$core.view.characterImportMode === 'BNET'" id="character-import-panel-floating" @click.stop>
				<div class="header"><b>Character Import</b></div>
				<ul class="ui-multi-button">
					<li v-for="region of base_regions" :class="{ selected: $core.view.chrImportSelectedRegion === region }" @click.stop="$core.view.chrImportSelectedRegion = region">{{ region.toUpperCase() }}</li>
				</ul>
				<label class="ui-checkbox" title="Use Classic realms">
					<input type="checkbox" v-model="$core.view.chrImportClassicRealms"/>
					<span>Classic Realms</span>
				</label>
				<input type="text" v-model="$core.view.chrImportChrName" placeholder="Character Name"/>
				<component :is="$components.ComboBox" v-model:value="$core.view.chrImportSelectedRealm" :source="$core.view.chrImportRealms" placeholder="Character Realm" maxheight="10"></component>
				<label class="ui-checkbox" title="Load visage model (Dracthyr/Worgen)">
					<input type="checkbox" v-model="$core.view.chrImportLoadVisage"/>
					<span>Load visage model (Dracthyr/Worgen)</span>
				</label>
				<input type="button" value="Import Character" @click="import_character" :class="{ disabled: $core.view.chrModelLoading }"/>
			</div>
			<div v-if="$core.view.characterImportMode === 'WHEAD'" id="character-import-panel-floating" @click.stop>
				<div class="header"><b>Wowhead Import</b></div>
				<input type="text" v-model="$core.view.chrImportWowheadURL" placeholder="Wowhead Dressing Room URL"/>
				<input type="button" value="Import Character" @click="import_wowhead" :class="{ disabled: $core.view.chrModelLoading }"/>
			</div>
			<div class="left-panel">
				<div class="left-panel-scroll">
					<template v-if="!$core.view.chrShowGeosetControl">
						<label class="ui-select-label">
						<span class="select-prefix"><span class="prefix-label">Race:</span> <span class="prefix-value">{{ $core.view.chrCustRaceSelection[0]?.label }}</span></span>
						<select class="ui-select" id="select-chr-race" :value="$core.view.chrCustRaceSelection[0]?.id" @change="$core.view.chrCustRaceSelection = [$event.target.value ? $core.view.chrCustRaces.find(r => r.id === parseInt($event.target.value)) : $core.view.chrCustRaces[0]]">
							<option value="" disabled selected style="display:none;"></option>
							<optgroup label="Playable Races">
								<option v-for="race in $core.view.chrCustRacesPlayable" :key="race.id" :value="race.id">{{ race.label }}</option>
							</optgroup>
							<optgroup label="NPC Races">
								<option v-for="race in $core.view.chrCustRacesNPC" :key="race.id" :value="race.id">{{ race.label }}</option>
							</optgroup>
						</select>
					</label>
					<label class="ui-select-label">
						<span class="select-prefix"><span class="prefix-label">Body:</span> <span class="prefix-value">{{ $core.view.chrCustModelSelection[0]?.label }}</span></span>
						<select class="ui-select" id="select-chr-body" :value="$core.view.chrCustModelSelection[0]?.id" @change="$core.view.chrCustModelSelection = [$event.target.value ? $core.view.chrCustModels.find(m => m.id === parseInt($event.target.value)) : $core.view.chrCustModels[0]]">
							<option value="" disabled selected style="display:none;"></option>
							<option v-for="model in $core.view.chrCustModels" :key="model.id" :value="model.id">{{ model.label }}</option>
						</select>
					</label>
					<template v-for="option in $core.view.chrCustOptions" :key="option.id">
						<label v-if="!option.is_color_swatch" class="ui-select-label">
							<span class="select-prefix"><span class="prefix-label">{{ option.label }}:</span> <span class="prefix-value">{{ $core.view.optionToChoices.get(option.id)?.find(c => c.id === $core.view.chrCustActiveChoices.find(ac => ac.optionID === option.id)?.choiceID)?.label }}</span></span>
							<select class="ui-select" :value="$core.view.chrCustActiveChoices.find(c => c.optionID === option.id)?.choiceID" @change="update_choice_for_option(option.id, parseInt($event.target.value))">
								<option value="" disabled selected style="display:none;"></option>
								<option v-for="choice in $core.view.optionToChoices.get(option.id)" :key="choice.id" :value="choice.id">{{ choice.label }}</option>
							</select>
						</label>
						<div v-else class="customization-color-container">
							<div class="customization-color-label" @click="toggle_color_picker(option.id, $event)">
								<span class="prefix-label">{{ option.label }}:</span>
								<div class="customization-color-selected">
									<div v-if="get_selected_choice(option.id)?.swatch_color_0 === 0 && get_selected_choice(option.id)?.swatch_color_1 === 0" class="swatch swatch-none">
										<div class="swatch-none-line"></div>
									</div>
									<div v-else-if="get_selected_choice(option.id)?.swatch_color_1 !== 0" class="swatch swatch-dual">
										<div class="swatch-color-half-1" :style="{backgroundColor: int_to_css_color(get_selected_choice(option.id)?.swatch_color_0)}"></div>
										<div class="swatch-color-half-2" :style="{backgroundColor: int_to_css_color(get_selected_choice(option.id)?.swatch_color_1)}"></div>
									</div>
									<div v-else class="swatch swatch-single" :style="{backgroundColor: int_to_css_color(get_selected_choice(option.id)?.swatch_color_0)}"></div>
								</div>
							</div>
							<div v-if="$core.view.colorPickerOpenFor === option.id" class="color-picker-popup" :style="{left: $core.view.colorPickerPosition.x + 'px', top: $core.view.colorPickerPosition.y + 'px'}" @click.self="$core.view.colorPickerOpenFor = null">
									<div class="color-picker-grid">
										<div
											v-for="choice in $core.view.optionToChoices.get(option.id)"
											:key="choice.id"
											:class="['swatch', 'swatch-clickable', {selected: $core.view.chrCustActiveChoices.find(c => c.optionID === option.id)?.choiceID === choice.id}]"
											@click="select_color_choice(option.id, choice.id)">
											<div v-if="choice.swatch_color_0 === 0 && choice.swatch_color_1 === 0" class="swatch-none">
												<div class="swatch-none-line"></div>
											</div>
											<div v-else-if="choice.swatch_color_1 !== 0" class="swatch-dual">
												<div class="swatch-color-half-1" :style="{backgroundColor: int_to_css_color(choice.swatch_color_0)}"></div>
												<div class="swatch-color-half-2" :style="{backgroundColor: int_to_css_color(choice.swatch_color_1)}"></div>
											</div>
											<div v-else class="swatch-single" :style="{backgroundColor: int_to_css_color(choice.swatch_color_0)}"></div>
										</div>
									</div>
							</div>
						</div>
					</template>
					<label class="ui-select-label">
						<span class="select-prefix"><span class="prefix-label">Underwear:</span> <span class="prefix-value">{{ $core.view.config.chrIncludeBaseClothing ? 'Visible' : 'Hidden' }}</span></span>
						<select class="ui-select" :value="$core.view.config.chrIncludeBaseClothing" @change="$core.view.config.chrIncludeBaseClothing = $event.target.value === 'true'">
							<option value="" disabled selected style="display:none;"></option>
							<option value="true">Visible</option>
							<option value="false">Hidden</option>
						</select>
					</label>
					</template>
					<template v-else>
						<div class="geoset-checkboxes">
							<label v-for="geoset in $core.view.chrCustGeosets" :key="geoset.id" class="geoset-checkbox-item" v-show="geoset.id !== 0">
								<span class="geoset-prefix">{{ geoset.label }}:</span>
								<input type="checkbox" v-model="geoset.checked"/>
							</label>
						</div>
						<div class="geoset-toggles">
							<a @click="set_all_geosets(true)">Enable All</a> / <a @click="set_all_geosets(false)">Disable All</a>
						</div>
					</template>
				</div>
				<div class="chr-cust-controls">
					<template v-if="!$core.view.chrShowGeosetControl">
						<span class="chr-randomize-toggle" @click="randomize_customization">Randomize Customization</span>
						<span @click="$core.view.chrShowGeosetControl = true">Custom Geoset Control</span>
					</template>
					<span v-else class="chr-geoset-return" @click="$core.view.chrShowGeosetControl = false">Return to Customization</span>
				</div>
			</div>
			<div class="char-preview preview-container">
				<div class="preview-background">
					<div v-if="$core.view.chrModelLoading" class="chr-model-loading-spinner"></div>
					<component :is="$components.ModelViewerGL" v-if="$core.view.chrModelViewerContext" :context="$core.view.chrModelViewerContext"></component>
					<div v-if="$core.view.chrCustBakedNPCTexture" style="position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); z-index: 100;">
						<input type="button" value="Remove Baked Texture" @click="remove_baked_npc_texture" style="background-color: #d9534f; color: white; border: none; padding: 8px 16px; cursor: pointer; font-weight: bold;"/>
					</div>
				</div>
				<div class="character-export-container">
					<div class="character-export-controls">
						<div class="character-export-menu" v-show="$core.view.chrExportMenu == 'export'">
							<label class="ui-checkbox" v-show="$core.view.config.exportCharacterFormat === 'GLTF' || $core.view.config.exportCharacterFormat === 'GLB'" title="Include Animations in Export">
								<input type="checkbox" v-model="$core.view.config.modelsExportAnimations"/>
								<span>Export animations</span>
							</label>
							<label class="ui-checkbox" v-show="$core.view.config.exportCharacterFormat === 'OBJ' || $core.view.config.exportCharacterFormat === 'STL'" title="Apply current animation pose to exported geometry">
								<input type="checkbox" v-model="$core.view.config.chrExportApplyPose"/>
								<span>Apply pose</span>
							</label>
							<component :is="$components.MenuButton" :options="$core.view.menuButtonCharacterExport" :default="$core.view.config.exportCharacterFormat" @change="$core.view.config.exportCharacterFormat = $event" :disabled="$core.view.chrModelLoading" @click="export_character"></component>
						</div>
						<div class="character-export-menu" v-show="$core.view.chrExportMenu == 'textures'">
							<div class="texture-preview-panel" id="chr-texture-preview">
							</div>
							<div class="texture-menu-controls">
								<input type="button" value="" class="ui-image-button texture-prev-button" @click="chr_prev_overlay"/>
								<input type="button" value="Export Texture" class="ui-button texture-export-button" @click="chr_export_overlay"/>
								<input type="button" value="" class="ui-image-button texture-next-button" @click="chr_next_overlay"/>
							</div>
						</div>
						<div class="character-export-menu" v-show="$core.view.chrExportMenu == 'settings'">
							<label class="ui-checkbox" title="Render Shadow">
								<input type="checkbox" v-model="$core.view.config.chrRenderShadow"/>
								<span>Render shadow</span>
							</label>
							<label class="ui-checkbox" title="Use 3D Camera">
								<input type="checkbox" v-model="$core.view.config.chrUse3DCamera"/>
								<span>Use 3D camera</span>
							</label>
							<label class="ui-checkbox" title="Show a background color in the 3D viewport">
								<input type="checkbox" v-model="$core.view.config.chrShowBackground"/>
								<span>Show background</span>
							</label>
							<label v-if="$core.view.config.chrShowBackground" class="ui-checkbox" title="Click to change background color">
								<input type="color" id="chr-background-color-input" v-model="$core.view.config.chrBackgroundColor"/>
								<span>Background color</span>
							</label>
						</div>
					</div>
					<ul class="ui-multi-button character-export-tabs">
						<li :class="{ selected: $core.view.chrExportMenu == 'export' }" @click.stop="$core.view.chrExportMenu = 'export'">Export</li>
						<li :class="{ selected: $core.view.chrExportMenu == 'textures' }" @click.stop="$core.view.chrExportMenu = 'textures'">Textures</li>
						<li :class="{ selected: $core.view.chrExportMenu == 'settings' }" @click.stop="$core.view.chrExportMenu = 'settings'">Settings</li>
					</ul>
				</div>
			</div>
			<div class="right-panel">
				<div v-if="is_guild_tabard_equipped()" class="guild-tabard-panel">
					<div class="guild-tabard-header">Guild Tabard</div>
					<template v-for="opt in tabard_options" :key="opt.key">
						<div v-if="opt.type === 'value'" class="equipment-slot tabard-control">
							<span class="slot-label">{{ opt.label }}:</span>
							<div class="tabard-option-control">
								<span class="tabard-arrow" @click="adjust_tabard_config(opt.key, -1)">&lt;</span>
								<input type="text" class="tabard-value" :value="$core.view.chrGuildTabardConfig[opt.key]" @change="set_tabard_config(opt.key, $event.target.value)">
								<span class="tabard-arrow" @click="adjust_tabard_config(opt.key, 1)">&gt;</span>
							</div>
						</div>
						<div v-else class="customization-color-container">
							<div class="customization-color-label" @click="toggle_tabard_color_picker(opt.key, $event)">
								<span class="prefix-label">{{ opt.label }}:</span>
								<div class="customization-color-selected">
									<div class="swatch swatch-single" :style="{backgroundColor: get_tabard_color_css(opt.key)}"></div>
								</div>
							</div>
							<div v-if="$core.view.colorPickerOpenFor === 'tabard_' + opt.key" class="color-picker-popup" :style="{left: $core.view.colorPickerPosition.x + 'px', top: $core.view.colorPickerPosition.y + 'px'}" @click.self="$core.view.colorPickerOpenFor = null">
								<div class="color-picker-grid">
									<div
										v-for="[color_id, color] in get_tabard_color_list(opt.colors)"
										:key="color_id"
										:class="['swatch', 'swatch-clickable', {selected: $core.view.chrGuildTabardConfig[opt.key] === color_id}]"
										@click="select_tabard_color(opt.key, color_id)">
										<div class="swatch-single" :style="{backgroundColor: 'rgb(' + color.r + ',' + color.g + ',' + color.b + ')'}"></div>
									</div>
								</div>
							</div>
						</div>
					</template>
				</div>
				<div class="equipment-list">
					<div v-for="slot in equipment_slots" :key="slot.id" class="equipment-slot" @click="open_slot_context($event, slot.id)" @contextmenu.prevent="open_slot_context($event, slot.id)">
						<span class="slot-label">{{ slot.name }}:</span>
						<span v-if="get_equipped_item(slot.id)" :class="'slot-item item-quality-' + get_equipped_item(slot.id).quality" :title="get_equipped_item(slot.id).name + ' (' + get_equipped_item(slot.id).id + ')'">{{ get_equipped_item(slot.id).name }}</span>
						<span v-else class="slot-empty">Empty</span>
					</div>
					<component :is="$components.ContextMenu" :node="$core.view.chrEquipmentSlotContext" v-slot:default="context" @close="$core.view.chrEquipmentSlotContext = null">
						<span @click.self="replace_slot_item(context.node)">Replace Item</span>
						<span @click.self="unequip_slot(context.node)">Remove Item</span>
						<span @click.self="copy_item_id(context.node)">Copy Item ID ({{ get_equipped_item(context.node)?.id }})</span>
						<span @click.self="copy_item_name(context.node)">Copy Item Name</span>
					</component>
					<div class="chr-cust-controls">
						<span @click="clear_all_equipment">Clear All Equipment</span>
					</div>
				</div>
			</div>
			</div>
		</div>
	`,

	data() {
		return {
			equipment_slots: EQUIPMENT_SLOTS,
			base_regions: ['us', 'eu', 'kr', 'tw'],
			tabard_options: [
				{ key: 'background', label: 'Background', type: 'color', colors: 'getBackgroundColors' },
				{ key: 'border_style', label: 'Border', type: 'value' },
				{ key: 'border_color', label: 'Border Color', type: 'color', colors: 'getBorderColors' },
				{ key: 'emblem_design', label: 'Emblem', type: 'value' },
				{ key: 'emblem_color', label: 'Emblem Color', type: 'color', colors: 'getEmblemColors' }
			]
		};
	},

	methods: {
		import_wmv() {
			import_wmv_character(this.$core);
		},

		import_character() {
			import_character(this.$core);
		},

		toggle_animation_pause() {
			if (!active_renderer)
				return;

			const paused = !this.$core.view.chrModelViewerAnimPaused;
			this.$core.view.chrModelViewerAnimPaused = paused;
			active_renderer.set_animation_paused(paused);
		},

		step_animation(delta) {
			if (!this.$core.view.chrModelViewerAnimPaused)
				return;

			if (!active_renderer)
				return;

			active_renderer.step_animation_frame(delta);
			this.$core.view.chrModelViewerAnimFrame = active_renderer.get_animation_frame();
		},

		seek_animation(frame) {
			if (!active_renderer)
				return;

			active_renderer.set_animation_frame(parseInt(frame));
			this.$core.view.chrModelViewerAnimFrame = parseInt(frame);
		},

		start_scrub() {
			this._was_paused_before_scrub = this.$core.view.chrModelViewerAnimPaused;
			if (!this._was_paused_before_scrub) {
				this.$core.view.chrModelViewerAnimPaused = true;
				active_renderer?.set_animation_paused?.(true);
			}
		},

		end_scrub() {
			if (!this._was_paused_before_scrub) {
				this.$core.view.chrModelViewerAnimPaused = false;
				active_renderer?.set_animation_paused?.(false);
			}
		},

		import_wowhead() {
			import_wowhead_character(this.$core);
		},

		update_choice_for_option(option_id, choice_id) {
			update_choice_for_option(this.$core, option_id, choice_id);
		},

		randomize_customization() {
			randomize_customization(this.$core);
		},

		set_all_geosets(state) {
			this.$core.view.setAllGeosets(state, this.$core.view.chrCustGeosets);
		},

		toggle_color_picker(option_id, event) {
			if (this.$core.view.colorPickerOpenFor === option_id) {
				this.$core.view.colorPickerOpenFor = null;
			} else {
				this.$core.view.colorPickerPosition = { x: event.clientX, y: event.clientY };
				this.$core.view.colorPickerOpenFor = option_id;
			}
		},

		select_color_choice(option_id, choice_id) {
			update_choice_for_option(this.$core, option_id, choice_id);
			this.$core.view.colorPickerOpenFor = null;
		},

		get_selected_choice(option_id) {
			return get_selected_choice(this.$core, option_id);
		},

		int_to_css_color(value) {
			return int_to_css_color(value);
		},

		export_character() {
			export_char_model(this.$core);
		},

		async remove_baked_npc_texture() {
			this.$core.view.chrCustBakedNPCTexture = null;
			await refresh_character_appearance(this.$core);
		},

		async open_saved_characters() {
			await load_saved_characters(this.$core);
			this.$core.view.chrSavedCharactersScreen = true;
		},

		async open_save_prompt() {
			// capture thumbnail while still viewing the character
			this.$core.view.chrPendingThumbnail = await capture_character_thumbnail(this.$core);
			this.$core.view.chrSaveCharacterName = '';
			this.$core.view.chrSaveCharacterPrompt = true;
		},

		async confirm_save_character() {
			const name = this.$core.view.chrSaveCharacterName.trim();
			if (!name) {
				this.$core.setToast('error', 'Please enter a character name.', null, 3000);
				return;
			}

			this.$core.view.chrSaveCharacterPrompt = false;
			await save_character(this.$core, name, this.$core.view.chrPendingThumbnail);
		},

		async on_load_character(character) {
			await load_character(this.$core, character);
		},

		async on_delete_character(character) {
			await delete_character(this.$core, character);
		},

		on_export_character(character) {
			export_saved_character(this.$core, character);
		},

		import_json() {
			import_json_character(this.$core, false);
		},

		import_json_to_saved() {
			import_json_character(this.$core, true);
		},

		export_json() {
			export_json_character(this.$core);
		},

		chr_prev_overlay() {
			this.$core.events.emit('click-chr-prev-overlay');
		},

		chr_next_overlay() {
			this.$core.events.emit('click-chr-next-overlay');
		},

		chr_export_overlay() {
			export_chr_texture(this.$core);
		},

		async get_equipped_item(slot_id) {
			const item_id = this.$core.view.chrEquippedItems[slot_id];
			if (!item_id)
				return null;

			return await DBItems.getItemById(item_id);
		},

		open_slot_context(event, slot_id) {
			const item_id = this.$core.view.chrEquippedItems[slot_id];
			if (!item_id) {
				this.navigate_to_items_for_slot(slot_id);
				return;
			}

			this.$core.view.chrEquipmentSlotContext = slot_id;
		},

		navigate_to_items_for_slot(slot_id) {
			const slot = EQUIPMENT_SLOTS.find(s => s.id === slot_id);
			if (!slot)
				return;

			const type_mask = this.$core.view.itemViewerTypeMask;
			if (type_mask && type_mask.length > 0) {
				for (const item of type_mask)
					item.checked = item.label === slot.name;
			} else {
				this.$core.view.pendingItemSlotFilter = slot.name;
			}

			this.$modules.tab_items.setActive();
		},

		unequip_slot(slot_id) {
			delete this.$core.view.chrEquippedItems[slot_id];
			this.$core.view.chrEquippedItems = { ...this.$core.view.chrEquippedItems };
		},

		replace_slot_item(slot_id) {
			this.$core.view.chrEquipmentSlotContext = null;
			this.navigate_to_items_for_slot(slot_id);
		},

		copy_item_id(slot_id) {
			const item = this.get_equipped_item(slot_id);
			if (item)
				navigator.clipboard.writeText(String(item.id));

			this.$core.view.chrEquipmentSlotContext = null;
		},

		copy_item_name(slot_id) {
			const item = this.get_equipped_item(slot_id);
			if (item)
				navigator.clipboard.writeText(item.name);

			this.$core.view.chrEquipmentSlotContext = null;
		},

		clear_all_equipment() {
			this.$core.view.chrEquippedItems = {};
		},

		async is_guild_tabard_equipped() {
			const item_id = this.$core.view.chrEquippedItems[19];
			return item_id && await DBGuildTabard.isGuildTabard(item_id);
		},

		async get_tabard_tier() {
			const item_id = this.$core.view.chrEquippedItems[19];
			if (!item_id)
				return -1;

			return await DBGuildTabard.getTabardTier(item_id);
		},

		async get_tabard_max(key) {
			switch (key) {
				case 'background': return await DBGuildTabard.getBackgroundColorCount();
				case 'border_style': return await DBGuildTabard.getBorderStyleCount(await this.get_tabard_tier());
				case 'border_color': return await DBGuildTabard.getBorderColorCount();
				case 'emblem_design': return await DBGuildTabard.getEmblemDesignCount();
				case 'emblem_color': return await DBGuildTabard.getEmblemColorCount();
				default: return 0;
			}
		},

		async set_tabard_config(key, value) {
			const max = await this.get_tabard_max(key);
			value = parseInt(value) || 0;

			if (max > 0)
				value = Math.max(0, Math.min(value, max - 1));

			this.$core.view.chrGuildTabardConfig = {
				...this.$core.view.chrGuildTabardConfig,
				[key]: value
			};
		},

		async adjust_tabard_config(key, delta) {
			const max = await this.get_tabard_max(key);
			if (max <= 0)
				return;

			let value = (this.$core.view.chrGuildTabardConfig[key] + delta) % max;
			if (value < 0)
				value += max;

			this.$core.view.chrGuildTabardConfig = {
				...this.$core.view.chrGuildTabardConfig,
				[key]: value
			};
		},

		toggle_tabard_color_picker(key, event) {
			const picker_key = 'tabard_' + key;
			if (this.$core.view.colorPickerOpenFor === picker_key) {
				this.$core.view.colorPickerOpenFor = null;
			} else {
				this.$core.view.colorPickerPosition = { x: event.clientX, y: event.clientY };
				this.$core.view.colorPickerOpenFor = picker_key;
			}
		},

		select_tabard_color(key, color_id) {
			this.$core.view.chrGuildTabardConfig = {
				...this.$core.view.chrGuildTabardConfig,
				[key]: color_id
			};
			this.$core.view.colorPickerOpenFor = null;
		},

		async get_tabard_color_css(key) {
			const color_id = this.$core.view.chrGuildTabardConfig[key];
			const color_map = await this.get_tabard_color_list_for_key(key);
			const color = color_map?.get(color_id);
			if (!color)
				return 'transparent';

			return 'rgb(' + color.r + ',' + color.g + ',' + color.b + ')';
		},

		async get_tabard_color_list(method_name) {
			return await DBGuildTabard[method_name]();
		},

		async get_tabard_color_list_for_key(key) {
			switch (key) {
				case 'background': return await DBGuildTabard.getBackgroundColors();
				case 'border_color': return await DBGuildTabard.getBorderColors();
				case 'emblem_color': return await DBGuildTabard.getEmblemColors();
				default: return null;
			}
		}
	},

	async mounted() {
		const state = this.$core.view;

		reset_module_state();

		this.$core.showLoadingScreen(7);

		const update_realm_list = () => {
			const base_region = state.chrImportSelectedRegion;
			const effective_region = state.chrImportClassicRealms ? 'classic-' + base_region : base_region;

			if (!state.realmList[effective_region])
				return;

			const realm_list = state.realmList[effective_region].map(realm => ({ label: realm.name, value: realm.slug }));
			state.chrImportRealms = realm_list;

			if (state.chrImportSelectedRealm !== null) {
				const matching_realm = realm_list.find(realm => realm.value === state.chrImportSelectedRealm.value);
				if (matching_realm)
					state.chrImportSelectedRealm = matching_realm;
				else
					state.chrImportSelectedRealm = null;
			}
		};

		watcher_cleanup_funcs.push(
			this.$core.view.$watch('chrImportSelectedRegion', update_realm_list),
			this.$core.view.$watch('chrImportClassicRealms', update_realm_list)
		);

		state.chrImportRegions = Object.keys(state.realmList);

		// preserve region/realm selection across module reloads
		if (!state.chrImportSelectedRegion)
			state.chrImportSelectedRegion = 'us';
		else
			update_realm_list();

		await this.$core.progressLoadingScreen('Loading character customization data...');
		await DBCharacterCustomization.ensureInitialized();

		await this.$core.progressLoadingScreen('Loading item data...');
		await DBItems.ensureInitialized();

		await this.$core.progressLoadingScreen('Loading item character textures...');
		await DBItemCharTextures.ensureInitialized();

		await this.$core.progressLoadingScreen('Loading item geosets...');
		await DBItemGeosets.ensureInitialized();

		await this.$core.progressLoadingScreen('Loading item models...');
		await DBItemModels.ensureInitialized();

		await this.$core.progressLoadingScreen('Loading guild tabard data...');
		await DBGuildTabard.ensureInitialized();

		await this.$core.progressLoadingScreen('Loading character shaders...');

		state.chrModelViewerContext = {
			gl_context: null,
			controls: null,
			useCharacterControls: true,
			fitCamera: null,
			getActiveRenderer: () => active_renderer,
			getEquipmentRenderers: () => equipment_model_renderers,
			getCollectionRenderers: () => collection_model_renderers
		};

		const ctx_watcher = state.$watch('chrModelViewerContext.gl_context', (new_ctx) => {
			if (new_ctx) {
				gl_context = new_ctx;
				ctx_watcher();
			}
		});

		// simplified watchers - no isBusy checks, proper async handling
		watcher_cleanup_funcs.push(
			this.$core.view.$watch('config.chrIncludeBaseClothing', () => refresh_character_appearance(this.$core)),
			this.$core.view.$watch('chrCustRaceSelection', () => update_chr_model_list(this.$core)),
			this.$core.view.$watch('chrCustModelSelection', () => update_model_selection(this.$core), { deep: true }),
			this.$core.view.$watch('chrCustOptionSelection', () => update_customization_type(this.$core), { deep: true }),
			this.$core.view.$watch('chrCustChoiceSelection', () => update_customization_choice(this.$core), { deep: true }),
			this.$core.view.$watch('chrCustActiveChoices', () => refresh_character_appearance(this.$core), { deep: true }),
			this.$core.view.$watch('chrEquippedItems', () => refresh_character_appearance(this.$core), { deep: true }),
			this.$core.view.$watch('chrGuildTabardConfig', () => refresh_character_appearance(this.$core), { deep: true }),
			this.$core.view.$watch('chrModelViewerAnimSelection', async selected_animation_id => {
				if (!active_renderer || !active_renderer.playAnimation || this.$core.view.chrModelViewerAnims.length === 0)
					return;

				this.$core.view.chrModelViewerAnimPaused = false;
				this.$core.view.chrModelViewerAnimFrame = 0;
				this.$core.view.chrModelViewerAnimFrameCount = 0;

				if (selected_animation_id !== null && selected_animation_id !== undefined) {
					if (selected_animation_id === 'none') {
						active_renderer?.stopAnimation?.();

						if (this.$core.view.modelViewerAutoAdjust)
							requestAnimationFrame(() => fit_camera(this.$core));

						return;
					}

					const anim_info = this.$core.view.chrModelViewerAnims.find(anim => anim.id == selected_animation_id);
					if (anim_info && anim_info.m2Index !== undefined && anim_info.m2Index >= 0) {
						log.write(`Playing animation ${selected_animation_id} at M2 index ${anim_info.m2Index}`);
						await active_renderer.playAnimation(anim_info.m2Index);

						this.$core.view.chrModelViewerAnimFrameCount = active_renderer.get_animation_frame_count();

						if (this.$core.view.modelViewerAutoAdjust)
							requestAnimationFrame(() => fit_camera(this.$core));
					}
				}
			})
		);

		state.optionToChoices = await DBCharacterCustomization.get_option_to_choices_map();

		// trigger initial race/model load
		await update_chr_race_list(this.$core);

		this.$core.hideLoadingScreen();

		const doc_click_handler = (event) => {
			if (this.$core.view.colorPickerOpenFor !== null) {
				const popup = event.target.closest('.color-picker-popup');
				const label = event.target.closest('.customization-color-label');
				if (!popup && !label)
					this.$core.view.colorPickerOpenFor = null;
			}

			if (this.$core.view.characterImportMode !== 'none') {
				const import_panel = event.target.closest('#character-import-panel-floating');
				const bnet_button = event.target.closest('.character-bnet-button');
				const wowhead_button = event.target.closest('.character-wowhead-button');
				if (!import_panel && !bnet_button && !wowhead_button)
					this.$core.view.characterImportMode = 'none';
			}
		};
		document.addEventListener('click', doc_click_handler);
		watcher_cleanup_funcs.push(() => document.removeEventListener('click', doc_click_handler));

		window.loadImportString = (str) => apply_import_data(this.$core, JSON.parse(str), 'bnet');

		window.reloadCharShaders = async () => {
			for (const material of chr_materials.values())
				await material.compileShaders();

			await refresh_character_appearance(this.$core);
		};

		charTextureOverlay.ensureActiveLayerAttached();
	},

	unmounted() {
		reset_module_state();
	}
};

//endregion
