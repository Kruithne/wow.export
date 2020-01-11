const fs = require('fs');

// Unit tests to be executed.
const INCLUDED_UNIT_TESTS = [
	'./tests/bufferTest',
	'./tests/db2Test',
];
globalThis.BUILD_RELEASE = true;

// Create test runtime folder
if (!fs.existsSync('./tests/user_data'))
	fs.mkdirSync('./tests/user_data')

// Test runner.
let isErrored = false;
for (const test of INCLUDED_UNIT_TESTS) {
	try {
		require(test);
		console.info('> %s succeeded', test);
	} catch (e) {
		console.error('> %s failed: %s expected %o, got %o (%s) @ %s', test, e.operator, e.expected, e.actual, e.message, e.stack.split('\n')[1].trim());
		isErrored = true;
	}
}

if (isErrored)
	process.exit(1);