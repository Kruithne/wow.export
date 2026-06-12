const log = require('../log');
const util = require('util');
const path = require('path');
const ExportHelper = require('../casc/export-helper');
const listfile = require('../casc/listfile');
const EncryptionError = require('../casc/blte-reader').EncryptionError;
const InstallType = require('../install-type');
const listboxContext = require('../ui/listbox-context');
const CharMaterialRenderer = require('../3D/renderers/CharMaterialRenderer');

const BLPFile = require('../casc/blp');
const M2RendererGL = require('../3D/renderers/M2RendererGL');
const M2Exporter = require('../3D/exporters/M2Exporter');

const DBModelFileData = require('../db/caches/DBModelFileData');
const DBCreatures = require('../db/caches/DBCreatures');
const DBCreatureList = require('../db/caches/DBCreatureList');
const DBItemDisplays = require('../db/caches/DBItemDisplays');
const wmo_minimap = require('../wmo-minimap');
const DBCharacterCustomization = require('../db/caches/DBCharacterCustomization');
const DBCreatureDisplayExtra = require('../db/caches/DBCreatureDisplayExtra');
const DBNpcEquipment = require('../db/caches/DBNpcEquipment');
const DBItemModels = require('../db/caches/DBItemModels');
const DBItemGeosets = require('../db/caches/DBItemGeosets');
const DBItemCharTextures = require('../db/caches/DBItemCharTextures');
const DBItems = require('../db/caches/DBItems');
const { get_slot_name, get_attachment_ids_for_slot, get_slot_layer, ATTACHMENT_ID } = require('../wow/EquipmentSlots');

const textureRibbon = require('../ui/texture-ribbon');
const textureExporter = require('../ui/texture-exporter');
const modelViewerUtils = require('../ui/model-viewer-utils');
const character_appearance = require('../ui/character-appearance');
const zoneLighting = require('../3D/zone-lighting');

const active_skins = new Map();
let selected_variant_texture_ids = new Array();

let active_renderer;
let active_file_data_id;
let active_creature;
let is_character_model = false;
const creature_chr_materials = new Map();

// model-browsing state (Models mode of the combined tab)
let active_model_path = null;
let selected_skin_name = null;

// equipment state
const equipment_model_renderers = new Map();
const collection_model_renderers = new Map();
let creature_equipment = null;
let creature_extra_info = null;
let creature_layout_id = 0;
let equipment_refresh_lock = false;

// CG constants from DBItemGeosets
const CG = DBItemGeosets.CG;

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

const get_creature_displays = (file_data_id) => {
	return DBCreatures.getCreatureDisplaysByFileDataID(file_data_id) ?? [];
};

/**
 * Pick the default animation for a freshly previewed creature. Auto-plays the
 * Stand (idle) animation when available - matching the character viewer -
 * unless the user disabled auto-play.
 */
const pick_default_animation = (core, anims) => {
	if (!core.view.config.creatureAutoPlayAnim)
		return 'none';

	return anims.some(anim => anim.id === '0.0') ? '0.0' : 'none';
};

/**
 * Build equipment data for a character-model creature.
 * Returns Map<slot_id, { display_id, item_id? }> or null.
 */
const build_creature_equipment = (extra_display_id, creature) => {
	const equipment = new Map();

	// armor from NpcModelItemSlotDisplayInfo (display-ID-based)
	const npc_armor = DBNpcEquipment.get_equipment(extra_display_id);
	if (npc_armor) {
		for (const [slot_id, display_id] of npc_armor)
			equipment.set(slot_id, { display_id });
	}

	// weapons from Creature.AlwaysItem (item-ID-based)
	if (creature.always_items) {
		for (let i = 0; i < creature.always_items.length && i < 2; i++) {
			const item_id = creature.always_items[i];
			const slot_id = i === 0 ? 16 : 17;
			const display_id = DBItemModels.getDisplayId(item_id);
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
const apply_creature_equipment_geosets = (core) => {
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

	const equipment_geosets = DBItemGeosets.calculateEquipmentGeosetsByDisplay(slot_display_map);
	const affected_groups = DBItemGeosets.getAffectedCharGeosetsByDisplay(slot_display_map);

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
		const hide_groups = DBItemGeosets.getHelmetHideGeosetsByDisplayId(
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

	const sections = DBCharacterCustomization.get_texture_sections(creature_layout_id);
	if (!sections)
		return;

	const section_by_type = new Map();
	for (const section of sections)
		section_by_type.set(section.SectionType, section);

	const texture_layer_map = DBCharacterCustomization.get_model_texture_layer_map();
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
			? DBItemCharTextures.getItemTextures(entry.item_id, creature_extra_info?.DisplayRaceID, creature_extra_info?.DisplaySexID, undefined, creature_extra_info?.DisplayClassID)
			: DBItemCharTextures.getTexturesByDisplayId(entry.display_id, creature_extra_info?.DisplayRaceID, creature_extra_info?.DisplaySexID, creature_extra_info?.DisplayClassID);

		if (!item_textures)
			continue;

		for (const texture of item_textures) {
			const section = section_by_type.get(texture.section);
			if (!section)
				continue;

			const layer = layers_by_section.get(texture.section);
			if (!layer)
				continue;

			// item textures overlay the skin; none/blit straight-copy would
			// erase the body where the texture is transparent (e.g. sleeves),
			// so force alpha compositing for those layers
			const item_layer = (layer.BlendMode === 0 || layer.BlendMode === 1) ? { ...layer, BlendMode: 15 } : layer;

			const chr_model_material = DBCharacterCustomization.get_model_material(creature_layout_id, layer.TextureType);
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

			await chr_material.setTextureTarget(item_material, section, chr_model_material, item_layer, true);
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
			? DBItemModels.getItemDisplay(entry.item_id, race_id, gender_index)
			: DBItemModels.getDisplayData(entry.display_id, race_id, gender_index);

		if (!display?.models || display.models.length === 0)
			continue;

		// bows held in left hand
		let attachment_ids = get_attachment_ids_for_slot(slot_id) || [];
		if (slot_id === 16 && entry.item_id && DBItems.isItemBow(entry.item_id))
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
	const display_info = DBCreatures.getDisplayInfo(active_creature.displayID);
	const customization_choices = DBCreatureDisplayExtra.get_customization_choices(display_info.extendedDisplayInfoID);
	character_appearance.apply_customization_geosets(core.view.creatureViewerGeosets, customization_choices);

	// re-apply customization textures (reset materials)
	let baked_npc_blp = null;
	const bake_id = creature_extra_info.HDBakeMaterialResourcesID || creature_extra_info.BakeMaterialResourcesID;
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

	await character_appearance.apply_customization_textures(
		active_renderer,
		customization_choices,
		creature_layout_id,
		creature_chr_materials,
		baked_npc_blp
	);

	// apply equipment on top
	apply_creature_equipment_geosets(core);
	await apply_creature_equipment_textures(core);
	await character_appearance.upload_textures_to_gpu(active_renderer, creature_chr_materials);
	await apply_creature_equipment_models(core);
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
		dispose_creature_equipment();
		active_skins.clear();
		selected_variant_texture_ids.length = 0;
		is_character_model = false;
		core.view.creatureViewerEquipment = [];

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

			// character-model NPCs load facing away from the camera; rotate them
			// to face front like the character viewer, so the fixed light hits the
			// front rather than the back.
			active_renderer.setTransform([0, 0, 0], [0, -Math.PI / 2, 0], [1, 1, 1]);

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
			// load and apply equipment
			equipment_refresh_lock = true;
			creature_extra_info = extra;
			creature_layout_id = layout_id;
			creature_equipment = build_creature_equipment(display_info.extendedDisplayInfoID, creature);

			if (creature_equipment) {
				const checklist = build_equipment_checklist(creature_equipment);
				creature_equipment._checklist = checklist;
				core.view.creatureViewerEquipment = checklist;

				apply_creature_equipment_geosets(core);
				await apply_creature_equipment_textures(core);
			}

			await character_appearance.upload_textures_to_gpu(active_renderer, creature_chr_materials);

			if (creature_equipment)
				await apply_creature_equipment_models(core);

			equipment_refresh_lock = false;

			core.view.creatureViewerAnims = modelViewerUtils.extract_animations(active_renderer);
			core.view.creatureViewerAnimSelection = pick_default_animation(core, core.view.creatureViewerAnims);

			active_file_data_id = file_data_id;
			active_creature = creature;
			core.view.creatureViewerTitle = creature.name;
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
				core.view.creatureViewerAnimSelection = pick_default_animation(core, core.view.creatureViewerAnims);
			}

			active_file_data_id = file_data_id;
			active_creature = creature;
			core.view.creatureViewerTitle = creature.name;
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

						if (active_renderer && core.view.config.modelsExportApplyPose && (format === 'OBJ' || format === 'STL')) {
							const baked = active_renderer.getBakedGeometry();
							if (baked)
								exporter.setPosedGeometry(baked.vertices, baked.normals);
						}
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

						// apply equipment textures for export
						const export_equipment = build_creature_equipment(display_info.extendedDisplayInfoID, creature);
						if (export_equipment) {
							const sections = DBCharacterCustomization.get_texture_sections(layout_id);
							if (sections) {
								const section_by_type = new Map();
								for (const section of sections)
									section_by_type.set(section.SectionType, section);

								const texture_layer_map = DBCharacterCustomization.get_model_texture_layer_map();
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
										? DBItemCharTextures.getItemTextures(entry.item_id, creature_extra_info?.DisplayRaceID, creature_extra_info?.DisplaySexID, undefined, creature_extra_info?.DisplayClassID)
										: DBItemCharTextures.getTexturesByDisplayId(entry.display_id, creature_extra_info?.DisplayRaceID, creature_extra_info?.DisplaySexID, creature_extra_info?.DisplayClassID);

									if (!item_textures)
										continue;

									for (const texture of item_textures) {
										const section = section_by_type.get(texture.section);
										if (!section)
											continue;

										const layer = layers_by_section.get(texture.section);
										if (!layer)
											continue;

										// item textures overlay the skin; none/blit straight-copy would
										// erase the body where the texture is transparent (e.g. sleeves),
										// so force alpha compositing for those layers
										const item_layer = (layer.BlendMode === 0 || layer.BlendMode === 1) ? { ...layer, BlendMode: 15 } : layer;

										const chr_model_material = DBCharacterCustomization.get_model_material(layout_id, layer.TextureType);
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

										await chr_material.setTextureTarget(item_material, section, chr_model_material, item_layer, true);
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
				active_renderer: is_active ? active_renderer : null,
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

//region model browsing (Models mode)

const get_model_displays = (file_data_id) => {
	let displays = DBCreatures.getCreatureDisplaysByFileDataID(file_data_id);
	if (displays === undefined)
		displays = DBItemDisplays.getItemDisplaysByFileDataID(file_data_id);

	return displays ?? [];
};

const get_variant_texture_ids = (file_name) => {
	if (file_name === active_model_path)
		return selected_variant_texture_ids;

	const file_data_id = listfile.getByFilename(file_name);
	const displays = get_model_displays(file_data_id);
	return displays.find(e => e.textures.length > 0)?.textures ?? [];
};

/**
 * Preview a model file. Mirrors the standalone Models tab, but drives the
 * shared creature viewer state/context so the combined tab needs only one 3D
 * viewer.
 */
const preview_model_file = async (core, file_name) => {
	using _lock = core.create_busy_lock();
	core.setToast('progress', util.format('Loading %s, please wait...', file_name), null, -1, false);
	log.write('Previewing model %s', file_name);

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
		selected_skin_name = null;
		is_character_model = false;
		core.view.creatureViewerEquipment = [];

		const file_data_id = listfile.getByFilename(file_name);
		const file = await core.view.casc.getFile(file_data_id);
		const gl_context = core.view.creatureViewerContext?.gl_context;

		const model_type = modelViewerUtils.detect_model_type_by_name(file_name) ?? modelViewerUtils.detect_model_type(file);

		if (model_type === modelViewerUtils.MODEL_TYPE_M2)
			core.view.creatureViewerActiveType = 'm2';
		else if (model_type === modelViewerUtils.MODEL_TYPE_M3)
			core.view.creatureViewerActiveType = 'm3';
		else
			core.view.creatureViewerActiveType = 'wmo';

		active_renderer = modelViewerUtils.create_renderer(file, model_type, gl_context, core.view.config.modelViewerShowTextures, file_name);

		if (model_type === modelViewerUtils.MODEL_TYPE_M2)
			active_renderer.geosetKey = 'creatureViewerGeosets';
		else if (model_type === modelViewerUtils.MODEL_TYPE_WMO) {
			active_renderer.wmoGroupKey = 'creatureViewerWMOGroups';
			active_renderer.wmoSetKey = 'creatureViewerWMOSets';
		}

		await active_renderer.load();

		core.view.modelViewerWMOHasMinimap = false;
		if (model_type === modelViewerUtils.MODEL_TYPE_WMO && active_renderer.wmo?.wmoID) {
			await wmo_minimap.load_minimap_textures();
			core.view.modelViewerWMOHasMinimap = wmo_minimap.has_minimap(active_renderer.wmo.wmoID);
		}

		if (model_type === modelViewerUtils.MODEL_TYPE_M2) {
			const displays = get_model_displays(file_data_id);

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
			core.view.creatureViewerSkinsSelection = skin_list.slice(0, 1);

			core.view.creatureViewerAnims = modelViewerUtils.extract_animations(active_renderer);
			core.view.creatureViewerAnimSelection = pick_default_animation(core, core.view.creatureViewerAnims);
		}

		active_model_path = file_name;
		core.view.creatureViewerTitle = file_name;

		const has_content = active_renderer.draw_calls?.length > 0 || active_renderer.groups?.length > 0;
		if (!has_content) {
			core.setToast('info', util.format('The model %s doesn\'t have any 3D data associated with it.', file_name), null, 4000);
		} else {
			core.hideToast();
			if (core.view.creatureViewerAutoAdjust)
				requestAnimationFrame(() => core.view.creatureViewerContext?.fitCamera?.());
		}
	} catch (e) {
		if (e instanceof EncryptionError) {
			core.setToast('error', util.format('The model %s is encrypted with an unknown key (%s).', file_name, e.key), null, -1);
			log.write('Failed to decrypt model %s (%s)', file_name, e.key);
		} else {
			core.setToast('error', 'Unable to preview model ' + file_name, { 'View Log': () => log.openRuntimeLog() }, -1);
			log.write('Failed to open CASC file: %s', e.message);
		}
	}
};

const export_model_files = async (core, files, is_local = false) => {
	const export_paths = core.openLastExportStream();
	const format = core.view.config.exportModelFormat;

	if (format === 'PNG' || format === 'CLIPBOARD') {
		if (active_model_path) {
			const canvas = document.getElementById('creature-preview').querySelector('canvas');
			await modelViewerUtils.export_preview(core, format, canvas, active_model_path);
		} else {
			core.setToast('error', 'The selected export option only works for model previews. Preview something first!', null, -1);
		}

		export_paths?.close();
		return;
	}

	const casc = core.view.casc;
	const helper = new ExportHelper(files.length, 'model');
	helper.start();

	for (const file_entry of files) {
		if (helper.isCancelled())
			break;

		let file_name;
		let file_data_id;

		if (typeof file_entry === 'number') {
			file_data_id = file_entry;
			file_name = listfile.getByID(file_data_id);
		} else {
			file_name = listfile.stripFileEntry(file_entry);
			file_data_id = listfile.getByFilename(file_name);
		}

		const file_manifest = [];

		try {
			const data = await (is_local ? require('../buffer').readFile(file_name) : casc.getFile(file_data_id));

			if (file_name === undefined) {
				const model_type = modelViewerUtils.detect_model_type(data);
				file_name = listfile.formatUnknownFile(file_data_id, modelViewerUtils.get_model_extension(model_type));
			}

			let export_path;
			let mark_file_name = file_name;

			const is_active = file_name === active_model_path;
			const model_type = modelViewerUtils.detect_model_type_by_name(file_name) ?? modelViewerUtils.detect_model_type(data);

			if (is_local) {
				export_path = file_name;
			} else if (model_type === modelViewerUtils.MODEL_TYPE_M2 && selected_skin_name !== null && is_active && format !== 'RAW') {
				const base_file_name = path.basename(file_name, path.extname(file_name));
				let skinned_name;

				if (selected_skin_name.startsWith(base_file_name))
					skinned_name = ExportHelper.replaceBaseName(file_name, selected_skin_name);
				else
					skinned_name = ExportHelper.replaceBaseName(file_name, base_file_name + '_' + selected_skin_name);

				export_path = ExportHelper.getExportPath(skinned_name);
				mark_file_name = skinned_name;
			} else {
				export_path = ExportHelper.getExportPath(file_name);
			}

			const mark_name = await modelViewerUtils.export_model({
				core,
				data,
				file_data_id,
				file_name,
				format,
				export_path,
				helper,
				file_manifest,
				variant_textures: get_variant_texture_ids(file_name),
				geoset_mask: is_active ? core.view.creatureViewerGeosets : null,
				wmo_group_mask: is_active ? core.view.creatureViewerWMOGroups : null,
				wmo_set_mask: is_active ? core.view.creatureViewerWMOSets : null,
				active_renderer: is_active ? active_renderer : null,
				export_paths
			});

			helper.mark(mark_name, true);
		} catch (e) {
			helper.mark(file_name, false, e.message, e.stack);
		}
	}

	helper.finish();
	export_paths?.close();
};

//endregion

module.exports = {
	register() {
		this.registerNavButton('Models', 'cube.svg', InstallType.CASC);
	},

	template: `
		<div class="tab list-tab" id="tab-creatures">
			<ul class="ui-multi-button browse-mode-switch">
					<li :class="{ selected: browse_mode === 'models' }" @click.stop="browse_mode = 'models'">Models</li>
					<li :class="{ selected: browse_mode === 'creatures' }" @click.stop="browse_mode = 'creatures'">Creatures</li>
				</ul>
				<div class="list-container">
				<component v-if="browse_mode === 'models'" :is="$components.Listbox" v-model:selection="$core.view.selectionModels" v-model:filter="$core.view.userInputFilterModels" :items="models_list" :override="$core.view.overrideModelList" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="model" persistscrollkey="models" :quickfilters="$core.view.modelQuickFilters" @contextmenu="handle_listbox_context"></component>
					<component v-if="browse_mode === 'creatures'" :is="$components.Listbox" v-model:selection="$core.view.selectionCreatures" v-model:filter="$core.view.userInputFilterCreatures" :items="$core.view.listfileCreatures" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="creature" persistscrollkey="creatures" @contextmenu="handle_listbox_context"></component>
				<component v-if="browse_mode === 'models'" :is="$components.ContextMenu" :node="$core.view.contextMenus.nodeListbox" v-slot:default="context" @close="$core.view.contextMenus.nodeListbox = null">
						<span @click.self="copy_file_paths(context.node.selection)">Copy file path{{ context.node.count > 1 ? 's' : '' }}</span>
						<span @click.self="copy_export_paths(context.node.selection)">Copy export path{{ context.node.count > 1 ? 's' : '' }}</span>
						<span @click.self="open_export_directory(context.node.selection)">Open export directory</span>
					</component>
					<component v-if="browse_mode === 'creatures'" :is="$components.ContextMenu" :node="$core.view.contextMenus.nodeListbox" v-slot:default="context" @close="$core.view.contextMenus.nodeListbox = null">
					<span @click.self="copy_creature_names(context.node.selection)">Copy name{{ context.node.count > 1 ? 's' : '' }}</span>
					<span @click.self="copy_creature_ids(context.node.selection)">Copy ID{{ context.node.count > 1 ? 's' : '' }}</span>
				</component>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
				<input v-if="browse_mode === 'models'" type="text" v-model="$core.view.userInputFilterModels" placeholder="Filter models..."/>
					<input v-else type="text" v-model="$core.view.userInputFilterCreatures" placeholder="Filter creatures..."/>
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
					<div v-if="viewer_title && $core.view.creatureViewerActiveType !== 'none' && !$core.view.creatureTexturePreviewURL" class="viewer-title" :title="$core.view.creatureViewerTitle">{{ viewer_title }}</div>
					<div v-if="$core.view.creatureViewerActiveType === 'none' && !$core.view.creatureTexturePreviewURL" class="viewer-empty">Select a {{ browse_mode === 'models' ? 'model' : 'creature' }} to preview</div>
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
				<input v-if="browse_mode === 'models' && $core.view.modelViewerWMOHasMinimap" type="button" value="Export WMO Minimap" :class="{ disabled: $core.view.isBusy }" @click="export_wmo_minimap"/>
				<component v-if="browse_mode === 'models'" :is="$components.MenuButton" :options="$core.view.menuButtonModels" :default="$core.view.config.exportModelFormat" @change="$core.view.config.exportModelFormat = $event" class="upward" :disabled="$core.view.isBusy" @click="export_selected_models"></component>
				<component v-else :is="$components.MenuButton" :options="$core.view.menuButtonCreatures" :default="$core.view.config.exportCreatureFormat" @change="$core.view.config.exportCreatureFormat = $event" class="upward" :disabled="$core.view.isBusy" @click="export_creatures"></component>
			</div>
			<div id="creature-sidebar" class="sidebar">
				<ul class="ui-multi-button sidebar-tabs">
					<li :class="{ selected: sidebar_tab === 'preview' }" @click.stop="sidebar_tab = 'preview'">Preview</li>
					<li :class="{ selected: sidebar_tab === 'model' }" @click.stop="sidebar_tab = 'model'">Model</li>
					<li :class="{ selected: sidebar_tab === 'export' }" @click.stop="sidebar_tab = 'export'">Export</li>
				</ul>
				<div v-show="sidebar_tab === 'preview'">
					<span class="header">Automation</span>
					<label class="ui-checkbox" title="Automatically preview a creature when selecting it">
						<input type="checkbox" v-model="$core.view.config.creatureAutoPreview"/>
						<span>Auto Preview</span>
					</label>
					<label class="ui-checkbox" title="Automatically adjust camera when selecting a new creature">
						<input type="checkbox" v-model="$core.view.creatureViewerAutoAdjust"/>
						<span>Auto Camera</span>
					</label>
					<label class="ui-checkbox" title="Automatically play the idle animation when previewing a creature">
						<input type="checkbox" v-model="$core.view.config.creatureAutoPlayAnim"/>
						<span>Auto Play Animation</span>
					</label>
					<span class="header">Display</span>
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
					<span class="header">Scene</span>
					<label class="ui-checkbox" title="Show a background color in the 3D viewport">
						<input type="checkbox" v-model="$core.view.config.modelViewerShowBackground"/>
						<span>Show Background</span>
					</label>
					<label class="ui-checkbox" title="Render a soft shadow beneath the model">
						<input type="checkbox" v-model="$core.view.config.modelViewerShowShadow"/>
						<span>Render Shadow</span>
					</label>
					<label class="ui-checkbox" title="Use a free orbit camera (off = locked, upright camera that rotates the model)">
						<input type="checkbox" v-model="$core.view.config.modelViewerUse3DCamera"/>
						<span>Use 3D Camera</span>
					</label>
					<span class="header">Lighting</span>
					<label v-if="false" class="ui-checkbox" title="Light the model using a zone's real in-game lighting (LightData)">
						<input type="checkbox" v-model="$core.view.config.zoneLightEnabled"/>
						<span>In-game zone lighting</span>
					</label>
					<template v-if="false && $core.view.config.zoneLightEnabled">
						<label class="ui-select-label">
							<span class="select-prefix"><span class="prefix-label">Zone:</span></span>
							<select class="ui-select" v-model.number="$core.view.config.zoneLightMapId">
								<option v-for="m in $core.view.zoneLightMaps" :key="m.id" :value="m.id">{{ m.label }}</option>
							</select>
						</label>
						<div class="zone-light-time">
							<span class="prefix-label">Time of day: {{ format_zone_time($core.view.config.zoneLightTime) }}</span>
							<input type="range" min="0" max="2880" step="15" v-model.number="$core.view.config.zoneLightTime" style="width:100%"/>
						</div>
					</template>
					<label class="ui-checkbox" title="Use an adjustable light you can move and tune" :class="{ disabled: $core.view.config.zoneLightEnabled }">
						<input type="checkbox" v-model="$core.view.config.modelViewerCustomLight" :disabled="$core.view.config.zoneLightEnabled"/>
						<span>Adjustable light</span>
					</label>
					<template v-if="$core.view.config.modelViewerCustomLight && !$core.view.config.zoneLightEnabled">
						<div class="light-gizmo-wrap">
							<span class="prefix-label">Light direction</span>
							<div class="light-gizmo" @mousedown="start_light_drag" title="Drag to aim the light">
								<div class="light-gizmo-dot" :style="light_dot_style"></div>
							</div>
							<span class="light-gizmo-readout">H {{ $core.view.config.modelViewerLightAzimuth }}&deg; &middot; V {{ $core.view.config.modelViewerLightElevation }}&deg;</span>
						</div>
						<div class="light-control">
							<span class="prefix-label">Intensity: {{ light_value_label($core.view.config.modelViewerLightIntensity) }}</span>
							<input type="range" min="0" max="2" step="0.05" v-model.number="$core.view.config.modelViewerLightIntensity"/>
						</div>
						<div class="light-control">
							<span class="prefix-label">Ambient: {{ light_value_label($core.view.config.modelViewerLightAmbient) }}</span>
							<input type="range" min="0" max="1" step="0.05" v-model.number="$core.view.config.modelViewerLightAmbient"/>
						</div>
						<input type="button" value="Reset Light" class="light-reset-btn" @click="reset_custom_light"/>
					</template>
				</div>
				<div v-show="sidebar_tab === 'model'">
					<span v-if="$core.view.creatureViewerActiveType !== 'm2' && $core.view.creatureViewerActiveType !== 'wmo'" class="sidebar-hint">Preview a model or creature to see its geosets, skins and groups.</span>
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
				<div v-show="sidebar_tab === 'export'">
					<span class="header">Export</span>
					<label class="ui-checkbox" title="Include textures when exporting models">
						<input type="checkbox" v-model="$core.view.config.modelsExportTextures"/>
						<span>Textures</span>
					</label>
					<label v-if="$core.view.config.modelsExportTextures" class="ui-checkbox" title="Include alpha channel in exported model textures">
						<input type="checkbox" v-model="$core.view.config.modelsExportAlpha"/>
						<span>Texture Alpha</span>
					</label>
					<label v-if="export_format === 'GLTF' && $core.view.creatureViewerActiveType === 'm2'" class="ui-checkbox" title="Include animations in export">
						<input type="checkbox" v-model="$core.view.config.modelsExportAnimations"/>
						<span>Export animations</span>
					</label>
					<label v-if="(export_format === 'OBJ' || export_format === 'STL') && $core.view.creatureViewerActiveType === 'm2'" class="ui-checkbox" title="Apply current animation pose to exported geometry">
						<input type="checkbox" v-model="$core.view.config.modelsExportApplyPose"/>
						<span>Apply pose</span>
					</label>
					<template v-if="browse_mode === 'models' && export_format === 'RAW'">
						<label class="ui-checkbox" title="Export raw .skin files with M2 exports"><input type="checkbox" v-model="$core.view.config.modelsExportSkin"/><span>M2 .skin Files</span></label>
						<label class="ui-checkbox" title="Export raw .skel files with M2 exports"><input type="checkbox" v-model="$core.view.config.modelsExportSkel"/><span>M2 .skel Files</span></label>
						<label class="ui-checkbox" title="Export raw .bone files with M2 exports"><input type="checkbox" v-model="$core.view.config.modelsExportBone"/><span>M2 .bone Files</span></label>
						<label class="ui-checkbox" title="Export raw .anim files with M2 exports"><input type="checkbox" v-model="$core.view.config.modelsExportAnim"/><span>M2 .anim files</span></label>
						<label class="ui-checkbox" title="Export WMO group files"><input type="checkbox" v-model="$core.view.config.modelsExportWMOGroups"/><span>WMO Groups</span></label>
					</template>
					<label v-if="browse_mode === 'models' && export_format === 'OBJ' && $core.view.creatureViewerActiveType === 'wmo'" class="ui-checkbox" title="Export each WMO group as a separate OBJ file">
						<input type="checkbox" v-model="$core.view.config.modelsExportSplitWMOGroups"/>
						<span>Split WMO Groups</span>
					</label>
				</div>
			</div>
		</div>
	`,

	data() {
		return {
			sidebar_tab: 'preview',
			browse_mode: 'models'
		};
	},

	created() {
		// restore the last-used Models/Creatures mode
		const mode = this.$core.view.config.lastBrowseMode;
		if (mode === 'models' || mode === 'creatures')
			this.browse_mode = mode;
	},

	computed: {
		export_format() {
			return this.browse_mode === 'models'
				? this.$core.view.config.exportModelFormat
				: this.$core.view.config.exportCreatureFormat;
		},

		// Always present the model list alphabetically (A-Z). The underlying
		// listfileModels can be in file-ID order depending on listfile mode /
		// settings, which clusters low-ID vanilla files (world/wmo) at the top.
		models_list() {
			const list = this.$core.view.listfileModels;
			if (!Array.isArray(list))
				return list;

			return [...list].sort();
		},

		// Friendly label for the previewed subject (model basename or creature name).
		viewer_title() {
			const t = this.$core.view.creatureViewerTitle;
			if (!t)
				return '';

			if (this.browse_mode === 'models')
				return t.replace(/\s*\[\d+\]\s*$/, '').split(/[\\/]/).pop();

			return t;
		},

		// Position of the light gizmo dot (horizontal = azimuth, vertical =
		// elevation; top of pad = light from above).
		light_dot_style() {
			const az = this.$core.view.config.modelViewerLightAzimuth ?? 45;
			const el = this.$core.view.config.modelViewerLightElevation ?? 35;
			return {
				left: ((az / 360) * 100) + '%',
				top: (((90 - el) / 180) * 100) + '%'
			};
		}
	},

	methods: {
		async initialize() {
			this.$core.showLoadingScreen(8);

			await this.$core.progressLoadingScreen('Loading model file data...');
			await DBModelFileData.initializeModelFileData();

			await this.$core.progressLoadingScreen('Loading creature data...');
			await DBCreatures.initializeCreatureData();

			if (this.$core.view.config.enableUnknownFiles) {
				await this.$core.progressLoadingScreen('Loading unknown models...');
				await listfile.loadUnknownModels();
			}

			await this.$core.progressLoadingScreen('Loading item displays...');
			await DBItemDisplays.initializeItemDisplays();

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

			if (!this.$core.view.creatureViewerContext) {
				this.$core.view.creatureViewerContext = Object.seal({
					getActiveRenderer: () => active_renderer,
					getEquipmentRenderers: () => equipment_model_renderers,
					getCollectionRenderers: () => collection_model_renderers,
					gl_context: null,
					fitCamera: null
				});
			}

			// populate the zone lighting map picker (shared with characters tab)
			zoneLighting.load_map_picker(this.$core);

			this.$core.hideLoadingScreen();
		},

		handle_listbox_context(data) {
			listboxContext.handle_context_menu(data);
		},

		// --- Models mode ---
		copy_file_paths(selection) { listboxContext.copy_file_paths(selection); },
		copy_file_data_ids(selection) { listboxContext.copy_file_data_ids(selection); },
		copy_export_paths(selection) { listboxContext.copy_export_paths(selection); },
		open_export_directory(selection) { listboxContext.open_export_directory(selection); },

		async export_selected_models() {
			const user_selection = this.$core.view.selectionModels;
			if (user_selection.length === 0) {
				this.$core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
				return;
			}

			await export_model_files(this.$core, user_selection, false);
		},

		async export_wmo_minimap() {
			if (!active_renderer?.wmo?.wmoID)
				return;

			const wmo = active_renderer.wmo;
			const helper = new ExportHelper(1, 'minimap');
			helper.start();

			try {
				await wmo_minimap.load_minimap_textures();

				const layout = wmo_minimap.compute_minimap_layout(wmo.wmoID, wmo.groupInfo);
				if (!layout)
					throw new Error('no minimap textures found for this WMO.');

				const wmo_name = active_model_path || ('unknown_' + wmo.wmoID + '.wmo');
				const base_name = path.basename(wmo_name, path.extname(wmo_name));
				const relative_path = path.join(path.dirname(wmo_name), base_name + '_minimap.png');
				const out_path = ExportHelper.getExportPath(relative_path);

				await wmo_minimap.export_minimap(layout, this.$core.view.casc, out_path, helper);
				if (helper.isCancelled())
					return;

				const export_paths = this.$core.openLastExportStream();
				await export_paths?.writeLine('png:' + out_path);
				export_paths?.close();

				helper.mark(relative_path, true);
			} catch (e) {
				helper.mark('WMO minimap', false, e.message, e.stack);
			}

			helper.finish();
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

		light_value_label(value) {
			return Number(value ?? 0).toFixed(2);
		},

		reset_custom_light() {
			const cfg = this.$core.view.config;
			cfg.modelViewerLightAzimuth = 45;
			cfg.modelViewerLightElevation = 35;
			cfg.modelViewerLightIntensity = 0.8;
			cfg.modelViewerLightAmbient = 0.45;
		},

		// Drag the light gizmo to set azimuth (x) and elevation (y) at once.
		start_light_drag(event) {
			const pad = event.currentTarget;
			const cfg = this.$core.view.config;

			const update = (e) => {
				const rect = pad.getBoundingClientRect();
				const fx = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
				const fy = Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1);
				cfg.modelViewerLightAzimuth = Math.round(fx * 360);
				cfg.modelViewerLightElevation = Math.round(90 - fy * 180);
			};

			update(event);

			const move = (e) => update(e);
			const up = () => {
				document.removeEventListener('mousemove', move);
				document.removeEventListener('mouseup', up);
			};

			document.addEventListener('mousemove', move);
			document.addEventListener('mouseup', up);
			event.preventDefault();
		},

		// Format a zone-lighting time value (0-2880 half-minutes) as HH:MM.
		format_zone_time(value) {
			const total_minutes = Math.round((value | 0) / 2);
			const h = Math.floor(total_minutes / 60) % 24;
			const m = total_minutes % 60;
			return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
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
			if (this.browse_mode !== 'creatures' || !this.$core.view.config.creatureAutoPreview)
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

		this.$core.view.$watch('creatureViewerEquipment', async () => {
			if (equipment_refresh_lock || !active_renderer || !is_character_model || !creature_equipment)
				return;

			await refresh_creature_equipment(this.$core);
		}, { deep: true });

		this.$core.view.$watch('selectionModels', async selection => {
			if (this.browse_mode !== 'models' || !this._tab_initialized)
				return;

			if (!this.$core.view.config.modelsAutoPreview)
				return;

			// filtering can transiently clear the selection (the listbox emits an
			// empty selection when the active item scrolls out of the filtered set)
			if (!Array.isArray(selection) || selection.length === 0 || selection[0] === undefined)
				return;

			const first = listfile.stripFileEntry(selection[0]);
			if (!this.$core.view.isBusy && first && active_model_path !== first)
				preview_model_file(this.$core, first);
		});

		// deep-links from the Items / Map tabs populate overrideModelList; jump to
		// Models mode so the user sees the override list immediately.
		this.$core.view.$watch('overrideModelList', list => {
			if (Array.isArray(list) && list.length > 0)
				this.browse_mode = 'models';
		});

		// remember the selected mode across sessions
		this.$watch('browse_mode', mode => {
			this.$core.view.config.lastBrowseMode = mode;
		});

		this.$core.events.on('toggle-uv-layer', (layer_name) => {
			const state = modelViewerUtils.create_view_state(this.$core, 'creature');
			modelViewerUtils.toggle_uv_layer(state, active_renderer, layer_name);
		});
	},

	getActiveRenderer: () => active_renderer
};
