/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
const log = require('../log');
const util = require('util');
const path = require('path');
const BufferWrapper = require('../buffer');
const generics = require('../generics');
const CharMaterialRenderer = require('../3D/renderers/CharMaterialRenderer');
const M2RendererGL = require('../3D/renderers/M2RendererGL');
const M2Exporter = require('../3D/exporters/M2Exporter');
const CharacterExporter = require('../3D/exporters/CharacterExporter');
const db2 = require('../casc/db2');
const ExportHelper = require('../casc/export-helper');
const listfile = require('../casc/listfile');
const realmlist = require('../casc/realmlist');
const DBCreatures = require('../db/caches/DBCreatures');
const { wmv_parse } = require('../wmv');
const { wowhead_parse } = require('../wowhead');
const InstallType = require('../install-type');
const charTextureOverlay = require('../ui/char-texture-overlay');
const PNGWriter = require('../png-writer');
const { EQUIPMENT_SLOTS, get_slot_name, get_attachment_ids_for_slot } = require('../wow/EquipmentSlots');
const DBItems = require('../db/caches/DBItems');
const DBItemCharTextures = require('../db/caches/DBItemCharTextures');
const DBItemGeosets = require('../db/caches/DBItemGeosets');
const DBItemModels = require('../db/caches/DBItemModels');


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
function get_current_race_gender(core) {
	const race_selection = core.view.chrCustRaceSelection?.[0];
	const model_selection = core.view.chrCustModelSelection?.[0];

	if (!race_selection || !model_selection)
		return null;

	const race_id = race_selection.id;
	const models_for_race = chr_race_x_chr_model_map.get(race_id);

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

const chr_model_id_to_file_data_id = new Map();
const chr_model_id_to_texture_layout_id = new Map();
const options_by_chr_model = new Map();
const option_to_choices = new Map();
const default_options = new Array();

const chr_race_map = new Map();
const chr_race_x_chr_model_map = new Map();

const choice_to_geoset = new Map();
const choice_to_chr_cust_material_id = new Map();
const choice_to_skinned_model = new Map();
const unsupported_choices = new Array();

const geoset_map = new Map();
const chr_cust_mat_map = new Map();
const chr_model_texture_layer_map = new Map();
const char_component_texture_section_map = new Map();
const chr_model_material_map = new Map();
const chr_cust_skinned_model_map = new Map();

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

function reset_module_state() {
	active_skins.clear();
	chr_model_id_to_file_data_id.clear();
	chr_model_id_to_texture_layout_id.clear();
	options_by_chr_model.clear();
	option_to_choices.clear();
	default_options.length = 0;
	chr_race_map.clear();
	chr_race_x_chr_model_map.clear();
	choice_to_geoset.clear();
	choice_to_chr_cust_material_id.clear();
	choice_to_skinned_model.clear();
	unsupported_choices.length = 0;
	geoset_map.clear();
	chr_cust_mat_map.clear();
	chr_model_texture_layer_map.clear();
	char_component_texture_section_map.clear();
	chr_model_material_map.clear();
	chr_cust_skinned_model_map.clear();
	skinned_model_renderers.clear();
	skinned_model_meshes.clear();
	chr_materials.clear();
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

	update_geosets(core);
	await update_textures(core);
	await update_equipment_models(core);

	log.write('Character appearance refresh complete');
}

/**
 * Updates all geoset visibility based on customization choices and equipped items.
 * Order: 1) Reset to model defaults, 2) Apply customization, 3) Apply equipment
 */
function update_geosets(core) {
	if (!active_renderer)
		return;

	const geosets = core.view.chrCustGeosets;
	if (!geosets || geosets.length === 0)
		return;

	// step 1: reset geosets to model defaults
	for (const geoset of geosets) {
		const id_str = geoset.id.toString();
		const is_default = (geoset.id === 0 || id_str.endsWith('01') || id_str.startsWith('32'));
		const is_hidden_default = id_str.startsWith('17') || id_str.startsWith('35');

		geoset.checked = is_default && !is_hidden_default;
	}

	// step 2: apply customization geosets
	const selection = core.view.chrCustActiveChoices;
	for (const active_choice of selection) {
		const available_choices = option_to_choices.get(active_choice.optionID);
		if (!available_choices)
			continue;

		for (const available_choice of available_choices) {
			const chr_cust_geo_id = choice_to_geoset.get(available_choice.id);
			const geoset_id = geoset_map.get(chr_cust_geo_id);

			if (geoset_id === undefined)
				continue;

			for (const geoset of geosets) {
				if (geoset.id === 0)
					continue;

				if (geoset.id === geoset_id) {
					const should_be_checked = available_choice.id === active_choice.choiceID;
					geoset.checked = should_be_checked;
				}
			}
		}
	}

	// step 3: apply equipment geosets (overrides customization where applicable)
	const equipped_items = core.view.chrEquippedItems;
	if (equipped_items && Object.keys(equipped_items).length > 0) {
		const equipment_geosets = DBItemGeosets.calculateEquipmentGeosets(equipped_items);
		const affected_groups = DBItemGeosets.getAffectedCharGeosets(equipped_items);

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

	// step 1: reset all materials
	for (const chr_material of chr_materials.values()) {
		await chr_material.reset();
		await chr_material.update();
	}

	let baked_npc_texture_type = null;

	// step 2: apply baked NPC texture (if present)
	if (core.view.chrCustBakedNPCTexture) {
		const blp = core.view.chrCustBakedNPCTexture;

		const available_types = [];
		for (const [key, value] of chr_model_material_map.entries()) {
			if (key.startsWith(current_char_component_texture_layout_id + '-'))
				available_types.push({ key, type: value.TextureType, material: value });
		}

		available_types.sort((a, b) => a.type - b.type);

		const chr_model_material = available_types.length > 0 ? available_types[0].material : null;
		const texture_type = available_types.length > 0 ? available_types[0].type : 0;

		if (chr_model_material) {
			let chr_material;

			if (!chr_materials.has(texture_type)) {
				chr_material = new CharMaterialRenderer(texture_type, chr_model_material.Width, chr_model_material.Height);
				chr_materials.set(texture_type, chr_material);
				await chr_material.init();
			} else {
				chr_material = chr_materials.get(texture_type);
			}

			await chr_material.setTextureTarget(
				{ FileDataID: 0, ChrModelTextureTargetID: 0 },
				{ X: 0, Y: 0, Width: chr_model_material.Width, Height: chr_model_material.Height },
				chr_model_material,
				{ BlendMode: 0, TextureType: texture_type, ChrModelTextureTargetID: [0, 0] },
				true,
				blp
			);

			baked_npc_texture_type = texture_type;
		}
	}

	// step 3: apply customization textures
	const selection = core.view.chrCustActiveChoices;
	for (const active_choice of selection) {
		const chr_cust_mat_ids = choice_to_chr_cust_material_id.get(active_choice.choiceID);
		if (chr_cust_mat_ids === undefined)
			continue;

		for (const chr_cust_mat_id of chr_cust_mat_ids) {
			if (chr_cust_mat_id.RelatedChrCustomizationChoiceID != 0) {
				const has_related_choice = selection.find((selected_choice) => selected_choice.choiceID === chr_cust_mat_id.RelatedChrCustomizationChoiceID);
				if (!has_related_choice)
					continue;
			}

			const chr_cust_mat = chr_cust_mat_map.get(chr_cust_mat_id.ChrCustomizationMaterialID);
			const chr_model_texture_target = chr_cust_mat.ChrModelTextureTargetID;

			const chr_model_texture_layer = chr_model_texture_layer_map.get(current_char_component_texture_layout_id + '-' + chr_model_texture_target);
			if (chr_model_texture_layer === undefined)
				continue;

			const chr_model_material = chr_model_material_map.get(current_char_component_texture_layout_id + '-' + chr_model_texture_layer.TextureType);
			if (chr_model_material === undefined)
				continue;

			// skip if baked NPC texture is applied to this texture type
			if (baked_npc_texture_type !== null && chr_model_material.TextureType === baked_npc_texture_type)
				continue;

			let chr_material;
			if (!chr_materials.has(chr_model_material.TextureType)) {
				chr_material = new CharMaterialRenderer(chr_model_material.TextureType, chr_model_material.Width, chr_model_material.Height);
				chr_materials.set(chr_model_material.TextureType, chr_material);
				await chr_material.init();
			} else {
				chr_material = chr_materials.get(chr_model_material.TextureType);
			}

			let char_component_texture_section;
			if (chr_model_texture_layer.TextureSectionTypeBitMask == -1) {
				char_component_texture_section = { X: 0, Y: 0, Width: chr_model_material.Width, Height: chr_model_material.Height };
			} else {
				const char_component_texture_section_results = char_component_texture_section_map.get(current_char_component_texture_layout_id);
				for (const char_component_texture_section_row of char_component_texture_section_results) {
					if ((1 << char_component_texture_section_row.SectionType) & chr_model_texture_layer.TextureSectionTypeBitMask) {
						char_component_texture_section = char_component_texture_section_row;
						break;
					}
				}
			}

			if (char_component_texture_section === undefined)
				continue;

			await chr_material.setTextureTarget(chr_cust_mat, char_component_texture_section, chr_model_material, chr_model_texture_layer, true);
		}
	}

	// step 4: apply equipment textures
	const equipped_items = core.view.chrEquippedItems;
	if (equipped_items && Object.keys(equipped_items).length > 0) {
		const sections = char_component_texture_section_map.get(current_char_component_texture_layout_id);
		if (sections) {
			const section_by_type = new Map();
			for (const section of sections)
				section_by_type.set(section.SectionType, section);

			let base_layer = null;
			for (const [key, layer] of chr_model_texture_layer_map) {
				if (!key.startsWith(current_char_component_texture_layout_id + '-'))
					continue;

				if (layer.TextureSectionTypeBitMask === -1 && layer.TextureType === 1) {
					base_layer = layer;
					break;
				}
			}

			const layers_by_section = new Map();
			for (const [key, layer] of chr_model_texture_layer_map) {
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
				const item_textures = DBItemCharTextures.getItemTextures(item_id);
				if (!item_textures)
					continue;

				for (const texture of item_textures) {
					const section = section_by_type.get(texture.section);
					if (!section)
						continue;

					const layer = layers_by_section.get(texture.section);
					if (!layer)
						continue;

					const chr_model_material = chr_model_material_map.get(current_char_component_texture_layout_id + '-' + layer.TextureType);
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
						ChrModelTextureTargetID: 100 + texture.section,
						FileDataID: texture.fileDataID
					};

					await chr_material.setTextureTarget(item_material, section, chr_model_material, layer, true);
				}
			}
		}
	}

	// step 5: upload all textures to GPU
	for (const [chr_model_texture_target, chr_material] of chr_materials) {
		await chr_material.update();
		const pixels = chr_material.getRawPixels();
		await active_renderer.overrideTextureTypeWithPixels(
			chr_model_texture_target,
			chr_material.glCanvas.width,
			chr_material.glCanvas.height,
			pixels
		);
	}
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
		const char_info = get_current_race_gender(core);

		// get display data for this item (models and textures, filtered by race/gender)
		const display = DBItemModels.getItemDisplay(item_id, char_info?.raceID, char_info?.genderIndex);
		if (!display || !display.models || display.models.length === 0)
			continue;

		// get attachment IDs for this slot (may be empty for body slots)
		const attachment_ids = get_attachment_ids_for_slot(slot_id) || [];

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
					log.write('Loaded attachment model %d for slot %d attachment %d (item %d) collection_style=%s', file_data_id, slot_id, attachment_id, item_id, is_collection_style);
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
				label: require('../3D/AnimMapper').get_anim_name(animation.id) + ' (' + Math.floor(animation.id) + '.' + animation.variationIndex + ')'
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
			core.setToast('info', util.format('The model %s doesn\'t have any 3D data associated with it.', file_data_id), null, 4000);

		// refresh appearance after model is fully loaded
		await refresh_character_appearance(core);

	} catch (e) {
		core.setToast('error', 'Unable to load model ' + file_data_id, { 'View log': () => log.openRuntimelog() }, -1);
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
	for (const chr_material of chr_materials.values())
		chr_material.dispose();

	chr_materials.clear();
}

function fit_camera(core) {
	if (core.view.chrModelViewerContext?.fitCamera)
		core.view.chrModelViewerContext.fitCamera();
}

//endregion

//region character state
function update_chr_model_list(core) {
	const race_selection = core.view.chrCustRaceSelection[0];
	if (!race_selection)
		return;

	const models_for_race = chr_race_x_chr_model_map.get(race_selection.id);
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

	const available_options = options_by_chr_model.get(selected.id);
	if (available_options === undefined)
		return;

	// update texture layout for the new model
	current_char_component_texture_layout_id = chr_model_id_to_texture_layout_id.get(selected.id);

	// clear materials for new model
	clear_materials();

	// update customization options list
	state.chrCustOptions.splice(0, state.chrCustOptions.length);
	state.chrCustOptionSelection.splice(0, state.chrCustOptionSelection.length);
	state.chrCustActiveChoices.splice(0, state.chrCustActiveChoices.length);

	// use imported choices if available, otherwise use defaults
	if (state.chrImportChoices.length > 0) {
		state.chrCustActiveChoices.push(...state.chrImportChoices);
		state.chrImportChoices.splice(0, state.chrImportChoices.length);
	} else {
		for (const option of available_options) {
			const choices = option_to_choices.get(option.id);
			if (default_options.includes(option.id) && choices && choices.length > 0)
				state.chrCustActiveChoices.push({ optionID: option.id, choiceID: choices[0].id });
		}
	}

	state.chrCustOptions.push(...available_options);
	state.chrCustOptionSelection.push(...available_options.slice(0, 1));
	state.optionToChoices = option_to_choices;

	// load the model (this will call refresh_character_appearance when done)
	const file_data_id = chr_model_id_to_file_data_id.get(selected.id);
	await load_character_model(core, file_data_id);
}

function update_customization_type(core) {
	const state = core.view;
	const selection = state.chrCustOptionSelection;

	if (selection.length === 0)
		return;

	const selected = selection[0];

	const available_choices = option_to_choices.get(selected.id);
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

function randomize_customization(core) {
	const state = core.view;
	const options = state.chrCustOptions;

	for (const option of options) {
		const choices = option_to_choices.get(option.id);
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

	const character_label = util.format('%s (%s-%s)', character_name, effective_region, selected_realm.label);
	const url = util.format(core.view.config.armoryURL, encodeURIComponent(effective_region), encodeURIComponent(selected_realm.value), encodeURIComponent(character_name.toLowerCase()));
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
			const path = require('path');
			core.view.config.lastWMVImportPath = path.dirname(file_path);
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

		const chr_model_id = chr_race_x_chr_model_map.get(race_id).get(gender_index);
		const available_options = options_by_chr_model.get(chr_model_id);
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

		const chr_model_id = chr_race_x_chr_model_map.get(race_id).get(gender_index);
		const available_options = options_by_chr_model.get(chr_model_id);
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
						const choices = option_to_choices.get(option.id);
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

		const chr_model_id = chr_race_x_chr_model_map.get(race_id).get(gender_index);
		const available_options = options_by_chr_model.get(chr_model_id);

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

		const chr_model_id = chr_race_x_chr_model_map.get(race_id).get(gender_index);
		core.view.chrImportChrModelID = chr_model_id;

		core.view.chrCustRaceSelection = [core.view.chrCustRaces.find(e => e.id === race_id)];

		await update_model_selection(core);
	} finally {
		is_importing = false;
	}
}

//endregion

//region race
function update_chr_race_list(core) {
	const listed_model_ids = [];
	const listed_race_ids = [];

	core.view.chrCustRacesPlayable = [];
	core.view.chrCustRacesNPC = [];

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
				const file_name = listfile.getByID(active_model);
				const export_path = ExportHelper.getExportPath(file_name);
				let out_file = ExportHelper.replaceExtension(export_path, '.png');

				if (core.view.config.modelsExportPngIncrements)
					out_file = await ExportHelper.getIncrementalFilename(out_file);

				const out_dir = path.dirname(out_file);

				await buf.writeToFile(out_file);
				await export_paths?.writeLine('PNG:' + out_file);

				log.write('saved 3d preview screenshot to %s', out_file);
				core.setToast('success', util.format('successfully exported preview to %s', out_file), { 'view in explorer': () => nw.Shell.openItem(out_dir) }, -1);
			} else if (format === 'CLIPBOARD') {
				const clipboard = nw.Clipboard.get();
				clipboard.set(buf.toBase64(), 'png', true);

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
	const file_name = listfile.getByID(file_data_id);

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
				const char_info = get_current_race_gender(core);
				const equipment_data = [];

				for (const geom of char_exporter.get_equipment_geometry(apply_pose)) {
					// get textures from display info
					const display = DBItemModels.getItemDisplay(geom.item_id, char_info?.raceID, char_info?.genderIndex);
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
				const char_info = get_current_race_gender(core);
				const equipment_data = [];

				// for GLTF, don't apply pose - let the armature handle it
				for (const geom of char_exporter.get_equipment_geometry(false)) {
					const display = DBItemModels.getItemDisplay(geom.item_id, char_info?.raceID, char_info?.genderIndex);
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

	const file_name = listfile.getByID(active_model);
	const base_name = path.basename(file_name, path.extname(file_name));
	const dir_name = path.dirname(file_name);
	const texture_file_name = path.join(dir_name, base_name + '_texture_' + texture_type + '.png');
	const export_path = ExportHelper.getExportPath(texture_file_name);
	const out_dir = path.dirname(export_path);

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
	core.setToast('success', util.format('exported texture to %s', export_path), { 'view in explorer': () => nw.Shell.openItem(out_dir) }, -1);

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

function get_selected_choice(core, option_id) {
	const active_choice = core.view.chrCustActiveChoices.find(c => c.optionID === option_id);
	if (!active_choice)
		return null;

	const choices = option_to_choices.get(option_id);
	if (!choices)
		return null;

	return choices.find(c => c.id === active_choice.choiceID);
}

//endregion

//region template
module.exports = {
	register() {
		this.registerNavButton('Characters', 'person-solid.svg', InstallType.CASC);
	},

	template: `
		<div class="tab" id="tab-characters">
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
				<input type="button" value="" title="Import from Battle.net" class="ui-image-button character-bnet-button" @click="$core.view.characterImportMode = $core.view.characterImportMode === 'BNET' ? 'none' : 'BNET'" :class="{ active: $core.view.characterImportMode === 'BNET' }"/>
				<input type="button" value="" title="Import from Wowhead" class="ui-image-button character-wowhead-button" @click="$core.view.characterImportMode = $core.view.characterImportMode === 'WHEAD' ? 'none' : 'WHEAD'" :class="{ active: $core.view.characterImportMode === 'WHEAD' }"/>
				<input type="button" value="" title="Import from WoW Model Viewer" class="ui-image-button character-wmv-button" @click="import_wmv"/>
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
					<div class="chr-cust-controls">
						<span class="chr-randomize-toggle" @click="randomize_customization">Randomize Customization</span>
						<span @click="$core.view.chrShowGeosetControl = true">Custom Geoset Control</span>
					</div>
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
					<span class="chr-geoset-return" @click="$core.view.chrShowGeosetControl = false">Return to Customization</span>
				</template>
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
				<div v-for="slot in equipment_slots" :key="slot.id" class="equipment-slot" @click="open_slot_context($event, slot.id)" @contextmenu.prevent="open_slot_context($event, slot.id)">
					<span class="slot-label">{{ slot.name }}:</span>
					<span v-if="get_equipped_item(slot.id)" :class="'slot-item item-quality-' + get_equipped_item(slot.id).quality" :title="get_equipped_item(slot.id).name + ' (' + get_equipped_item(slot.id).id + ')'">{{ get_equipped_item(slot.id).name }}</span>
					<span v-else class="slot-empty">Empty</span>
				</div>
				<component :is="$components.ContextMenu" :node="$core.view.chrEquipmentSlotContext" v-slot:default="context" @close="$core.view.chrEquipmentSlotContext = null">
					<span @click.self="unequip_slot(context.node)">Remove Item</span>
				</component>
				<div class="chr-cust-controls">
					<span @click="clear_all_equipment">Clear All Equipment</span>
				</div>
			</div>
		</div>
	`,

	data() {
		return {
			equipment_slots: EQUIPMENT_SLOTS,
			base_regions: ['us', 'eu', 'kr', 'tw']
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

		chr_prev_overlay() {
			this.$core.events.emit('click-chr-prev-overlay');
		},

		chr_next_overlay() {
			this.$core.events.emit('click-chr-next-overlay');
		},

		chr_export_overlay() {
			export_chr_texture(this.$core);
		},

		get_equipped_item(slot_id) {
			const item_id = this.$core.view.chrEquippedItems[slot_id];
			if (!item_id)
				return null;

			return DBItems.getItemById(item_id);
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

		clear_all_equipment() {
			this.$core.view.chrEquippedItems = {};
		}
	},

	async mounted() {
		const state = this.$core.view;

		reset_module_state();

		this.$core.showLoadingScreen(15);

		await this.$core.progressLoadingScreen('Retrieving realmlist...');
		await realmlist.load();

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
		state.chrImportSelectedRegion = 'us';

		await this.$core.progressLoadingScreen('Loading texture mapping...');
		const tfd_map = new Map();
		for (const tfd_row of (await db2.TextureFileData.getAllRows()).values()) {
			if (tfd_row.UsageType != 0)
				continue;
			tfd_map.set(tfd_row.MaterialResourcesID, tfd_row.FileDataID);
		}

		await this.$core.progressLoadingScreen('Loading creature data...');
		await DBCreatures.initializeCreatureData();

		await this.$core.progressLoadingScreen('Loading item data...');
		await DBItems.ensureInitialized();

		await this.$core.progressLoadingScreen('Loading item character textures...');
		await DBItemCharTextures.ensureInitialized();

		await this.$core.progressLoadingScreen('Loading item geosets...');
		await DBItemGeosets.ensureInitialized();

		await this.$core.progressLoadingScreen('Loading item models...');
		await DBItemModels.ensureInitialized();

		await this.$core.progressLoadingScreen('Loading character customization elements...');
		for (const chr_customization_element_row of (await db2.ChrCustomizationElement.getAllRows()).values()) {
			if (chr_customization_element_row.ChrCustomizationGeosetID != 0)
				choice_to_geoset.set(chr_customization_element_row.ChrCustomizationChoiceID, chr_customization_element_row.ChrCustomizationGeosetID);

			if (chr_customization_element_row.ChrCustomizationSkinnedModelID != 0) {
				choice_to_skinned_model.set(chr_customization_element_row.ChrCustomizationChoiceID, chr_customization_element_row.ChrCustomizationSkinnedModelID);
				unsupported_choices.push(chr_customization_element_row.ChrCustomizationChoiceID);
			}

			if (chr_customization_element_row.ChrCustomizationBoneSetID != 0)
				unsupported_choices.push(chr_customization_element_row.ChrCustomizationChoiceID);

			if (chr_customization_element_row.ChrCustomizationCondModelID != 0)
				unsupported_choices.push(chr_customization_element_row.ChrCustomizationChoiceID);

			if (chr_customization_element_row.ChrCustomizationDisplayInfoID != 0)
				unsupported_choices.push(chr_customization_element_row.ChrCustomizationChoiceID);

			if (chr_customization_element_row.ChrCustomizationMaterialID != 0) {
				if (choice_to_chr_cust_material_id.has(chr_customization_element_row.ChrCustomizationChoiceID))
					choice_to_chr_cust_material_id.get(chr_customization_element_row.ChrCustomizationChoiceID).push({ ChrCustomizationMaterialID: chr_customization_element_row.ChrCustomizationMaterialID, RelatedChrCustomizationChoiceID: chr_customization_element_row.RelatedChrCustomizationChoiceID });
				else
					choice_to_chr_cust_material_id.set(chr_customization_element_row.ChrCustomizationChoiceID, [{ ChrCustomizationMaterialID: chr_customization_element_row.ChrCustomizationMaterialID, RelatedChrCustomizationChoiceID: chr_customization_element_row.RelatedChrCustomizationChoiceID }]);

				const mat_row = await db2.ChrCustomizationMaterial.getRow(chr_customization_element_row.ChrCustomizationMaterialID);
				if (mat_row !== null)
					chr_cust_mat_map.set(mat_row.ID, {ChrModelTextureTargetID: mat_row.ChrModelTextureTargetID, FileDataID: tfd_map.get(mat_row.MaterialResourcesID)});
			}
		}

		await this.$core.progressLoadingScreen('Loading character customization options...');

		const options_by_model = new Map();
		const choices_by_option = new Map();
		const unsupported_choices_set = new Set(unsupported_choices);

		for (const [chr_customization_option_id, chr_customization_option_row] of await db2.ChrCustomizationOption.getAllRows()) {
			const model_id = chr_customization_option_row.ChrModelID;
			if (!options_by_model.has(model_id))
				options_by_model.set(model_id, []);

			options_by_model.get(model_id).push([chr_customization_option_id, chr_customization_option_row]);
		}

		for (const [chr_customization_choice_id, chr_customization_choice_row] of await db2.ChrCustomizationChoice.getAllRows()) {
			const option_id = chr_customization_choice_row.ChrCustomizationOptionID;
			if (!choices_by_option.has(option_id))
				choices_by_option.set(option_id, []);

			choices_by_option.get(option_id).push([chr_customization_choice_id, chr_customization_choice_row]);
		}

		for (const [chr_model_id, chr_model_row] of await db2.ChrModel.getAllRows()) {
			const file_data_id = DBCreatures.getFileDataIDByDisplayID(chr_model_row.DisplayID);

			chr_model_id_to_file_data_id.set(chr_model_id, file_data_id);
			chr_model_id_to_texture_layout_id.set(chr_model_id, chr_model_row.CharComponentTextureLayoutID);

			const model_options = options_by_model.get(chr_model_id);
			if (!model_options)
				continue;

			for (const [chr_customization_option_id, chr_customization_option_row] of model_options) {
				const choice_list = [];

				if (!options_by_chr_model.has(chr_customization_option_row.ChrModelID))
					options_by_chr_model.set(chr_customization_option_row.ChrModelID, []);

				let option_name = '';
				if (chr_customization_option_row.Name_lang != '')
					option_name = chr_customization_option_row.Name_lang;
				else
					option_name = 'Option ' + chr_customization_option_row.OrderIndex;

				options_by_chr_model.get(chr_customization_option_row.ChrModelID).push({ id: chr_customization_option_id, label: option_name });

				const option_choices = choices_by_option.get(chr_customization_option_id);
				if (option_choices) {
					for (const [chr_customization_choice_id, chr_customization_choice_row] of option_choices) {
						let name = '';
						if (chr_customization_choice_row.Name_lang != '')
							name = chr_customization_choice_row.Name_lang;
						else
							name = 'Choice ' + chr_customization_choice_row.OrderIndex;

						const [swatch_color_0, swatch_color_1] = chr_customization_choice_row.SwatchColor || [0, 0];
						choice_list.push({
							id: chr_customization_choice_id,
							label: name,
							swatch_color_0,
							swatch_color_1
						});
					}
				}

				const is_color_swatch = choice_list.some(c => c.swatch_color_0 !== 0 || c.swatch_color_1 !== 0);
				option_to_choices.set(chr_customization_option_id, choice_list);
				if (is_color_swatch)
					options_by_chr_model.get(chr_customization_option_row.ChrModelID)[options_by_chr_model.get(chr_customization_option_row.ChrModelID).length - 1].is_color_swatch = true;

				if (!(chr_customization_option_row.Flags & 0x20))
					default_options.push(chr_customization_option_id);
			}
		}

		await this.$core.progressLoadingScreen('Loading character races..');
		for (const [chr_race_id, chr_race_row] of await db2.ChrRaces.getAllRows()) {
			const flags = chr_race_row.Flags;
			chr_race_map.set(chr_race_id, { id: chr_race_id, name: chr_race_row.Name_lang, isNPCRace: ((flags & 1) == 1 && chr_race_id != 23 && chr_race_id != 75) });
		}

		await this.$core.progressLoadingScreen('Loading character race models..');
		for (const chr_race_x_chr_model_row of (await db2.ChrRaceXChrModel.getAllRows()).values()) {
			if (!chr_race_x_chr_model_map.has(chr_race_x_chr_model_row.ChrRacesID))
				chr_race_x_chr_model_map.set(chr_race_x_chr_model_row.ChrRacesID, new Map());

			chr_race_x_chr_model_map.get(chr_race_x_chr_model_row.ChrRacesID).set(chr_race_x_chr_model_row.Sex, chr_race_x_chr_model_row.ChrModelID);
		}

		await this.$core.progressLoadingScreen('Loading character model materials..');
		for (const chr_model_material_row of (await db2.ChrModelMaterial.getAllRows()).values())
			chr_model_material_map.set(chr_model_material_row.CharComponentTextureLayoutsID + '-' + chr_model_material_row.TextureType, chr_model_material_row);

		await this.$core.progressLoadingScreen('Loading character component texture sections...');
		const char_component_texture_section_db = db2.CharComponentTextureSections;
		for (const char_component_texture_section_row of (await char_component_texture_section_db.getAllRows()).values()) {
			if (!char_component_texture_section_map.has(char_component_texture_section_row.CharComponentTextureLayoutID))
				char_component_texture_section_map.set(char_component_texture_section_row.CharComponentTextureLayoutID, []);

			char_component_texture_section_map.get(char_component_texture_section_row.CharComponentTextureLayoutID).push(char_component_texture_section_row);
		}

		await this.$core.progressLoadingScreen('Loading character model texture layers...');
		const chr_model_texture_layer_db = db2.ChrModelTextureLayer;
		for (const chr_model_texture_layer_row of (await chr_model_texture_layer_db.getAllRows()).values())
			chr_model_texture_layer_map.set(chr_model_texture_layer_row.CharComponentTextureLayoutsID + '-' + chr_model_texture_layer_row.ChrModelTextureTargetID[0], chr_model_texture_layer_row);

		await this.$core.progressLoadingScreen('Loading character customization geosets...');
		for (const [chr_customization_geoset_id, chr_customization_geoset_row] of await db2.ChrCustomizationGeoset.getAllRows()) {
			const geoset = chr_customization_geoset_row.GeosetType.toString().padStart(2, '0') + chr_customization_geoset_row.GeosetID.toString().padStart(2, '0');
			geoset_map.set(chr_customization_geoset_id, Number(geoset));
		}

		await this.$core.progressLoadingScreen('Loading character customization skinned models...');

		const chr_cust_skinned_model_db = db2.ChrCustomizationSkinnedModel;
		for (const [chr_customization_skinned_model_id, chr_customization_skinned_model_row] of await chr_cust_skinned_model_db.getAllRows())
			chr_cust_skinned_model_map.set(chr_customization_skinned_model_id, chr_customization_skinned_model_row);

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

		state.optionToChoices = option_to_choices;

		// trigger initial race/model load
		update_chr_race_list(this.$core);

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
