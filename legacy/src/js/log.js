/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const fs = require('fs');
const util = require('util');
const constants = require('./constants');

const MAX_LOG_POOL = 1000;
const MAX_DRAIN_PER_TICK = 10;

let markTimer = 0;
let isClogged = false;
const pool = [];

/**
 * Return a HH:MM:SS formatted timestamp.
 */
const getTimestamp = () => {
	const time = new Date();
	return util.format(
		'%s:%s:%s',
		time.getHours().toString().padStart(2, '0'),
		time.getMinutes().toString().padStart(2, '0'),
		time.getSeconds().toString().padStart(2, '0'));
};

/**
 * Invoked when the stream has finished flushing.
 */
const drainPool = () => {
	isClogged = false;

	// If the pool is empty, don't slip into a loop.
	if (pool.length === 0)
		return;

	let ticks = 0;
	while (!isClogged && ticks < MAX_DRAIN_PER_TICK && pool.length > 0) {
		isClogged = !stream.write(pool.shift());
		ticks++;
	}

	// Only schedule another drain if we're not blocked and we have
	// something remaining in the pool.
	if (!isClogged && pool.length > 0)
		process.nextTick(drainPool);
};

/**
 * Internally mark the current timestamp for measuring
 * performance times with log.timeEnd();
 */
const timeLog = () => {
	markTimer = Date.now();
};

/**
 * Logs the time (in milliseconds) between the last log.timeLog()
 * call and this call, with the given label prefixed.
 * @param {string} label 
 */
const timeEnd = (label, ...params) => {
	write(label + ' (%dms)', ...params, (Date.now() - markTimer));
};

/**
 * Open the runtime log in the users external editor.
 */
const openRuntimeLog = () => {
	nw.Shell.openItem(constants.RUNTIME_LOG);
};

/**
 * Write a message to the log.
 */
const write = (...parameters) => {
	const line = '[' + getTimestamp() + '] ' + util.format(...parameters) + '\n';

	if (!isClogged) {
		isClogged = !stream.write(line);
	} else {
		// Stream is blocked, pool instead.
		// If pool exceeds MAX_LOG_POOL, explode.
		if (pool.length < MAX_LOG_POOL)
			pool.push(line);
		else
			throw new Error('ERR_LOG_OVERFLOW: The log pool has overflowed.');
	}

	// Mirror output to debugger.
	if (!BUILD_RELEASE)
		console.log(line);
};

/**
 * Attempts to return the contents of the runtime log.
 * This is defined as a global as it is requested during
 * an application crash where modules may not be loaded.
 */
getErrorDump = async () => {
	try {
		return await fs.promises.readFile(constants.RUNTIME_LOG, 'utf8');
	} catch (e) {
		return 'Unable to obtain runtime log: ' + e.message;
	}
};

// Initialize the logging stream.
const stream = fs.createWriteStream(constants.RUNTIME_LOG);
stream.on('drain', drainPool);

module.exports = { write, timeLog, timeEnd, openRuntimeLog };