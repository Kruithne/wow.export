/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const log = require('../log');
const util = require('util');

class IntegrationTest {
	/**
	 * IntegrationTest constructor.
	 * Do not call this directly, use extending classes.
	 * @param {TestRunner} runner 
	 */
	constructor(runner) {
		this.runner = runner;
		this.succeeded = 0;
	}

	/**
	 * Returns the individual tests for this test unit.
	 * This needs to be overwritten in extending test classes.
	 * @returns {function[]}
	 */
	get tests() {
		return [];
	}

	/**
	 * Returns the amount of tests defined by this unit.
	 * @returns {number}
	 */
	get testCount() {
		return this.tests.length;
	}
	
	/**
	 * Returns the name of this test unit.
	 * @returns {string}
	 */
	get unitName() {
		return this.constructor.name;
	}

	/**
	 * Returns true if this unit of tests has passed.
	 * @returns {boolean}
	 */
	get passed() {
		return this.succeeded >= this.testCount;
	}

	/**
	 * Run this test unit.
	 */
	async run() {
		this.succeeded = 0;
		log.write('Running %s tests (%d)', this.unitName, this.testCount);

		let testIndex = 1;
		for (const test of this.tests) {
			this.runner.markTest(util.format('%s->%s', this.unitName, test.name));

			try {
				const testStart = performance.now();
				await test.call(this);

				this.succeeded++;

				const elapsed = Math.round(performance.now() - testStart);
				log.write('(%d/%d) Passed %s->%s [%dms]', testIndex, this.testCount, this.unitName, test.name, elapsed);
			} catch (e) {
				log.write('(%d/%d) FAILED %s->%s (%s)', testIndex, this.testCount, this.unitName, test.name, e.message);
			}

			testIndex++;
		}

		log.write('Test unit %s %s (%d/%d)', this.unitName, this.passed ? 'succeeded' : 'failed', this.succeeded, this.testCount);
	}
}

module.exports = IntegrationTest;