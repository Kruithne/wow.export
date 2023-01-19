/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const util = require('util');

/**
 * Defines static links which can be referenced via the data-external HTML attribute.
 * @type {Object.<string, string>}
 */
const STATIC_LINKS = {
	'::WEBSITE': 'https://www.kruithne.net/wow.export/',
	'::DISCORD': 'https://discord.gg/kC3EzAYBtf',
	'::PATREON': 'https://patreon.com/Kruithne',
	'::GITHUB': 'https://github.com/Kruithne/wow.export',
	'::ISSUE_TRACKER': 'https://github.com/Kruithne/wow.export/issues'
};

/**
 * Defines the URL pattern for locating a specific item on Wowhead.
 * @type {string}
 */
const WOWHEAD_ITEM = 'https://www.wowhead.com/item=%d';

module.exports = class ExternalLinks {
	/**
	 * Open an external link on the system.
	 * @param {string} link
	 */
	static open(link) {
		if (link.startsWith('::'))
			link = STATIC_LINKS[link];

		nw.Shell.openExternal(link);
	}

	/**
	 * Open a specific item on Wowhead.
	 * @param {number} itemID
	 */
	static wowHead_viewItem(itemID) {
		this.open(util.format(WOWHEAD_ITEM, itemID));
	}
};