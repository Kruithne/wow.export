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
 * 
 * Currently no filter or param exists for directly accessing a file by
 * fileDataID, so we use the range filter to do so.
 * @type {string}
 */
const WOW_TOOLS_FILE = 'https://wow.tools/files/#search=range%%3A%d-%d';

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
		this.open(util.format(WOW_TOOLS_FILE, fileDataID, fileDataID));
	}
}