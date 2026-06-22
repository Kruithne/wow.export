/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const log = require('./log');
const constants = require('./constants');
const db2 = require('./casc/db2');
const wmo_minimap = require('./wmo-minimap');

const TILE_SIZE = constants.GAME.TILE_SIZE;
const MAP_COORD_BASE = constants.GAME.MAP_COORD_BASE;
const DEG_TO_RAD = Math.PI / 180;

// world positions keyed by engine map id, encounters live in Journal* db2 tables
const _world_cache = new Map();

// pick the smallest UiMapAssignment region that contains the normalized point,
// preferring surface (non-wmo) regions
const pick_assignment = (list, x, y) => {
	let best = null;
	let best_area = Infinity;

	for (const a of list) {
		if (x < a.UiMin[0] || x > a.UiMax[0] || y < a.UiMin[1] || y > a.UiMax[1])
			continue;

		const is_wmo = (a.WMODoodadPlacementID > 0 || a.WMOGroupID > 0) ? 1 : 0;
		const area = (a.UiMax[0] - a.UiMin[0]) * (a.UiMax[1] - a.UiMin[1]) + is_wmo * 10;

		if (area < best_area) {
			best = a;
			best_area = area;
		}
	}

	return best ?? list[0] ?? null;
};

// convert a UiMap-relative (0-1) position into world yards via bilinear
// interpolation of the assignment region corners
const uimap_to_world = (assignments, x, y) => {
	const a = pick_assignment(assignments, x, y);
	if (!a)
		return null;

	const r = a.Region;
	const nx = (x - a.UiMin[0]) / (a.UiMax[0] - a.UiMin[0]);
	const ny = (y - a.UiMin[1]) / (a.UiMax[1] - a.UiMin[1]);

	// r[3..5] = world (x,y,z) at uimin (top-left), r[0..2] = world at uimax (bottom-right)
	return {
		x: r[3] + ny * (r[0] - r[3]),
		y: r[4] + nx * (r[1] - r[4]),
		map_id: a.MapID
	};
};

// group UiMapAssignment rows by UiMapID once per session
let _assignments_by_uimap = null;
const get_assignments_by_uimap = async () => {
	if (_assignments_by_uimap)
		return _assignments_by_uimap;

	_assignments_by_uimap = new Map();
	for (const a of (await db2.UiMapAssignment.getAllRows()).values()) {
		let list = _assignments_by_uimap.get(a.UiMapID);
		if (!list) {
			list = [];
			_assignments_by_uimap.set(a.UiMapID, list);
		}
		list.push(a);
	}

	return _assignments_by_uimap;
};

/**
 * Resolve journal encounter world positions for an engine map id.
 * Returns [{ world_x, world_y, label }] (world yards), [] for non-dungeon maps.
 * Shared by both terrain and WMO minimap projection.
 */
const get_encounter_world_positions = async (map_id) => {
	if (_world_cache.has(map_id))
		return _world_cache.get(map_id);

	const positions = [];

	try {
		// instances belonging to this engine map define the dungeon/raid
		const instance_ids = new Set();
		for (const inst of (await db2.JournalInstance.getAllRows()).values()) {
			if (inst.MapID === map_id)
				instance_ids.add(inst.ID);
		}

		if (instance_ids.size === 0) {
			_world_cache.set(map_id, positions);
			return positions;
		}

		const assignments_by_uimap = await get_assignments_by_uimap();

		for (const enc of (await db2.JournalEncounter.getAllRows()).values()) {
			if (!instance_ids.has(enc.JournalInstanceID))
				continue;

			const ui_map_id = enc.UiMapID;
			if (!ui_map_id || !enc.Map)
				continue;

			const [ux, uy] = enc.Map;
			if (ux === 0 && uy === 0)
				continue;

			const assignments = assignments_by_uimap.get(ui_map_id);
			if (!assignments)
				continue;

			const world = uimap_to_world(assignments, ux, uy);
			if (!world)
				continue;

			positions.push({
				world_x: world.x,
				world_y: world.y,
				label: enc.Name_lang ?? ''
			});
		}

		log.write('resolved %d journal encounters for map %d', positions.length, map_id);
	} catch (e) {
		log.write('failed to resolve journal encounters for map %d: %s', map_id, e.message);
	}

	_world_cache.set(map_id, positions);
	return positions;
};

// terrain minimap is laid out directly in adt/world tile space
const world_to_terrain_marker = (p) => ({
	x: 32 - p.world_y / TILE_SIZE,
	y: 32 - p.world_x / TILE_SIZE,
	label: p.label
});

// global wmo maps are placed at the wdt origin (pos 0, rot 0, scale 1.0); there
// the negate-model corners equal world space and no placement inverse is needed
const is_identity_placement = (placement) => {
	const p = placement.position, r = placement.rotation;
	return p[0] === 0 && p[1] === 0 && p[2] === 0
		&& r[0] === 0 && r[1] === 0 && r[2] === 0
		&& (placement.scale === 1024 || placement.scale === 0);
};

// invert a wmo placement (yaw + scale + position offset) to map a centered
// world (north, west) position into wmo model space. placement.position is
// uncentered (0..2*BASE).
const wmo_world_to_local = (placement, north, west) => {
	const theta = ((placement.rotation?.[1] ?? 0) - 90) * DEG_TO_RAD;
	const c = Math.cos(theta), s = Math.sin(theta);
	const k = (placement.scale || 1024) / 1024;

	const dX = (MAP_COORD_BASE - placement.position[0] - west) / k;
	const dZ = (MAP_COORD_BASE - placement.position[2] - north) / k;

	const mx = c * dX - s * dZ;
	const my = -s * dX - c * dZ;

	return { x: -mx, y: -my };
};

/**
 * Project encounter world positions onto a WMO minimap as fractional tile
 * coordinates. minimap_data is the compute_minimap_layout result; placement is
 * the WDT global WMO placement (null ⇒ origin negate).
 * Markers: { x, y, label } in fractional WMO grid tile coords.
 */
const get_wmo_encounters_for_map = async (map_id, minimap_data, placement) => {
	try {
		// projection requires the placement to invert the wmo transform
		if (!placement) {
			log.write('wmo encounters: no placement for map %d', map_id);
			return [];
		}

		const positions = await get_encounter_world_positions(map_id);
		log.write('wmo encounters: map %d resolved %d world positions, placement pos=%s rot=%s scale=%d',
			map_id, positions.length, JSON.stringify(placement.position), JSON.stringify(placement.rotation), placement.scale);

		if (positions.length === 0)
			return [];

		// build_world_meta gives the world<->pixel corner mapping for the image:
		// top_left = pixel (0,0), bottom_right = pixel (width, height). corners are in
		// world space, matching the wmo_world_to_local output.
		const meta = wmo_minimap.build_world_meta(minimap_data, placement);
		const { top_left, bottom_right } = meta.corners;
		const tile_size = minimap_data.output_tile_size;

		log.write('wmo encounters: image %dx%d, grid_size %d, tl=%s br=%s',
			meta.image.width, meta.image.height, minimap_data.grid_size, JSON.stringify(top_left), JSON.stringify(bottom_right));

		const span_x = bottom_right.world_x - top_left.world_x;
		const span_y = bottom_right.world_y - top_left.world_y;

		// the build_world_meta corners are in negated-model space, which equals world
		// space for an origin-placed global wmo (the only case the wmo minimap branch
		// hits). interpolate world coords directly; only invert the placement when it
		// is non-identity (offset/rotated/scaled).
		const local_of = is_identity_placement(placement)
			? (p) => ({ x: p.world_x, y: p.world_y })
			: (p) => wmo_world_to_local(placement, p.world_x, p.world_y);

		const markers = [];
		for (const p of positions) {
			const local = local_of(p);

			const pixel_x = ((local.x - top_left.world_x) / span_x) * meta.image.width;
			const pixel_y = ((local.y - top_left.world_y) / span_y) * meta.image.height;

			markers.push({
				x: pixel_x / tile_size,
				y: pixel_y / tile_size,
				label: p.label
			});
		}

		return markers;
	} catch (e) {
		log.write('wmo encounters: failed for map %d: %s', map_id, e.stack);
		return [];
	}
};

/**
 * Resolve journal encounters for a terrain map as fractional minimap tile coords.
 * Returns [] for non-dungeon maps. Markers: { x, y, label } (file X/Y axes).
 */
const get_encounters_for_map = async (map_id) => {
	const positions = await get_encounter_world_positions(map_id);
	return positions.map(world_to_terrain_marker);
};

module.exports = { get_encounters_for_map, get_wmo_encounters_for_map };
