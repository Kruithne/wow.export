import log from '../log.js';
import * as platform from '../platform.js';
import InstallType from '../install-type.js';
import { listfile, exporter, dbc } from '../../views/main/rpc.js';
import listboxContext from '../ui/listbox-context.js';
import CharMaterialRenderer from '../3D/renderers/CharMaterialRenderer.js';

import BLPFile from '../casc/blp.js';
import M2RendererGL from '../3D/renderers/M2RendererGL.js';
import M2Exporter from '../3D/exporters/M2Exporter.js';

import { get_slot_name, get_attachment_ids_for_slot, get_slot_layer, ATTACHMENT_ID } from '../wow/EquipmentSlots.js';

import textureRibbon from '../ui/texture-ribbon.js';
import textureExporter from '../ui/texture-exporter.js';
import modelViewerUtils from '../ui/model-viewer-utils.js';
import character_appearance from '../ui/character-appearance.js';
import { DBCreatures, DBCreatureDisplayExtra, DBCreatureList, DBItemGeosets, DBItemModels, DBItemCharTextures, DBItems, DBNpcEquipment, DBCharacterCustomization, DBModelFileData } from '../db-proxy.js';

const ExportHelper = exporter;

const active_skins = new Map();
let selected_variant_texture_ids = new Array();

let active_renderer;
let active_file_data_id;
let active_creature;
let is_character_model = false;
const creature_chr_materials = new Map();

// equipment state
const equipment_model_renderers = new Map();
const collection_model_renderers = new Map();
let creature_equipment = null;
let creature_extra_info = null;
let creature_layout_id = 0;
let equipment_refresh_lock = false;

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

const get_creature_displays = async (file_data_id) => {
	return await DBCreatures.getCreatureDisplaysByFileDataID(file_data_id) ?? [];
};

/**
 * Build equipment data for a character-model creature.
 * Returns Map<slot_id, { display_id, item_id? }> or null.
 */
const build_creature_equipment = async (extra_display_id, creature) => {
	const equipment = new Map();

	// armor from NpcModelItemSlotDisplayInfo (display-ID-based)
	const npc_armor = await DBNpcEquipment.get_equipment(extra_display_id);
	if (npc_armor) {
		for (const [slot_id, display_id] of npc_armor)
			equipment.set(slot_id, { display_id });
	}

	// weapons from Creature.AlwaysItem (item-ID-based)
	if (creature.always_items) {
		for (let i = 0; i < creature.always_items.length && i < 2; i++) {
			const item_id = creature.always_items[i];
			const slot_id = i === 0 ? 16 : 17;
			const display_id = await DBItemModels.getDisplayId(item_id);
			if (display_id !== undefined)
				equipment.set(slot_id, { display_id, item_id });
		}
	}

	return equipment.size > 0 ? equipment : null;
};

/**
 * Build checklist array for equipment toggle UI.
 */
const build_equipment_checklist = (equipment) => {
	if (!equipment)
		return [];

	const list = [];
	for (const [slot_id, entry] of equipment) {
		const slot_name = get_slot_name(slot_id) ?? 'Slot ' + slot_id;
		list.push({
			id: slot_id,
			label: slot_name + ' (' + entry.display_id + ')',
			checked: true
		});
	}

	list.sort((a, b) => a.id - b.id);
	return list;
};

/**
 * Get enabled equipment slots from the checklist.
 */
const get_enabled_equipment = () => {
	if (!creature_equipment)
		return null;

	const enabled = new Map();
	const checklist = creature_equipment._checklist;
	if (!checklist)
		return creature_equipment;

	for (const item of checklist) {
		if (item.checked && creature_equipment.has(item.id))
			enabled.set(item.id, creature_equipment.get(item.id));
	}

	return enabled.size > 0 ? enabled : null;
};

/**
 * Apply equipment geosets to creature character model.
 */
const apply_creature_equipment_geosets = async (core) => {
	if (!active_renderer || !is_character_model)
		return;

	const geosets = core.view.creatureViewerGeosets;
	if (!geosets || geosets.length === 0)
		return;

	const enabled = get_enabled_equipment();
	if (!enabled)
		return;

	// build display-id-based slot map for armor
	const slot_display_map = new Map();
	for (const [slot_id, entry] of enabled) {
		if (slot_id <= 19)
			slot_display_map.set(slot_id, entry.display_id);
	}

	if (slot_display_map.size === 0)
		return;

	const equipment_geosets = await DBItemGeosets.calculateEquipmentGeosetsByDisplay(slot_display_map);
	const affected_groups = await DBItemGeosets.getAffectedCharGeosetsByDisplay(slot_display_map);

	for (const char_geoset of affected_groups) {
		const base = char_geoset * 100;
		const range_start = base + 1;
		const range_end = base + 99;

		for (const geoset of geosets) {
			if (geoset.id >= range_start && geoset.id <= range_end)
				geoset.checked = false;
		}

		const value = equipment_geosets.get(char_geoset);
		if (value !== undefined) {
			const target_geoset_id = base + value;
			for (const geoset of geosets) {
				if (geoset.id === target_geoset_id)
					geoset.checked = true;
			}
		}
	}

	// helmet hide geosets
	const head_entry = enabled.get(1);
	if (head_entry && creature_extra_info) {
		const hide_groups = await DBItemGeosets.getHelmetHideGeosetsByDisplayId(
			head_entry.display_id,
			creature_extra_info.DisplayRaceID,
			creature_extra_info.DisplaySexID
		);

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

	active_renderer.updateGeosets();
};

/**
 * Apply equipment textures to creature character model.
 */
const apply_creature_equipment_textures = async (core) => {
	if (!active_renderer || !is_character_model)
		return;

	const enabled = get_enabled_equipment();
	if (!enabled || creature_layout_id === 0)
		return;

	const sections = await DBCharacterCustomization.get_texture_sections(creature_layout_id);
	if (!sections)
		return;

	const section_by_type = new Map();
	for (const section of sections)
		section_by_type.set(section.SectionType, section);

	const texture_layer_map = await DBCharacterCustomization.get_model_texture_layer_map();
	let base_layer = null;
	for (const [key, layer] of texture_layer_map) {
		if (!key.startsWith(creature_layout_id + '-'))
			continue;

		if (layer.TextureSectionTypeBitMask === -1 && layer.TextureType === 1) {
			base_layer = layer;
			break;
		}
	}

	const layers_by_section = new Map();
	for (const [key, layer] of texture_layer_map) {
		if (!key.startsWith(creature_layout_id + '-'))
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

	for (const [slot_id, entry] of enabled) {
		// use display-ID-based lookup for armor, item-ID-based for weapons
		const item_textures = entry.item_id
			? await DBItemCharTextures.getItemTextures(entry.item_id, creature_extra_info?.DisplayRaceID, creature_extra_info?.DisplaySexID)
			: await DBItemCharTextures.getTexturesByDisplayId(entry.display_id, creature_extra_info?.DisplayRaceID, creature_extra_info?.DisplaySexID);

		if (!item_textures)
			continue;

		for (const texture of item_textures) {
			const section = section_by_type.get(texture.section);
			if (!section)
				continue;

			const layer = layers_by_section.get(texture.section);
			if (!layer)
				continue;

			const chr_model_material = await DBCharacterCustomization.get_model_material(creature_layout_id, layer.TextureType);
			if (!chr_model_material)
				continue;

			let chr_material;
			if (!creature_chr_materials.has(chr_model_material.TextureType)) {
				chr_material = new CharMaterialRenderer(chr_model_material.TextureType, chr_model_material.Width, chr_model_material.Height);
				creature_chr_materials.set(chr_model_material.TextureType, chr_material);
				await chr_material.init();
			} else {
				chr_material = creature_chr_materials.get(chr_model_material.TextureType);
			}

			const slot_layer = get_slot_layer(slot_id);
			const item_material = {
				ChrModelTextureTargetID: (slot_layer * 100) + texture.section,
				FileDataID: texture.fileDataID
			};

			await chr_material.setTextureTarget(item_material, section, chr_model_material, layer, true);
		}
	}
};

/**
 * Apply equipment 3D models (weapons, shoulders, helmets, capes, etc.).
 */
const apply_creature_equipment_models = async (core) => {
	if (!active_renderer || !is_character_model)
		return;

	const gl_context = core.view.creatureViewerContext?.gl_context;
	if (!gl_context)
		return;

	const enabled = get_enabled_equipment();

	// dispose models for slots no longer enabled
	for (const slot_id of equipment_model_renderers.keys()) {
		if (!enabled?.has(slot_id)) {
			const entry = equipment_model_renderers.get(slot_id);
			for (const { renderer } of entry.renderers)
				renderer.dispose();

			equipment_model_renderers.delete(slot_id);
		}
	}

	for (const slot_id of collection_model_renderers.keys()) {
		if (!enabled?.has(slot_id)) {
			const entry = collection_model_renderers.get(slot_id);
			for (const renderer of entry.renderers)
				renderer.dispose();

			collection_model_renderers.delete(slot_id);
		}
	}

	if (!enabled)
		return;

	const race_id = creature_extra_info?.DisplayRaceID;
	const gender_index = creature_extra_info?.DisplaySexID;

	for (const [slot_id, entry] of enabled) {
		const existing_equip = equipment_model_renderers.get(slot_id);
		const existing_coll = collection_model_renderers.get(slot_id);
		if ((existing_equip?.display_id === entry.display_id) && (existing_coll?.display_id === entry.display_id || !existing_coll))
			continue;

		// dispose old if display changed
		if (existing_equip) {
			for (const { renderer } of existing_equip.renderers)
				renderer.dispose();

			equipment_model_renderers.delete(slot_id);
		}

		if (existing_coll) {
			for (const renderer of existing_coll.renderers)
				renderer.dispose();

			collection_model_renderers.delete(slot_id);
		}

		// use item-ID-based lookup for weapons, display-ID-based for armor
		const display = entry.item_id
			? await DBItemModels.getItemDisplay(entry.item_id, race_id, gender_index)
			: await DBItemModels.getDisplayData(entry.display_id, race_id, gender_index);

		if (!display?.models || display.models.length === 0)
			continue;

		// bows held in left hand
		let attachment_ids = get_attachment_ids_for_slot(slot_id) || [];
		if (slot_id === 16 && entry.item_id && await DBItems.isItemBow(entry.item_id))
			attachment_ids = [ATTACHMENT_ID.HAND_LEFT];

		const attachment_model_count = Math.min(display.models.length, attachment_ids.length);
		const collection_start_index = attachment_model_count;

		// attachment models
		if (attachment_model_count > 0) {
			const renderers = [];
			for (let i = 0; i < attachment_model_count; i++) {
				const file_data_id = display.models[i];
				const attachment_id = attachment_ids[i];

				try {
					const file = await core.view.casc.getFile(file_data_id);
					const renderer = new M2RendererGL(file, gl_context, false, false);
					await renderer.load();

					if (display.textures && display.textures.length > i)
						await renderer.applyReplaceableTextures({ textures: [display.textures[i]] });

					renderers.push({ renderer, attachment_id });
					log.write('Loaded creature attachment model %d for slot %d', file_data_id, slot_id);
				} catch (e) {
					log.write('Failed to load creature attachment model %d: %s', file_data_id, e.message);
				}
			}

			if (renderers.length > 0)
				equipment_model_renderers.set(slot_id, { renderers, display_id: entry.display_id });
		}

		// collection models
		if (display.models.length > collection_start_index) {
			const renderers = [];
			for (let i = collection_start_index; i < display.models.length; i++) {
				const file_data_id = display.models[i];

				try {
					const file = await core.view.casc.getFile(file_data_id);
					const renderer = new M2RendererGL(file, gl_context, false, false);
					await renderer.load();

					if (active_renderer?.bones)
						renderer.buildBoneRemapTable(active_renderer.bones);

					const slot_geosets = SLOT_TO_GEOSET_GROUPS[slot_id];
					if (slot_geosets && display.attachmentGeosetGroup) {
						renderer.hideAllGeosets();
						for (const mapping of slot_geosets) {
							const value = display.attachmentGeosetGroup[mapping.group_index];
							if (value !== undefined)
								renderer.setGeosetGroupDisplay(mapping.char_geoset, 1 + value);
						}
					}

					const texture_idx = i < display.textures?.length ? i : 0;
					const texture_fdid = display.textures?.[texture_idx];

					if (texture_fdid)
						await renderer.applyReplaceableTextures({ textures: [texture_fdid] });

					renderers.push(renderer);
					log.write('Loaded creature collection model %d for slot %d', file_data_id, slot_id);
				} catch (e) {
					log.write('Failed to load creature collection model %d: %s', file_data_id, e.message);
				}
			}

			if (renderers.length > 0)
				collection_model_renderers.set(slot_id, { renderers, display_id: entry.display_id });
		}
	}
};

/**
 * Dispose all creature equipment model renderers.
 */
const dispose_creature_equipment = () => {
	for (const entry of equipment_model_renderers.values()) {
		for (const { renderer } of entry.renderers)
			renderer.dispose();
	}
	equipment_model_renderers.clear();

	for (const entry of collection_model_renderers.values()) {
		for (const renderer of entry.renderers)
			renderer.dispose();
	}
	collection_model_renderers.clear();

	creature_equipment = null;
	creature_extra_info = null;
	creature_layout_id = 0;
};

/**
 * Full equipment refresh: geosets, textures, models.
 */
const refresh_creature_equipment = async (core) => {
	if (!active_renderer || !is_character_model || !creature_equipment)
		return;

	// re-apply customization geosets first (reset)
	const display_info = await DBCreatures.getDisplayInfo(active_creature.displayID);
	const customization_choices = await DBCreatureDisplayExtra.get_customization_choices(display_info.extendedDisplayInfoID);
	await character_appearance.apply_customization_geosets(core.view.creatureViewerGeosets, customization_choices);

	// re-apply customization textures (reset materials)
	let baked_npc_blp = null;
	const bake_id = creature_extra_info.HDBakeMaterialResourcesID || creature_extra_info.BakeMaterialResourcesID;
	if (bake_id > 0) {
		const bake_fdid = await DBCharacterCustomization.get_texture_file_data_id(bake_id);
		if (bake_fdid) {
			try {
				const bake_data = await core.view.casc.getFile(bake_fdid);
				baked_npc_blp = new BLPFile(bake_data);
			} catch (e) {
				log.write('Failed to load baked NPC texture %d: %s', bake_fdid, e.message);
			}
		}
	}

	await character_appearance.apply_customization_textures(
		active_renderer,
		customization_choices,
		creature_layout_id,
		creature_chr_materials,
		baked_npc_blp
	);

	// apply equipment on top
	await apply_creature_equipment_geosets(core);
	await apply_creature_equipment_textures(core);
	await character_appearance.upload_textures_to_gpu(active_renderer, creature_chr_materials);
	await apply_creature_equipment_models(core);
};

const preview_creature = async (core, creature) => {
	using _lock = core.create_busy_lock();
	core.setToast('progress', `Loading ${creature.name}, please wait...`, null, -1, false);
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
		dispose_creature_equipment();
		active_skins.clear();
		selected_variant_texture_ids.length = 0;
		is_character_model = false;
		core.view.creatureViewerEquipment = [];

		const display_info = await DBCreatures.getDisplayInfo(creature.displayID);

		if (display_info?.extendedDisplayInfoID > 0) {
			// character-model creature
			const extra = await DBCreatureDisplayExtra.get_extra(display_info.extendedDisplayInfoID);
			if (!extra) {
				core.setToast('error', `No extended display info found for creature ${creature.name}.`, null, -1);
				return;
			}

			const chr_model_id = await DBCharacterCustomization.get_chr_model_id(extra.DisplayRaceID, extra.DisplaySexID);
			if (chr_model_id === undefined) {
				core.setToast('error', `No character model found for creature ${creature.name} (race ${extra.DisplayRaceID}, sex ${extra.DisplaySexID}).`, null, -1);
				return;
			}

			const file_data_id = await DBCharacterCustomization.get_model_file_data_id(chr_model_id);
			if (!file_data_id) {
				core.setToast('error', `No model file found for creature ${creature.name}.`, null, -1);
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
			const customization_choices = await DBCreatureDisplayExtra.get_customization_choices(display_info.extendedDisplayInfoID);
			await character_appearance.apply_customization_geosets(geosets, customization_choices);
			active_renderer.updateGeosets();

			// resolve baked NPC texture
			let baked_npc_blp = null;
			const bake_id = extra.HDBakeMaterialResourcesID || extra.BakeMaterialResourcesID;
			if (bake_id > 0) {
				const bake_fdid = await DBCharacterCustomization.get_texture_file_data_id(bake_id);
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
			const layout_id = await DBCharacterCustomization.get_texture_layout_id(chr_model_id);
			await character_appearance.apply_customization_textures(
				active_renderer,
				customization_choices,
				layout_id,
				creature_chr_materials,
				baked_npc_blp
			);
			// load and apply equipment
			equipment_refresh_lock = true;
			creature_extra_info = extra;
			creature_layout_id = layout_id;
			creature_equipment = await build_creature_equipment(display_info.extendedDisplayInfoID, creature);

			if (creature_equipment) {
				const checklist = build_equipment_checklist(creature_equipment);
				creature_equipment._checklist = checklist;
				core.view.creatureViewerEquipment = checklist;

				await apply_creature_equipment_geosets(core);
				await apply_creature_equipment_textures(core);
			}

			await character_appearance.upload_textures_to_gpu(active_renderer, creature_chr_materials);

			if (creature_equipment)
				await apply_creature_equipment_models(core);

			equipment_refresh_lock = false;

			core.view.creatureViewerAnims = modelViewerUtils.extract_animations(active_renderer);
			core.view.creatureViewerAnimSelection = 'none';

			active_file_data_id = file_data_id;
			active_creature = creature;
			is_character_model = true;
		} else {
			// standard creature model
			const file_data_id = await DBCreatures.getFileDataIDByDisplayID(creature.displayID);
			if (!file_data_id) {
				core.setToast('error', `No model data found for creature ${creature.name}.`, null, -1);
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
				const displays = await get_creature_displays(file_data_id);

				const skin_list = [];
				let model_name = listfile.getByID(file_data_id);
				model_name = model_name.substring(model_name.lastIndexOf('/') + 1).replace(/\.?m2$/i, '');

				for (const display of displays) {
					if (display.textures.length === 0)
						continue;

					const texture = display.textures[0];

					let clean_skin_name = '';
					let skin_name = listfile.getByID(texture);
					if (skin_name !== undefined) {
						skin_name = skin_name.substring(skin_name.lastIndexOf('/') + 1).replace(/\.blp$/i, '');
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
			core.setToast('info', `The model ${creature.name} doesn't have any 3D data associated with it.`, null, 4000);
		} else {
			core.hideToast();

			if (core.view.creatureViewerAutoAdjust)
				requestAnimationFrame(() => core.view.creatureViewerContext?.fitCamera?.());
		}
	} catch (e) {
		if (e.name === 'EncryptionError') {
			core.setToast('error', `The model ${creature.name} is encrypted with an unknown key (${e.key}).`, null, -1);
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

		const creature = typeof entry === 'object' ? entry : await DBCreatureList.get_creature_by_id(entry);
		if (!creature)
			continue;

		const file_manifest = [];
		const creature_name = ExportHelper.sanitizeFilename(creature.name);

		const display_info = await DBCreatures.getDisplayInfo(creature.displayID);

		if (display_info?.extendedDisplayInfoID > 0) {
			// character-model creature export
			try {
				const extra = await DBCreatureDisplayExtra.get_extra(display_info.extendedDisplayInfoID);
				if (!extra) {
					helper.mark(creature_name, false, 'No extended display info found');
					continue;
				}

				const chr_model_id = await DBCharacterCustomization.get_chr_model_id(extra.DisplayRaceID, extra.DisplaySexID);
				const file_data_id = chr_model_id !== undefined ? await DBCharacterCustomization.get_model_file_data_id(chr_model_id) : undefined;
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
						const customization_choices = await DBCreatureDisplayExtra.get_customization_choices(display_info.extendedDisplayInfoID);
						const layout_id = await DBCharacterCustomization.get_texture_layout_id(chr_model_id);

						let baked_npc_blp = null;
						const bake_id = extra.HDBakeMaterialResourcesID || extra.BakeMaterialResourcesID;
						if (bake_id > 0) {
							const bake_fdid = await DBCharacterCustomization.get_texture_file_data_id(bake_id);
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

						// apply equipment textures for export
						const export_equipment = await build_creature_equipment(display_info.extendedDisplayInfoID, creature);
						if (export_equipment) {
							const sections = await DBCharacterCustomization.get_texture_sections(layout_id);
							if (sections) {
								const section_by_type = new Map();
								for (const section of sections)
									section_by_type.set(section.SectionType, section);

								const texture_layer_map = await DBCharacterCustomization.get_model_texture_layer_map();
								let base_layer = null;
								const layers_by_section = new Map();

								for (const [key, layer] of texture_layer_map) {
									if (!key.startsWith(layout_id + '-'))
										continue;

									if (layer.TextureSectionTypeBitMask === -1 && layer.TextureType === 1)
										base_layer = layer;
									else if (layer.TextureSectionTypeBitMask !== -1) {
										for (let st = 0; st < 9; st++) {
											if ((1 << st) & layer.TextureSectionTypeBitMask) {
												if (!layers_by_section.has(st))
													layers_by_section.set(st, layer);
											}
										}
									}
								}

								if (base_layer) {
									for (let st = 0; st < 9; st++) {
										if (!layers_by_section.has(st))
											layers_by_section.set(st, base_layer);
									}
								}

								for (const [slot_id, entry] of export_equipment) {
									const item_textures = entry.item_id
										? await DBItemCharTextures.getItemTextures(entry.item_id, creature_extra_info?.DisplayRaceID, creature_extra_info?.DisplaySexID)
										: await DBItemCharTextures.getTexturesByDisplayId(entry.display_id, creature_extra_info?.DisplayRaceID, creature_extra_info?.DisplaySexID);

									if (!item_textures)
										continue;

									for (const texture of item_textures) {
										const section = section_by_type.get(texture.section);
										if (!section)
											continue;

										const layer = layers_by_section.get(texture.section);
										if (!layer)
											continue;

										const chr_model_material = await DBCharacterCustomization.get_model_material(layout_id, layer.TextureType);
										if (!chr_model_material)
											continue;

										let chr_material;
										if (!export_materials.has(chr_model_material.TextureType)) {
											chr_material = new CharMaterialRenderer(chr_model_material.TextureType, chr_model_material.Width, chr_model_material.Height);
											export_materials.set(chr_model_material.TextureType, chr_material);
											await chr_material.init();
										} else {
											chr_material = export_materials.get(chr_model_material.TextureType);
										}

										const slot_layer = get_slot_layer(slot_id);
										const item_material = {
											ChrModelTextureTargetID: (slot_layer * 100) + texture.section,
											FileDataID: texture.fileDataID
										};

										await chr_material.setTextureTarget(item_material, section, chr_model_material, layer, true);
									}
								}
							}
						}

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

		const file_data_id = await DBCreatures.getFileDataIDByDisplayID(creature.displayID);
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

export default {
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
					<template v-if="$core.view.creatureViewerEquipment.length > 0">
						<span class="header">Equipment</span>
						<component :is="$components.Checkboxlist" :items="$core.view.creatureViewerEquipment"></component>
						<div class="list-toggles">
							<a @click="$core.view.setAllCreatureEquipment(true)">Enable All</a> / <a @click="$core.view.setAllCreatureEquipment(false)">Disable All</a>
						</div>
					</template>
					<template v-if="$core.view.creatureViewerGeosets.length > 0">
						<span class="header">Geosets</span>
						<component :is="$components.Checkboxlist" :items="$core.view.creatureViewerGeosets"></component>
						<div class="list-toggles">
							<a @click="$core.view.setAllCreatureGeosets(true)">Enable All</a> / <a @click="$core.view.setAllCreatureGeosets(false)">Disable All</a>
						</div>
					</template>
					<template v-if="$core.view.config.modelsExportTextures && $core.view.creatureViewerSkins.length > 0">
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
			this.$core.showLoadingScreen(8);

			await this.$core.progressLoadingScreen('Loading model file data...');
			await DBModelFileData.initializeModelFileData();

			await this.$core.progressLoadingScreen('Loading creature data...');
			await DBCreatures.initializeCreatureData();

			await this.$core.progressLoadingScreen('Loading character customization data...');
			await DBCharacterCustomization.ensureInitialized();

			await this.$core.progressLoadingScreen('Loading creature display extras...');
			await DBCreatureDisplayExtra.ensureInitialized();

			await this.$core.progressLoadingScreen('Loading NPC equipment data...');
			await DBNpcEquipment.ensureInitialized();

			await this.$core.progressLoadingScreen('Loading item display data...');
			await DBItemModels.ensureInitialized();
			await DBItemGeosets.ensureInitialized();
			await DBItemCharTextures.ensureInitialized();

			await this.$core.progressLoadingScreen('Loading item cache...');
			await DBItems.ensureInitialized();

			await this.$core.progressLoadingScreen('Loading creature list...');
			await DBCreatureList.initialize_creature_list();

			const creatures = await DBCreatureList.get_all_creatures();
			const entries = [];

			for (const [id, creature] of creatures)
				entries.push(`${creature.name} [${id}]`);

			entries.sort((a, b) => {
				const name_a = a.replace(/\s+\[\d+\]$/, '').toLowerCase();
				const name_b = b.replace(/\s+\[\d+\]$/, '').toLowerCase();
				return name_a.localeCompare(name_b);
			});

			this.$core.view.listfileCreatures = entries;

			if (!this.$core.view.creatureViewerContext) {
				this.$core.view.creatureViewerContext = Object.seal({
					getActiveRenderer: () => active_renderer,
					getEquipmentRenderers: () => equipment_model_renderers,
					getCollectionRenderers: () => collection_model_renderers,
					gl_context: null,
					fitCamera: null
				});
			}

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
			platform.clipboard_write_text(names.join('\n'));
		},

		copy_creature_ids(selection) {
			const ids = selection.map(entry => {
				if (typeof entry === 'string') {
					const match = entry.match(/\[(\d+)\]$/);
					return match ? match[1] : '';
				}
				return entry.id?.toString() || '';
			}).filter(id => id);
			platform.clipboard_write_text(ids.join('\n'));
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

			const creature_items = [];
			for (const entry of user_selection) {
				if (typeof entry === 'string') {
					const match = entry.match(/\[(\d+)\]$/);
					if (match) {
						const creature = await DBCreatureList.get_creature_by_id(parseInt(match[1]));
						if (creature)
							creature_items.push(creature);

						continue;
					}
				}

				if (entry)
					creature_items.push(entry);
			}

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
				selected_animation_id
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

			const creature = await DBCreatureList.get_creature_by_id(creature_id);
			if (creature)
				await preview_creature(this.$core, creature);
		});

		this.$core.view.$watch('creatureViewerEquipment', async () => {
			if (equipment_refresh_lock || !active_renderer || !is_character_model || !creature_equipment)
				return;

			await refresh_creature_equipment(this.$core);
		}, { deep: true });

		this.$core.events.on('toggle-uv-layer', (layer_name) => {
			const state = modelViewerUtils.create_view_state(this.$core, 'creature');
			modelViewerUtils.toggle_uv_layer(state, active_renderer, layer_name);
		});
	},

	getActiveRenderer: () => active_renderer
};
