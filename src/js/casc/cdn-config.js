/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const KEY_VAR_PATTERN = /([^\s]+)\s?=\s?(.*)/;

/**
 * Convert a config key such as 'encoding-sizes' to 'encodingSizes'.
 * This helps keep things consistent when accessing key properties.
 * @param {string} key
 */
const normalizeKey = (key) => {
	const keyParts = key.split('-');

	// Nothing to split, just use the normal key.
	if (keyParts.length === 1)
		return key;

	for (let i = 1, n = keyParts.length; i < n; i++) {
		const part = keyParts[i];
		keyParts[i] = part.charAt(0).toUpperCase() + part.slice(1);
	}

	return keyParts.join('');
};

module.exports = data => {
	const entries = {};
	let lines = data.split(/\r?\n/);

	for (const line of lines) {
		// Skip empty lines/comments.
		if (line.trim().length === 0 || line.startsWith('#'))
			continue;

		const match = line.match(KEY_VAR_PATTERN);
		if (match === null)
			throw new Error('Invalid token encountered parsing CDN config');

		entries[normalizeKey(match[1])] = match[2];
	}

	return entries;
};