/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const charset = '0zMcmVokRsaqbdrfwihuGINALpTjnyxtgevElBCDFHJKOPQSUWXYZ123456';

// wowhead paperdoll slot index -> our slot id
const WOWHEAD_SLOT_TO_SLOT_ID = {
	1: 1,   // head
	2: 3,   // shoulders
	3: 15,  // back
	4: 5,   // chest
	5: 4,   // shirt
	6: 19,  // tabard
	7: 9,   // wrists
	8: 10,  // hands
	9: 6,   // waist
	10: 7,  // legs
	11: 8,  // feet
	12: 16, // main-hand
	13: 17  // off-hand
};

function decode(str) {
	if (!str)
		return 0;

	if (str.length === 1)
		return charset.indexOf(str);

	const chars = str.split('').reverse();
	let result = 0;

	for (let i = 0; i < chars.length; i++) {
		let value = charset.indexOf(chars[i]);
		if (value === -1)
			return 0;

		for (let j = 0; j < i; j++)
			value *= 58;

		result += value;
	}

	return result;
}

function decompress_zeros(str) {
	return str.replace(/9(.)/g, (_, count_char) => {
		const count = charset.indexOf(count_char);
		return count < 0 ? _ : '08'.repeat(count);
	});
}

function extract_hash_from_url(url) {
	const match = url.match(/dressing-room#(.+)/);
	return match ? match[1] : null;
}

function strip_7_prefix(seg) {
	// equipment segments can have 7X prefix where X is slot indicator
	if (seg && seg.startsWith('7') && seg.length > 2)
		return seg.substring(2);

	return seg;
}

function wowhead_parse_hash(hash) {
	const version = charset.indexOf(hash[0]);
	const decompressed = decompress_zeros(hash.substring(1));
	const segments = decompressed.split('8');

	if (version >= 15)
		return parse_v15(segments, version);

	return parse_legacy(segments, version);
}

function parse_v15(segments, version) {
	const race = decode(segments[0]);

	// segment 1 is: gender (char 0) + class (char 1) + spec (char 2) + level (rest)
	const combined = segments[1] || '';
	const gender = charset.indexOf(combined[0] || '0');
	const clazz = charset.indexOf(combined[1] || '0');
	const spec = charset.indexOf(combined[2] || '0');
	const level = decode(combined.substring(3));

	// segment 2 is: npcOptions (char 0) + pepe (char 1) + mount (rest)
	const opts = segments[2] || '';
	const npc_options = charset.indexOf(opts[0] || '0');
	const pepe = charset.indexOf(opts[1] || '0');
	const mount = decode(opts.substring(2));

	// find equipment start by looking for first segment with 7 prefix
	let equip_start = -1;
	for (let i = 6; i < segments.length; i++) {
		if (segments[i] && segments[i].startsWith('7')) {
			equip_start = i;
			break;
		}
	}

	// customization choices are between segment 6 and equipment start
	const customizations = [];
	if (equip_start > 6) {
		for (let i = 6; i < equip_start; i += 2) {
			const choice_id = decode(segments[i + 1] || '');
			if (choice_id !== 0)
				customizations.push(choice_id);
		}
	}

	// parse equipment - process segment by segment
	// 7X prefix marks slot (X is charset index), high values (>=14) mark equipment start
	// format: itemId, bonus pairs; weapons (slots 12-13) also have enchant
	// markers can appear in bonus position when slots are skipped
	const equipment = {};

	if (equip_start > 0) {
		let wh_slot = 1;

		for (let seg_idx = equip_start; seg_idx < segments.length && wh_slot <= 13; seg_idx++) {
			const seg = segments[seg_idx] || '';

			// check for 7X slot marker
			if (seg.startsWith('7') && seg.length >= 2) {
				const slot_char = seg[1];
				const marked_slot = charset.indexOf(slot_char);

				// valid slot marker (1-13) means set to that slot
				if (marked_slot >= 1 && marked_slot <= 13)
					wh_slot = marked_slot;
			}

			if (wh_slot > 13)
				break;

			const item_str = strip_7_prefix(seg);
			const item_id = decode(item_str);

			if (item_id > 0) {
				const slot_id = WOWHEAD_SLOT_TO_SLOT_ID[wh_slot];
				if (slot_id)
					equipment[slot_id] = item_id;

				// skip bonus segment only if next segment is not a marker
				const next_seg = segments[seg_idx + 1] || '';
				if (!next_seg.startsWith('7')) {
					seg_idx += 1;
					// weapons (slots 12-13) also have enchant
					if (wh_slot >= 12) {
						const enchant_seg = segments[seg_idx + 1] || '';
						if (!enchant_seg.startsWith('7'))
							seg_idx += 1;
					}
				}

				wh_slot++;
			}
		}
	}

	return {
		version,
		race,
		gender,
		class: clazz,
		spec,
		level,
		npc_options,
		pepe,
		mount,
		customizations,
		equipment
	};
}

function parse_legacy(segments, version) {
	// legacy format (v1-v14)
	const race = decode(segments[0]);
	const gender = charset.indexOf(segments[1]?.[0] || '0');
	const clazz = charset.indexOf(segments[1]?.[1] || '0');
	const spec = charset.indexOf(segments[1]?.[2] || '0');
	const level = decode(segments[1]?.substring(3) || '');
	const npc_options = charset.indexOf(segments[2]?.[0] || '0');
	const pepe = charset.indexOf(segments[2]?.[1] || '0');
	const mount = decode(segments[2]?.substring(2) || '');

	// customization data (segments 3-30)
	const customizations = [];
	for (let i = 3; i <= 30; i++) {
		const val = decode(segments[i] || '');
		if (val !== 0)
			customizations.push(val);
	}

	// equipment starts at segment 31 for legacy versions
	const equipment = {};
	const slot_map_legacy = {
		31: 1,   // head
		33: 3,   // shoulders
		35: 15,  // back
		37: 5,   // chest
		38: 10,  // hands
		40: 6,   // waist
		42: 7,   // legs
		44: 8    // feet
	};

	for (const [seg_idx, slot_id] of Object.entries(slot_map_legacy)) {
		const seg = segments[parseInt(seg_idx)] || '';
		const item_id = decode(seg.substring(Math.max(0, seg.length - 4)));
		if (item_id > 0)
			equipment[slot_id] = item_id;
	}

	return {
		version,
		race,
		gender,
		class: clazz,
		spec,
		level,
		npc_options,
		pepe,
		mount,
		customizations,
		equipment
	};
}

const wowhead_parse = (url) => {
	const hash = extract_hash_from_url(url);
	if (!hash)
		throw new Error('invalid wowhead url: missing dressing-room hash');

	return wowhead_parse_hash(hash);
};

module.exports = { wowhead_parse };
