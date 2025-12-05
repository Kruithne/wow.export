/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/
const log = require('../../log');
const path = require('path');
const DBCReader = require('../DBCReader');
const BufferWrapper = require('../../buffer');

const creatureDisplays = new Map(); // model_path (lowercase) -> array of display info
let isInitialized = false;

/**
 * Initialize legacy creature display data from DBC files.
 * @param {MPQInstall} mpq
 * @param {string} build_id
 */
const initializeCreatureData = async (mpq, build_id) => {
	if (isInitialized)
		return;

	log.write('Loading legacy creature textures from DBC...');

	try {
		// load CreatureModelData.dbc
		const model_data_raw = mpq.getFile('DBFilesClient\\CreatureModelData.dbc');
		if (!model_data_raw) {
			log.write('CreatureModelData.dbc not found in MPQ');
			return;
		}

		const model_data_reader = new DBCReader('CreatureModelData.dbc', build_id);
		await model_data_reader.parse(new BufferWrapper(Buffer.from(model_data_raw)));

		// build map of modelID -> model filepath
		const model_id_to_path = new Map();
		const model_rows = model_data_reader.getAllRows();

		for (const [id, row] of model_rows) {
			// CreatureModelData has ModelPath field (string)
			const model_path = row.ModelName || row.ModelPath || row.field_2;
			if (model_path && model_path.length > 0) {
				// normalize: lowercase, convert .mdl/.mdx to .m2
				let normalized = model_path.toLowerCase().replace(/\\/g, '/');
				normalized = normalized.replace(/\.mdl$/i, '.m2').replace(/\.mdx$/i, '.m2');
				model_id_to_path.set(id, normalized);
			}
		}

		log.write('Loaded %d creature models from CreatureModelData.dbc', model_id_to_path.size);

		// load CreatureDisplayInfo.dbc
		const display_info_raw = mpq.getFile('DBFilesClient\\CreatureDisplayInfo.dbc');
		if (!display_info_raw) {
			log.write('CreatureDisplayInfo.dbc not found in MPQ');
			return;
		}

		const display_info_reader = new DBCReader('CreatureDisplayInfo.dbc', build_id);
		await display_info_reader.parse(new BufferWrapper(Buffer.from(display_info_raw)));

		const display_rows = display_info_reader.getAllRows();

		for (const [display_id, row] of display_rows) {
			// CreatureDisplayInfo fields:
			// ID, ModelID, SoundID, ExtendedDisplayInfoID, CreatureModelScale, CreatureModelAlpha,
			// TextureVariation[3], PortraitTextureName, BloodLevel, BloodID, NPCSoundID, ParticleColorID, ...
			const model_id = row.ModelID ?? row.field_1;
			const model_path = model_id_to_path.get(model_id);

			if (!model_path)
				continue;

			// get texture variation strings (3 slots)
			const tex1 = row.TextureVariation?.[0] ?? row.Skin1 ?? row.field_6 ?? '';
			const tex2 = row.TextureVariation?.[1] ?? row.Skin2 ?? row.field_7 ?? '';
			const tex3 = row.TextureVariation?.[2] ?? row.Skin3 ?? row.field_8 ?? '';

			// skip if no textures
			if (!tex1 && !tex2 && !tex3)
				continue;

			const model_dir = path.dirname(model_path).replace(/\\/g, '/');

			const display = {
				id: display_id,
				textures: []
			};

			// build full texture paths
			if (tex1 && tex1.length > 0)
				display.textures.push(model_dir + '/' + tex1 + '.blp');
			if (tex2 && tex2.length > 0)
				display.textures.push(model_dir + '/' + tex2 + '.blp');
			if (tex3 && tex3.length > 0)
				display.textures.push(model_dir + '/' + tex3 + '.blp');

			// add to map by model path
			if (!creatureDisplays.has(model_path))
				creatureDisplays.set(model_path, []);

			creatureDisplays.get(model_path).push(display);
		}

		log.write('Loaded skin variations for %d creature models', creatureDisplays.size);
		isInitialized = true;
	} catch (e) {
		log.write('Failed to load legacy creature data: %s', e.message);
		log.write('%o', e.stack);
	}
};

/**
 * Get all available creature display variations for a model path.
 * @param {string} model_path - The M2 model path (can include MPQ prefix)
 * @returns {Array|undefined}
 */
const getCreatureDisplaysByPath = (model_path) => {
	// normalize path: lowercase, forward slashes, strip MPQ prefix
	let normalized = model_path.toLowerCase().replace(/\\/g, '/');

	// strip MPQ archive prefix if present (e.g., "data/model.mpq/creature/...")
	const mpq_match = normalized.match(/\.mpq[\/\\](.+)/i);
	if (mpq_match)
		normalized = mpq_match[1];

	// convert .mdx to .m2
	normalized = normalized.replace(/\.mdx$/i, '.m2');

	return creatureDisplays.get(normalized);
};

/**
 * Reset the cache (for when switching MPQ installs)
 */
const reset = () => {
	creatureDisplays.clear();
	isInitialized = false;
};

module.exports = {
	initializeCreatureData,
	getCreatureDisplaysByPath,
	reset
};
