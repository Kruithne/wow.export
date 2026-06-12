/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT

	Drives the game's real zone lighting (LightData.db2) for the model/character
	preview. Reuses the map viewer's FogDataProvider to resolve a map's global
	light at a chosen time of day, exposing ambient/direct/sun values that the
	M2 renderer feeds into its lighting.
*/

const FogDataProvider = require('../map-viewer/FogDataProvider');
const constants = require('../constants');
const log = require('../log');
const db2 = require('../casc/db2');

const MAP_COORD_BASE = constants.GAME.MAP_COORD_BASE;

let provider = null;
let provider_map_id = null;
let loading = false;

let enabled = false;
let map_id = 0;
let time = 720; // half-minutes; 720 = noon

// Computed light values for the active map/time, or null when zone lighting is
// disabled / unavailable (renderer then falls back to its default light).
let uniforms = null;

/**
 * Recompute the light values for the current map/time from the loaded provider.
 */
function recompute() {
	if (!enabled || provider === null) {
		uniforms = null;
		return;
	}

	try {
		provider.time_of_day = time;
		// Sample at the map's world origin so the global/default light is used.
		provider.update([MAP_COORD_BASE, 0, MAP_COORD_BASE]);

		const lu = provider.get_light_uniforms();
		uniforms = {
			ambient_color: lu.ambient_color,
			direct_color: lu.direct_color,
			light_dir: lu.light_dir // world space, points toward the sun
		};
	} catch (e) {
		log.write('[zone-light] failed to compute light: %s', e.message);
		uniforms = null;
	}
}

/**
 * Ensure a provider is loaded for the current map id, then recompute.
 */
async function ensure_provider() {
	if (provider !== null && provider_map_id === map_id) {
		recompute();
		return;
	}

	if (loading)
		return;

	loading = true;
	uniforms = null;

	try {
		const p = new FogDataProvider(map_id);
		await p.load();
		provider = p;
		provider_map_id = map_id;
		log.write('[zone-light] loaded light data for map %d', map_id);
	} catch (e) {
		log.write('[zone-light] failed to load light data for map %d: %s', map_id, e.message);
		provider = null;
		provider_map_id = null;
	} finally {
		loading = false;
	}

	recompute();
}

function set_enabled(value) {
	enabled = !!value;
	if (enabled)
		ensure_provider();
	else
		uniforms = null;
}

function set_map(id) {
	map_id = (id | 0);
	if (enabled)
		ensure_provider();
}

function set_time(value) {
	time = Math.max(0, Math.min(value | 0, 2880));
	recompute();
}

/**
 * @returns {{ ambient_color: Float32Array, direct_color: Float32Array, light_dir: Float32Array }|null}
 */
function get_uniforms() {
	return uniforms;
}

/**
 * Populate core.view.zoneLightMaps with all maps for the zone picker (once).
 * Shared by every tab that exposes zone lighting controls.
 * @param {object} core
 */
async function load_map_picker(core) {
	if (core.view.zoneLightMaps.length > 0)
		return;

	try {
		const maps = [];
		for (const [id, entry] of await db2.Map.getAllRows()) {
			const name = entry.MapName_lang || entry.Directory || ('Map ' + id);
			maps.push({ id, label: name + ' [' + id + ']' });
		}

		maps.sort((a, b) => a.label.localeCompare(b.label));
		core.view.zoneLightMaps = maps;
	} catch (e) {
		log.write('[zone-light] failed to load map picker: %s', e.message);
	}
}

module.exports = { set_enabled, set_map, set_time, get_uniforms, load_map_picker };
