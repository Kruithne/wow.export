/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const CharMaterialRenderer = require('../3D/renderers/CharMaterialRenderer');
const log = require('../log');
const DBCharacterCustomization = require('../db/caches/DBCharacterCustomization');

// m2 texture types built from the composited character skin; every other
// replaceable type binds its raw source texture directly (matches
// wowmodelviewer/webwowviewer, which only composite the body skin)
const SKIN_TEXTURE_TYPE = 1;
const SKIN_EXTRA_TEXTURE_TYPE = 8;

/**
 * Reset geosets to model defaults, then apply customization choice geosets.
 * Does NOT apply equipment geosets — caller handles that.
 * @param {Array} geosets - geoset checkbox array from view state
 * @param {Array} active_choices - array of { optionID, choiceID }
 */
function apply_customization_geosets(geosets, active_choices) {
	if (!geosets || geosets.length === 0)
		return;

	// reset geosets to model defaults
	for (const geoset of geosets) {
		const id_str = geoset.id.toString();
		const is_default = (geoset.id === 0 || id_str.endsWith('01') || id_str.startsWith('32'));
		const is_hidden_default = id_str.startsWith('17') || id_str.startsWith('35');

		geoset.checked = is_default && !is_hidden_default;
	}

	// apply customization geosets
	for (const active_choice of active_choices) {
		const available_choices = DBCharacterCustomization.get_choices_for_option(active_choice.optionID);
		if (!available_choices)
			continue;

		const active_geosets = DBCharacterCustomization.get_choice_geoset_id(active_choice.choiceID) || [];
		log.write('DEBUG choice option %d choice %d geosets %s',
			active_choice.optionID, active_choice.choiceID, active_geosets.join(','));

		// dump the raw rows for a choice that carries no geoset, so the column that
		// actually drives the model becomes visible
		if (active_geosets.length === 0) {
			log.write('DEBUG option %d choices: %s', active_choice.optionID,
				available_choices.map(choice => choice.id + ':' + choice.label).join(', '));

			log.write('DEBUG active choice option %d choice %d rows: %s', active_choice.optionID,
				active_choice.choiceID, JSON.stringify(DBCharacterCustomization.get_choice_elements(active_choice.choiceID) || []));
		}

		for (const available_choice of available_choices) {
			const chr_cust_geo_ids = DBCharacterCustomization.get_choice_geoset_raw(available_choice.id) || [];
			const should_be_checked = available_choice.id === active_choice.choiceID;

			for (const chr_cust_geo_id of chr_cust_geo_ids) {
				const geoset_id = DBCharacterCustomization.get_geoset_value(chr_cust_geo_id);
				if (geoset_id === undefined)
					continue;

				for (const geoset of geosets) {
					if (geoset.id === 0)
						continue;

					if (geoset.id === geoset_id)
						geoset.checked = should_be_checked;
				}
			}
		}
	}

	log.write('DEBUG geosets after customization: %s',
		geosets.filter(geoset => geoset.checked).map(geoset => geoset.id).join(','));

	log.write('DEBUG model geosets: %s',
		geosets.map(geoset => geoset.id + ':' + (geoset.label || '')).join(','));
}

/**
 * Reset materials, apply baked NPC texture + customization textures, upload to GPU.
 * Does NOT apply equipment textures — caller handles that.
 * @param {object} renderer - M2 renderer instance
 * @param {Array} active_choices - array of { optionID, choiceID }
 * @param {number} layout_id - CharComponentTextureLayoutID
 * @param {Map} chr_materials - Map of texture_type -> CharMaterialRenderer (mutated)
 * @param {object|null} baked_npc_blp - pre-loaded BLP object for baked NPC texture, or null
 * @returns {number|null} baked_npc_texture_type - the texture type used for baked NPC texture, or null
 */
async function apply_customization_textures(renderer, active_choices, layout_id, chr_materials, baked_npc_blp = null) {
	// reset all existing materials
	for (const chr_material of chr_materials.values()) {
		await chr_material.reset();
		await chr_material.update();
	}

	let baked_npc_texture_type = null;

	// apply baked NPC texture
	if (baked_npc_blp) {
		const model_material_map = DBCharacterCustomization.get_model_material_map();
		const available_types = [];
		for (const [key, value] of model_material_map.entries()) {
			if (key.startsWith(layout_id + '-'))
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
				baked_npc_blp
			);

			baked_npc_texture_type = texture_type;
		}
	}

	// apply customization textures
	for (const active_choice of active_choices) {
		const chr_cust_mat_ids = DBCharacterCustomization.get_choice_materials(active_choice.choiceID);
		if (chr_cust_mat_ids === undefined)
			continue;

		for (const chr_cust_mat_id of chr_cust_mat_ids) {
			if (chr_cust_mat_id.RelatedChrCustomizationChoiceID != 0) {
				const has_related_choice = active_choices.find((selected_choice) => selected_choice.choiceID === chr_cust_mat_id.RelatedChrCustomizationChoiceID);
				if (!has_related_choice)
					continue;
			}

			const chr_cust_mat = DBCharacterCustomization.get_chr_cust_material(chr_cust_mat_id.ChrCustomizationMaterialID);
			const chr_model_texture_target = chr_cust_mat.ChrModelTextureTargetID;

			const chr_model_texture_layer = DBCharacterCustomization.get_model_texture_layer(layout_id, chr_model_texture_target);
			if (chr_model_texture_layer === undefined)
				continue;

			const chr_model_material = DBCharacterCustomization.get_model_material(layout_id, chr_model_texture_layer.TextureType);
			if (chr_model_material === undefined)
				continue;

			// skip if baked NPC texture covers this texture type
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
				const char_component_texture_section_results = DBCharacterCustomization.get_texture_sections(layout_id);
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

	return baked_npc_texture_type;
}

/**
 * Upload all chr_materials to the GPU via the renderer.
 * @param {object} renderer - M2 renderer instance
 * @param {Map} chr_materials - Map of texture_type -> CharMaterialRenderer
 */
async function upload_textures_to_gpu(renderer, chr_materials) {
	for (const [chr_model_texture_target, chr_material] of chr_materials) {
		await chr_material.update();
		const pixels = chr_material.getRawPixels();
		await renderer.overrideTextureTypeWithPixels(
			chr_model_texture_target,
			chr_material.glCanvas.width,
			chr_material.glCanvas.height,
			pixels
		);
	}
}

/**
 * Dispose all CharMaterialRenderer instances in a map.
 * @param {Map} chr_materials - Map of texture_type -> CharMaterialRenderer
 */
function dispose_materials(chr_materials) {
	for (const chr_material of chr_materials.values())
		chr_material.dispose();

	chr_materials.clear();
}

/**
 * Resolve the texture section/layer mapping needed when compositing equipment
 * textures into a character's skin atlas.
 * Sections are not limited to the 0-8 body parts: modern layouts also define
 * cape (13), tattoo and tabard regions, and those must resolve to a layer too,
 * otherwise e.g. cloaks end up equipped without their texture.
 * @param {number} layout_id - CharComponentTextureLayoutID
 * @returns {{section_by_type: Map, layers_by_section: Map}|null}
 */
function get_equipment_texture_layers(layout_id) {
	const sections = DBCharacterCustomization.get_texture_sections(layout_id);
	if (!sections)
		return null;

	const section_by_type = new Map();
	for (const section of sections)
		section_by_type.set(section.SectionType, section);

	const layers_by_section = new Map();
	let base_layer = null;

	for (const [key, layer] of DBCharacterCustomization.get_model_texture_layer_map()) {
		// Layer keys are "<layoutID>-<targetID>", so compare the layout part as a
		// number - a string prefix would also match other layouts (1 vs 10, 11...).
		if (Number(key.split('-')[0]) !== layout_id)
			continue;

		if (layer.TextureSectionTypeBitMask === -1) {
			// Full-atlas layer, used as fallback for sections without their own layer.
			if (layer.TextureType === 1 && base_layer === null)
				base_layer = layer;

			continue;
		}

		// Match every section this layer covers, whatever the section type is.
		for (const section of sections) {
			const section_type = section.SectionType;
			if ((1 << section_type) & layer.TextureSectionTypeBitMask) {
				if (!layers_by_section.has(section_type))
					layers_by_section.set(section_type, layer);
			}
		}
	}

	// Sections without a dedicated layer fall back to the layout's base layer.
	if (base_layer !== null) {
		for (const section of sections) {
			if (!layers_by_section.has(section.SectionType))
				layers_by_section.set(section.SectionType, base_layer);
		}
	}

	return { section_by_type, layers_by_section };
}

/**
 * Resolve active choices to raw customization texture files for non-skin
 * replaceable texture types (e.g. DH blindfold = type 9). These are bound
 * directly to skinned models rather than composited, since the composite
 * pipeline is built for the multi-layer body skin and corrupts single-file
 * replaceable textures relative to the model's own UVs.
 * @param {Array} active_choices - array of { optionID, choiceID }
 * @param {number} layout_id - CharComponentTextureLayoutID
 * @returns {Map<number, number>} texture_type -> source FileDataID
 */
function resolve_replaceable_textures(active_choices, layout_id) {
	const result = new Map();

	for (const active_choice of active_choices) {
		const chr_cust_mat_ids = DBCharacterCustomization.get_choice_materials(active_choice.choiceID);
		if (chr_cust_mat_ids === undefined)
			continue;

		for (const chr_cust_mat_id of chr_cust_mat_ids) {
			// honor related-choice gating (e.g. blindfold tint gated by eye color)
			if (chr_cust_mat_id.RelatedChrCustomizationChoiceID != 0) {
				const has_related_choice = active_choices.find((selected_choice) => selected_choice.choiceID === chr_cust_mat_id.RelatedChrCustomizationChoiceID);
				if (!has_related_choice)
					continue;
			}

			const chr_cust_mat = DBCharacterCustomization.get_chr_cust_material(chr_cust_mat_id.ChrCustomizationMaterialID);
			if (!chr_cust_mat || !chr_cust_mat.FileDataID)
				continue;

			const chr_model_texture_layer = DBCharacterCustomization.get_model_texture_layer(layout_id, chr_cust_mat.ChrModelTextureTargetID);
			if (chr_model_texture_layer === undefined)
				continue;

			// skin + skin-extra are composited elsewhere; only collect direct-bind types
			if (chr_model_texture_layer.TextureType === SKIN_TEXTURE_TYPE || chr_model_texture_layer.TextureType === SKIN_EXTRA_TEXTURE_TYPE)
				continue;

			result.set(chr_model_texture_layer.TextureType, chr_cust_mat.FileDataID);
		}
	}

	return result;
}

/**
 * Determine whether a choice's skinned-model texture is gated by choices from
 * other options (e.g. DH blindfold textures only for certain eye colors).
 * @param {number} choice_id
 * @param {number} layout_id - CharComponentTextureLayoutID
 * @returns {{ has_ungated: boolean, gates: Map<number, Set<number>> }}
 *   has_ungated: a direct-bind texture applies regardless of related choices
 *   gates: option_id -> set of related choice ids that would supply the texture
 */
function get_texture_gating(choice_id, layout_id) {
	const gates = new Map();
	let has_ungated = false;

	const chr_cust_mat_ids = DBCharacterCustomization.get_choice_materials(choice_id);
	if (chr_cust_mat_ids === undefined)
		return { has_ungated, gates };

	for (const chr_cust_mat_id of chr_cust_mat_ids) {
		const chr_cust_mat = DBCharacterCustomization.get_chr_cust_material(chr_cust_mat_id.ChrCustomizationMaterialID);
		if (!chr_cust_mat || !chr_cust_mat.FileDataID)
			continue;

		const chr_model_texture_layer = DBCharacterCustomization.get_model_texture_layer(layout_id, chr_cust_mat.ChrModelTextureTargetID);
		if (chr_model_texture_layer === undefined)
			continue;

		// only direct-bind (non-skin) types can leave a skinned model untextured
		if (chr_model_texture_layer.TextureType === SKIN_TEXTURE_TYPE || chr_model_texture_layer.TextureType === SKIN_EXTRA_TEXTURE_TYPE)
			continue;

		if (chr_cust_mat_id.RelatedChrCustomizationChoiceID === 0) {
			has_ungated = true;
			continue;
		}

		const option_id = DBCharacterCustomization.get_choice_option(chr_cust_mat_id.RelatedChrCustomizationChoiceID);
		if (option_id === undefined)
			continue;

		if (!gates.has(option_id))
			gates.set(option_id, new Set());

		gates.get(option_id).add(chr_cust_mat_id.RelatedChrCustomizationChoiceID);
	}

	return { has_ungated, gates };
}

module.exports = {
	SKIN_TEXTURE_TYPE,
	SKIN_EXTRA_TEXTURE_TYPE,

	apply_customization_geosets,
	apply_customization_textures,
	get_equipment_texture_layers,
	upload_textures_to_gpu,
	dispose_materials,
	resolve_replaceable_textures,
	get_texture_gating
};
