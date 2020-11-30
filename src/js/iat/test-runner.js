/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../core');
const util = require('util');
const log = require('../log');

const BufferTest = require('./tests/buffer-test');

class TestRunner {
	constructor() {
		this.testCount = 0;
		this.currentTest = 1;
	}
	
	/**
	 * Defines available test units.
	 * @returns {function[]}
	 */
	get testUnits() {
		return [
			BufferTest
		];
	}

	/**
	 * Mark the currently active test.
	 * @param {string} name 
	 */
	markTest(name) {
		core.view.loadingProgress = util.format('Running test %d / %d (%s)', this.currentTest, this.testCount, name);
		core.view.loadPct = Math.min(1, this.currentTest / this.testCount);
	}

	/**
	 * Run integration tests.
	 */
	async run() {
		log.write('===== INTEGRATION TESTS INITIATED =====');

		const unitCount = this.testUnits.length;
		const tests = Array(unitCount);

		this.testCount = 0;
		this.currentTest = 1;

		// Construct test unit instances to get a total test count.
		for (let i = 0; i < unitCount; i++) {
			const test = tests[i] = new this.testUnits[i](this);
			this.testCount += test.testCount;
		}

		// Run the tests.
		for (const test of tests)
			await test.run();

		log.write('===== INTEGRATION TESTS FINISHED =====');
	}
}

module.exports = TestRunner;