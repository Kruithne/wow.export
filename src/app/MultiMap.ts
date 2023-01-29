/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
export default class MultiMap extends Map {
	/**
	 * Construct a new multi-value map.
	 */
	constructor() {
		super();
	}

	/**
	 * Set a value for a specific key in this map.
	 * @param key
	 * @param value
	 */
	set(key: (string | number | bigint) | (string | number | bigint)[], value: any) { // NIT: AAAAAAAAAAA help
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