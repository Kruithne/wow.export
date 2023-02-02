/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import util from 'node:util';

/** Defines static links which can be referenced via the data-external HTML attribute. */
const STATIC_LINKS: Record<string, string> = {
	'::WEBSITE': 'https://www.kruithne.net/wow.export/',
	'::DISCORD': 'https://discord.gg/kC3EzAYBtf',
	'::PATREON': 'https://patreon.com/Kruithne',
	'::GITHUB': 'https://github.com/Kruithne/wow.export',
	'::ISSUE_TRACKER': 'https://github.com/Kruithne/wow.export/issues'
};

/** Defines the URL pattern for locating a specific item on Wowhead. */
const WOWHEAD_ITEM = 'https://www.wowhead.com/item=%d';

/**
 * Open an external link on the system.
 * @param link - The link to open. If the link starts with '::' it will be resolved to a static link.
 */
export function openExternalLink(link: string): void {
	if (link.startsWith('::'))
		link = STATIC_LINKS[link];

	nw.Shell.openExternal(link);
}

/**
 * Open a specific item on Wowhead.
 * @param itemID - The item ID to open on Wowhead.
 */
export function openItemOnWowhead(itemID: number): void {
	open(util.format(WOWHEAD_ITEM, itemID));
}

export default {
	openExternalLink,
	openItemOnWowhead
};