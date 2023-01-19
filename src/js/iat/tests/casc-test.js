/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const IntegrationTest = require('../integration-test');

class CASCTest extends IntegrationTest {
	/**
	 * Returns true if a test unit requires a CASC instance provided as the
	 * second parameter. If false, this test unit will be automatically skipped
	 * if CASC has not been initialized.
	 */
	static get requireCASC() {
		return true;
	}

	/**
	 * Returns the individual tests for this test unit.
	 * @returns {function[]}
	 */
	get tests() {
		return [

		];
	}
}

module.exports = CASCTest;