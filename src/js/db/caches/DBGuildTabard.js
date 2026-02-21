/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const log = require('../../log');
const db2 = require('../../casc/db2');

// item_id -> tier
const GUILD_TABARD_ITEM_IDS = { 5976: 0, 69209: 1, 69210: 2 };

// tier-component-color -> FileDataID
const background_map = new Map();

// tier-component-borderID-color -> FileDataID
const border_map = new Map();

// component-emblemID-color -> FileDataID
const emblem_map = new Map();

// color_id -> { r, g, b }
const background_colors = new Map();
const border_colors = new Map();
const emblem_colors = new Map();

let background_color_count = 0;
let border_style_counts = [0, 0, 0]; // per tier
let border_color_count = 0;
let emblem_design_count = 0;
let emblem_color_count = 0;

let is_initialized = false;
let init_promise = null;

const initialize = async () => {
	if (is_initialized)
		return;

	if (init_promise)
		return init_promise;

	init_promise = (async () => {
		log.write('Loading guild tabard data...');

		const bg_colors = new Set();
		for (const row of (await db2.GuildTabardBackground.getAllRows()).values()) {
			background_map.set(row.Tier + '-' + row.Component + '-' + row.Color, row.FileDataID);
			bg_colors.add(row.Color);
		}
		background_color_count = bg_colors.size;

		const border_styles = [new Set(), new Set(), new Set()];
		const border_color_ids = new Set();
		for (const row of (await db2.GuildTabardBorder.getAllRows()).values()) {
			border_map.set(row.Tier + '-' + row.Component + '-' + row.BorderID + '-' + row.Color, row.FileDataID);
			if (border_styles[row.Tier])
				border_styles[row.Tier].add(row.BorderID);
			border_color_ids.add(row.Color);
		}
		border_style_counts = border_styles.map(s => s.size);
		border_color_count = border_color_ids.size;

		const emblem_designs = new Set();
		const emblem_color_ids = new Set();
		for (const row of (await db2.GuildTabardEmblem.getAllRows()).values()) {
			emblem_map.set(row.Component + '-' + row.EmblemID + '-' + row.Color, row.FileDataID);
			emblem_designs.add(row.EmblemID);
			emblem_color_ids.add(row.Color);
		}
		emblem_design_count = emblem_designs.size;
		emblem_color_count = emblem_color_ids.size;

		// load actual RGB color values
		for (const [id, row] of (await db2.GuildColorBackground.getAllRows()).entries())
			background_colors.set(id, { r: row.Red, g: row.Green, b: row.Blue });

		for (const [id, row] of (await db2.GuildColorBorder.getAllRows()).entries())
			border_colors.set(id, { r: row.Red, g: row.Green, b: row.Blue });

		for (const [id, row] of (await db2.GuildColorEmblem.getAllRows()).entries())
			emblem_colors.set(id, { r: row.Red, g: row.Green, b: row.Blue });

		log.write('Loaded guild tabard data: %d backgrounds, %d borders, %d emblems', background_map.size, border_map.size, emblem_map.size);
		is_initialized = true;
		init_promise = null;
	})();

	return init_promise;
};

const ensure_initialized = async () => {
	if (!is_initialized)
		await initialize();
};

const is_guild_tabard = (item_id) => {
	return item_id in GUILD_TABARD_ITEM_IDS;
};

const get_tabard_tier = (item_id) => {
	return GUILD_TABARD_ITEM_IDS[item_id] ?? -1;
};

const get_background_fdid = (tier, component, color) => {
	return background_map.get(tier + '-' + component + '-' + color) ?? 0;
};

const get_border_fdid = (tier, component, border_id, color) => {
	return border_map.get(tier + '-' + component + '-' + border_id + '-' + color) ?? 0;
};

const get_emblem_fdid = (component, emblem_id, color) => {
	return emblem_map.get(component + '-' + emblem_id + '-' + color) ?? 0;
};

module.exports = {
	initialize,
	ensureInitialized: ensure_initialized,
	isGuildTabard: is_guild_tabard,
	getTabardTier: get_tabard_tier,
	getBackgroundFDID: get_background_fdid,
	getBorderFDID: get_border_fdid,
	getEmblemFDID: get_emblem_fdid,
	getBackgroundColorCount: () => background_color_count,
	getBorderStyleCount: (tier) => border_style_counts[tier] ?? 0,
	getBorderColorCount: () => border_color_count,
	getEmblemDesignCount: () => emblem_design_count,
	getEmblemColorCount: () => emblem_color_count,
	getBackgroundColors: () => background_colors,
	getBorderColors: () => border_colors,
	getEmblemColors: () => emblem_colors
};
