/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
class MultiMap extends Map {
	/**
	 * Construct a new multi-value map.
	 */
	constructor() {
		super();
	}

	/**
	 * Set a value for a specific key in this map.
	 * @param {string} key
	 * @param {any} value
	 */
	set(key, value) {
		const check = this.get(key);
		if (check !== undefined) {
			if (Array.isArray(check))
				check.push(value);
			else
				super.set(key, [check, value]);
		} else {
			super.set(key, value);
		}
	}
}

module.exports = MultiMap;