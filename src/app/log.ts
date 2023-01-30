/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import util from 'node:util';
import fs from 'node:fs';

import Constants from './constants';

const MAX_LOG_POOL: number = 1000;
const MAX_DRAIN_PER_TICK: number = 10;

let markTimer: number = 0;
let isClogged: boolean = false;

const pool: Array<string> = [];
const stream = fs.createWriteStream(Constants.RUNTIME_LOG);
stream.on('drain', drainPool);

/**
 * @returns A HH:MM:SS formatted timestamp.
 */
function getTimestamp(): string {
	const time = new Date();
	return util.format(
		'%s:%s:%s',
		time.getHours().toString().padStart(2, '0'),
		time.getMinutes().toString().padStart(2, '0'),
		time.getSeconds().toString().padStart(2, '0'));
}

/**
 * Drains the log pool.
 */
function drainPool(): void {
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
}

/**
 * Internally mark the current timestamp for measuring performance times with `Log.timeEnd`.
 */
export function timeLog(): void {
	markTimer = Date.now();
}

/**
 * Logs the time (in milliseconds) between the last Log.timeLog()
 * call and this call, with the given label prefixed.
 * @param label - Label to prefix the time with
 * @param params - Addition parameters
 */
export function timeEnd(label: string, ...params: (string | number)[]): void {
	write(label + ' (%dms)', ...params, (Date.now() - markTimer));
}

/**
 * Open the runtime log in the users external editor.
 */
export function openRuntimeLog(): void {
	nw.Shell.openItem(Constants.RUNTIME_LOG);
}

/**
 * Write a message to the log.
 */
export function write(...parameters: (string | number | object)[]): void {
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
	if (process.env.NODE_ENV === 'development')
		console.log(line);
}

/**
 * Attempts to return the contents of the runtime log.
 * This is defined as a global as it is requested during
 * an application crash where modules may not be loaded.
 */
export async function getErrorDump(): Promise<string> {
	try {
		return await fs.promises.readFile(Constants.RUNTIME_LOG, 'utf8');
	} catch (e) {
		return 'Unable to obtain runtime log: ' + e.message;
	}
}

export default {
	timeLog,
	timeEnd,
	openRuntimeLog,
	write,
	getErrorDump
};