/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
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