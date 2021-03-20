/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/
class URLRegister {
	/**
	 * Construct a new URLRegister instance.
	 */
	constructor() {
		this.track = new Set();
	}

	/**
	 * Register a URL.
	 * @param {string} url 
	 * @returns {string}
	 */
	register(url) {
		this.track.add(url);
		return url;
	}

	/**
	 * Purge all registered data URLs in the register.
	 */
	purge() {
		for (const url of this.track)
			URL.revokeObjectURL(url);

		this.track.clear();
	}
}

module.exports = URLRegister;