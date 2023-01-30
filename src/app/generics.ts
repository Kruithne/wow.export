/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import path from 'node:path';
import util from 'node:util';
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import Constants from './constants';
import BufferWrapper from './buffer';

type Primitive = string | number | boolean;

/**
 * Async wrapper for the fetch() API.
 * @param url - The URL to GET.
 * @param options - Options to pass to the request.
 * @returns The response object.
 */
export async function get(url: string): Promise<Response> {
	return await fetch(url, {
		headers: {
			'User-Agent': Constants.USER_AGENT
		},

		redirect: 'follow'
	});
}

/**
 * Dispatch an async handler for an array of items with a limit to how
 * many can be resolving at once.
 * @param items - Each one is passed to the handler.
 * @param handler - Async function to call for each item.
 * @param limit - This many will be resolving at any given time.
 */
export async function queue(items: Array<Primitive>, handler: (key: Primitive) => Promise<void>, limit: number): Promise<void> {
	return new Promise((resolve, reject) => {
		let free = limit;
		let complete = -1;
		let index = 0;

		const check = () => {
			complete++;
			free++;

			while (free > 0 && index < items.length) {
				handler(items[index]).then(check).catch(reject);
				index++; free--;
			}

			if (complete === items.length)
				return resolve();
		};

		check();
	});
}

/**
 * Ping a URL and measure the response time.
 * @throws {@link error} On error or HTTP code other than 200.
 * @param url - The URL to ping.
 */
export async function ping (url: string): Promise<number> {
	const pingStart = Date.now();

	await get(url);
	return (Date.now() - pingStart);
}

/**
 * Attempt to parse JSON, returning undefined on failure.
 * @param data - The JSON string to parse.
 * @returns The parsed object or undefined.
 */
export function parseJSON(data: string): object|undefined {
	try {
		return JSON.parse(data);
	} catch (e) {
		return undefined;
	}
}

/**
 * Read a JSON file from disk.
 * @param file - JSON file to read.
 * @param ignoreComments - If true, will remove lines starting with //.
 * @returns The parsed JSON object or NULL on error.
 */
export async function readJSON(file: string, ignoreComments: boolean = false) {
	try {
		const raw = await fs.promises.readFile(file, 'utf8');
		if (ignoreComments)
			return JSON.parse(raw.split(/\r?\n/).filter(e => !e.startsWith('//')).join('\n'));

		return JSON.parse(raw);
	} catch (e) {
		return null;
	}
}

/**
 * Download a file.
 * @param url - Remote URL of the file to download.
 * @param out - If provided, the file will be written to disk.
 * @param partialOfs - Partial content start offset.
 * @param partialLen - Partial content size.
 * @param deflate - If true, will deflate data regardless of header.
 * @returns The file contents.
 */
export async function downloadFile(url: string, out?: string, partialOfs: number = -1, partialLen: number = -1, deflate: boolean = false): Promise<BufferWrapper> {
	const res = await fetch(url, {
		headers: {
			'User-Agent': Constants.USER_AGENT,
			'Range': partialOfs > -1 && partialLen > -1 ? util.format('bytes=%d-%d', partialOfs, partialOfs + partialLen - 1) : undefined
		}
	});

	if (!res.ok)
		throw new Error(util.format('Unable to download file %s: HTTP %d %s', url, res.status, res.statusText));

	let data: ArrayBuffer = await res.arrayBuffer();

	// Deflate the file regardless of the headers.
	if (deflate)
		data = await new Promise(resolve => zlib.inflate(data, (err, result) => resolve(result)));

	const wrapped = BufferWrapper.from(data);

	// Write the file to disk if requested.
	if (out) {
		await createDirectory(path.dirname(out));
		await wrapped.writeToFile(out);
	}

	return wrapped;
}

/**
 * Create all directories in a given path if they do not exist.
 * @param dir - Directory path.
 */
export async function createDirectory(dir: string) {
	await fs.promises.mkdir(dir, { recursive: true });
}

/**
 * Returns a promise which resolves after a redraw.
 * This is used to ensure that components have redrawn.
 */
export async function redraw() {
	return new Promise(resolve => {
		// This is a hack to ensure components redraw.
		// https://bugs.chromium.org/p/chromium/issues/detail?id=675795
		requestAnimationFrame(() => requestAnimationFrame(resolve));
	});
}

const JEDEC = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

/**
 * Format a number (bytes) to a displayable file size.
 * Simplified version of https://github.com/avoidwork/filesize.js
 * @param input - Number to format.
 * @returns Formatted string.
 */
export function filesize(input: number): string {
	input = Number(input);
	const isNegative = input < 0;
	const result: Array<number|string> = [];

	// Flipping a negative number to determine the size.
	if (isNegative)
		input = -input;

	// Determining the exponent.
	let exponent = Math.floor(Math.log(input) / Math.log(1024));
	if (exponent < 0)
		exponent = 0;

	// Exceeding supported length, time to reduce & multiply.
	if (exponent > 8)
		exponent = 8;

	// Zero is now a special case because bytes divide by 1.
	if (input === 0) {
		result[0] = 0;
		result[1] = JEDEC[exponent];
	} else {
		const val = input / (Math.pow(2, exponent * 10));

		result[0] = Number(val.toFixed(exponent > 0 ? 2 : 0));

		if (result[0] === 1024 && exponent < 8) {
			result[0] = 1;
			exponent++;
		}

		result[1] = JEDEC[exponent];
	}

	// Decorating a 'diff'.
	if (isNegative)
		result[0] = -result[0];

	return result.join(' ');
}

/**
 * Calculate the hash of a file.
 * @param file - Path to the file to hash.
 * @param method - Hashing method.
 * @param encoding - Output encoding.
 * @returns Hash of the file.
 */
export async function getFileHash(file: string, method: string, encoding: crypto.BinaryToTextEncoding): Promise<string> {
	return new Promise(resolve => {
		const fd = fs.createReadStream(file);
		const hash = crypto.createHash(method);

		fd.on('data', chunk => hash.update(chunk));
		fd.on('end', () => resolve(hash.digest(encoding)));
	});
}

/**
 * Asynchronously check if a file exists.
 * @param file - Path to the file.
 * @returns True if the file exists.
 */
export async function fileExists(file: string): Promise<boolean> {
	try {
		await fs.promises.access(file);
		return true;
	} catch (e) {
		return false;
	}
}

/**
 * Read a portion of a file.
 * @param file - Path of the file.
 * @param offset - Offset to start reading from
 * @param length - Total bytes to read.
 */
export async function readFile(file: string, offset: number, length: number): Promise<BufferWrapper> {
	const fd = await fs.promises.open(file);
	const buf = BufferWrapper.alloc(length);

	await fd.read(buf.raw, 0, length, offset);
	await fd.close();

	return buf;
}

/**
 * Recursively delete a directory and everything inside of it.
 * @param dir - Path to the directory.
 * @returns Total size of all files deleted.
 */
export async function deleteDirectory(dir: string): Promise<number> {
	let deleteSize = 0;
	try {
		const entries = await fs.promises.readdir(dir);
		for (const entry of entries) {
			const entryPath = path.join(dir, entry);
			const entryStat = await fs.promises.stat(entryPath);

			if (entryStat.isDirectory()) {
				deleteSize += await deleteDirectory(entryPath);
			} else {
				await fs.promises.unlink(entryPath);
				deleteSize += entryStat.size;
			}
		}

		await fs.promises.rmdir(dir);
	} catch (e) {
		// Something failed to delete.
	}

	return deleteSize;
}

/**
 * Return a formatted representation of seconds (e.g 26 -> 00:26)
 * @param seconds - Seconds to format.
 * @returns Formatted string.
 */
export function formatPlaybackSeconds(seconds: number): string {
	if (isNaN(seconds))
		return '00:00';

	return Math.floor(seconds / 60).toString().padStart(2, '0') + ':' + Math.round(seconds % 60).toString().padStart(2, '0');
}