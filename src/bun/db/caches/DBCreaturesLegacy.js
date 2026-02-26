import * as log from '../../lib/log.js';
import path from 'path';
import DBCReader from '../DBCReader.js';
import BufferWrapper from '../../lib/buffer.js';

const creature_displays = new Map();
let is_initialized = false;

const initialize_creature_data = async (mpq, build_id) => {
	if (is_initialized)
		return;

	log.write('Loading legacy creature textures from DBC...');

	try {
		const model_data_raw = mpq.getFile('DBFilesClient\\CreatureModelData.dbc');
		if (!model_data_raw) {
			log.write('CreatureModelData.dbc not found in MPQ');
			return;
		}

		const model_data_reader = new DBCReader('CreatureModelData.dbc', build_id);
		await model_data_reader.parse(new BufferWrapper(Buffer.from(model_data_raw)));

		const model_id_to_path = new Map();
		const model_rows = model_data_reader.getAllRows();

		for (const [id, row] of model_rows) {
			const model_path = row.ModelName || row.ModelPath || row.field_2;
			if (model_path && model_path.length > 0) {
				let normalized = model_path.toLowerCase().replace(/\\/g, '/');
				normalized = normalized.replace(/\.mdl$/i, '.m2').replace(/\.mdx$/i, '.m2');
				model_id_to_path.set(id, normalized);
			}
		}

		log.write('Loaded %d creature models from CreatureModelData.dbc', model_id_to_path.size);

		const display_info_raw = mpq.getFile('DBFilesClient\\CreatureDisplayInfo.dbc');
		if (!display_info_raw) {
			log.write('CreatureDisplayInfo.dbc not found in MPQ');
			return;
		}

		const display_info_reader = new DBCReader('CreatureDisplayInfo.dbc', build_id);
		await display_info_reader.parse(new BufferWrapper(Buffer.from(display_info_raw)));

		const display_rows = display_info_reader.getAllRows();

		for (const [display_id, row] of display_rows) {
			const model_id = row.ModelID ?? row.field_1;
			const model_path = model_id_to_path.get(model_id);

			if (!model_path)
				continue;

			const tex1 = row.TextureVariation?.[0] ?? row.Skin1 ?? row.field_6 ?? '';
			const tex2 = row.TextureVariation?.[1] ?? row.Skin2 ?? row.field_7 ?? '';
			const tex3 = row.TextureVariation?.[2] ?? row.Skin3 ?? row.field_8 ?? '';

			if (!tex1 && !tex2 && !tex3)
				continue;

			const model_dir = path.dirname(model_path).replace(/\\/g, '/');

			const display = {
				id: display_id,
				textures: []
			};

			if (tex1 && tex1.length > 0)
				display.textures.push(model_dir + '/' + tex1 + '.blp');
			if (tex2 && tex2.length > 0)
				display.textures.push(model_dir + '/' + tex2 + '.blp');
			if (tex3 && tex3.length > 0)
				display.textures.push(model_dir + '/' + tex3 + '.blp');

			if (!creature_displays.has(model_path))
				creature_displays.set(model_path, []);

			creature_displays.get(model_path).push(display);
		}

		log.write('Loaded skin variations for %d creature models', creature_displays.size);
		is_initialized = true;
	} catch (e) {
		log.write('Failed to load legacy creature data: %s', e.message);
		log.write('%o', e.stack);
	}
};

const get_creature_displays_by_path = (model_path) => {
	let normalized = model_path.toLowerCase().replace(/\\/g, '/');

	const mpq_match = normalized.match(/\.mpq[\/\\](.+)/i);
	if (mpq_match)
		normalized = mpq_match[1];

	normalized = normalized.replace(/\.mdx$/i, '.m2');

	return creature_displays.get(normalized);
};

const reset = () => {
	creature_displays.clear();
	is_initialized = false;
};

export {
	initialize_creature_data as initializeCreatureData,
	get_creature_displays_by_path as getCreatureDisplaysByPath,
	reset
};
