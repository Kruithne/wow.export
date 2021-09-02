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
	'::DISCORD': 'https://discord.gg/kC3EzAYBtf',
	'::PATREON': 'https://patreon.com/Kruithne',
	'::ABOUT_WT': 'https://wow.tools/export/',
	'::GITHUB': 'https://github.com/Kruithne/wow.export',
	'::ISSUE_TRACKER': 'https://github.com/Kruithne/wow.export/issues'
};

/**
 * Defines the URL pattern for locating a specific file on wow.tools.
 * @type {string}
 */
const WOW_TOOLS_FILE = 'https://wow.tools/files/#search=fdid%%3A%d&fdidModal=1';

/**
 * Defines the URL pattern for locating a map on wow.tools.
 * @type {string}
 */
const WOW_TOOLS_MAP = 'https://wow.tools/maps/%s';

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
	 * Open a specific file on wow.tools.
	 * @param {number} fileDataID 
	 */
	static wowTools_viewFile(fileDataID) {
		this.open(util.format(WOW_TOOLS_FILE, fileDataID));
	}

	/**
	 * Open a specific map on wow.tools.
	 * @param {string} mapName
	 */
	static wowTools_viewMap(mapName) {
		this.open(util.format(WOW_TOOLS_MAP, mapName));
	}

	/**
	 * Open a specific item on Wowhead.
	 * @param {number} itemID 
	 */
	static wowHead_viewItem(itemID) {
		this.open(util.format(WOWHEAD_ITEM, itemID));
	}
}