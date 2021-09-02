/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

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
}