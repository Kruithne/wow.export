/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

const charset = '0zMcmVokRsaqbdrfwihuGINALpTjnyxtgevElBCDFHJKOPQSUWXYZ123456';

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

function wowhead_parse_hash(hash) {
	const version = charset.indexOf(hash[0]);
	const decompressed = decompress_zeros(hash.substring(1));
	const segments = decompressed.split('8');

	// basic character data
	const race = decode(segments[0]);
	const gender = charset.indexOf(segments[1][0]);
	const clazz = charset.indexOf(segments[1][1]);
	const spec = charset.indexOf(segments[1][2]);
	const level = decode(segments[1].substring(3));
	const npc_options = charset.indexOf(segments[2][0] || '0');
	const pepe = charset.indexOf(segments[2][1] || '0');
	const mount = decode(segments[2].substring(2));

	// customization data (segments 3-30)
	const customizations = [];
	for (let i = 3; i <= 30; i++) {
		const val = decode(segments[i] || '');
		if (val !== 0)
			customizations.push(val);
	}

	// equipment parsing helpers
	const parse_item = (seg) => {
		if (!seg || seg === '0')
			return 0;

		const last4 = seg.substring(Math.max(0, seg.length - 4));
		return decode(last4);
	};

	const parse_bonus = (seg) => {
		if (!seg || seg === '0' || seg.length <= 4)
			return 0;

		const bonus_str = seg.substring(0, seg.length - 4).replace(/7/g, '');
		return decode(bonus_str);
	};

	// equipment items (segments 31-44)
	const equipment = {
		head: {
			item_id: parse_item(segments[31]),
			item_bonus: parse_bonus(segments[31])
		},
		shoulders: {
			item_id: parse_item(segments[33]),
			item_bonus: decode(segments[32] || '0')
		},
		cloak: {
			item_id: parse_item(segments[35]),
			item_bonus: decode(segments[34] || '0')
		},
		chest: {
			item_id: parse_item(segments[37]),
			item_bonus: decode(segments[36] || '0')
		},
		hands: {
			item_id: parse_item(segments[38]),
			item_bonus: parse_bonus(segments[38])
		},
		waist: {
			item_id: parse_item(segments[40]),
			item_bonus: decode(segments[39] || '0')
		},
		legs: {
			item_id: parse_item(segments[42]),
			item_bonus: decode(segments[41] || '0')
		},
		feet: {
			item_id: parse_item(segments[44]),
			item_bonus: decode(segments[43] || '0')
		}
	};

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
