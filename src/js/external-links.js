import * as platform from './platform.js';

const STATIC_LINKS = {
	'::WEBSITE': 'https://www.kruithne.net/wow.export/',
	'::DISCORD': 'https://discord.gg/kC3EzAYBtf',
	'::PATREON': 'https://patreon.com/Kruithne',
	'::GITHUB': 'https://github.com/Kruithne/wow.export',
	'::ISSUE_TRACKER': 'https://github.com/Kruithne/wow.export/issues'
};

const WOWHEAD_ITEM = 'https://www.wowhead.com/item=%d';

export default class ExternalLinks {
	static open(link) {
		if (link.startsWith('::'))
			link = STATIC_LINKS[link];

		platform.open_url(link);
	}

	static wowHead_viewItem(itemID) {
		this.open(WOWHEAD_ITEM.replace('%d', itemID));
	}
}
