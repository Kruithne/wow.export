/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const zlib = require('zlib');
const crypto = require('crypto');
const BufferWrapper = require('./buffer');
const constants = require('./constants');
const log = require('./log');
const https = require('https');
const http = require('http');

/**
 * Async wrapper for http.get()/https.get().
 * The module used is determined by the prefix of the URL.
 * @param {string|string[]} url 
 */
const get = async (url) => {
	const fetch_options = {
		cache: 'no-cache',
		headers: {
			'User-Agent': constants.USER_AGENT,
		},

		redirect: 'follow'
	};

	let index = 1;
	let res = null;

	const url_stack = Array.isArray(url) ? url : [url];

	while ((res === null || !res.ok) && url_stack.length > 0) {
		const url = url_stack.shift();
		res = await fetch(url, fetch_options);

		log.write(`get -> [${index++}][${res.status}] ${url}`);
	}

	return res;
};

/**
 * Dispatch an async handler for an array of items with a limit to how
 * many can be resolving at once.
 * @param {Array} items Each one is passed to the handler.
 * @param {function} handler Must be async.
 * @param {number} limit This many will be resolving at any given time.
 */
const queue = async (items, handler, limit) => {
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
};

/**
 * Ping a URL and measure the response time.
 * Not perfectly accurate, but good enough for our purposes.
 * Throws on error or HTTP code other than 200.
 * @param {string} url 
 */
const ping = async (url) => {
	const pingStart = Date.now();
	
	await get(url);
	return (Date.now() - pingStart);
};

/**
 * Attempt to parse JSON, returning undefined on failure.
 * Inline function to keep code paths clean of unnecessary try/catch blocks.
 * @param {string} data 
 * @returns {object}
 */
const parseJSON = (data) => {
	try {
		return JSON.parse(data);
	} catch (e) {
		return undefined;
	}
};

/**
 * Obtain JSON from a remote end-point.
 * @param {string} url 
 */
const getJSON = async (url) => {
	const res = await get(url);
	if (!res.ok)
		throw new Error(`Unable to request JSON from end-point. HTTP ${res.status} ${res.statusText}`);
	
	return res.json();
};

/**
 * Read a JSON file from disk, returning NULL on error.
 * Provides basic pruning for comments (lines starting with //) with ignoreComments.
 * @param {string} file 
 * @param {boolean} ignoreComments
 */
const readJSON = async (file, ignoreComments = false) => {
	try {
		const raw = await fsp.readFile(file, 'utf8');
		if (ignoreComments)
			return JSON.parse(raw.split(/\r?\n/).filter(e => !e.startsWith('//')).join('\n'));

		return JSON.parse(raw);
	} catch (e) {
		return null;
	}
};

function requestData(url, partialOfs, partialLen) {
	return new Promise((resolve, reject) => {
		const options = {
			headers: {
				'User-Agent': constants.USER_AGENT
			}
		};
		
		if (partialOfs > -1 && partialLen > -1)
			options.headers.Range = `bytes=${partialOfs}-${partialOfs + partialLen - 1}`;
		
		const protocol = url.startsWith('https') ? https : http;
		const req = protocol.get(url, options, res => {
			if (res.statusCode == 301 || res.statusCode == 302) {
				log.write("Got redirect to " + res.headers.location);
				return resolve(requestData(res.headers.location, partialOfs, partialLen));
			}

			if (res.statusCode < 200 || res.statusCode > 302)
				return reject(new Error(`Status Code: ${res.statusCode}`));
			
			const chunks = [];
			res.on('data', chunk => chunks.push(chunk));
			res.on('end', () => resolve(Buffer.concat(chunks)));
		});
		
		req.on('error', reject);
		req.end();
	});
}

/**
* Download a file (optionally to a local file).
* GZIP deflation will be used if headers are set.
* Data is always returned even if `out` is provided.
* @param {string|string[]} url Remote URL of the file to download.
* @param {string} out Optional file to write file to.
* @param {number} partialOfs Partial content start offset.
* @param {number} partialLen Partial content size.
* @param {boolean} deflate If true, will deflate data regardless of header.
*/
const downloadFile = async (url, out, partialOfs = -1, partialLen = -1, deflate = false) => {
	const url_stack = Array.isArray(url) ? url : [url];
	
	for (const currentUrl of url_stack) {
		try {
			log.write(`downloadFile -> ${currentUrl}`);

			let data = await requestData(currentUrl, partialOfs, partialLen);

			if (deflate) {
				data = await new Promise((resolve, reject) => {
					zlib.inflate(data, (err, result) => {
						err ? reject(err) : resolve(result);
					});
				});
			}

			const wrapped = new BufferWrapper(data);

			if (out) {
				await createDirectory(path.dirname(out));
				await wrapped.writeToFile(out);
			}

			return wrapped;
		} catch (error) {
			log.write(`Failed to download from ${currentUrl}: ${error.message}`);
			log.write(error);
		}
	}
	
	throw new Error('All download attempts failed.');
};

/**
 * Create all directories in a given path if they do not exist.
 * @param {string} dir Directory path.
 */
const createDirectory = async (dir) => {
	await fsp.mkdir(dir, { recursive: true });
};

/**
 * Returns a promise which resolves after a redraw.
 * This is used to ensure that components have redrawn.
 */
const redraw = async () => {
	return new Promise(resolve => {
		// This is a hack to ensure components redraw.
		// https://bugs.chromium.org/p/chromium/issues/detail?id=675795
		requestAnimationFrame(() => requestAnimationFrame(resolve));
	});
};

const JEDEC = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

/**
 * Format a number (bytes) to a displayable file size.
 * Simplified version of https://github.com/avoidwork/filesize.js
 * @param {number} input 
 */
const filesize = (input) => {
	if (isNaN(input))
		return input;

	input = Number(input);
	const isNegative = input < 0;
	const result = [];

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
	
	return result.join(" ");
};

/**
 * Calculate the hash of a file.
 * @param {string} file Path to the file to hash.
 * @param {string} method Hashing method.
 * @param {string} encoding Output encoding.
 */
const getFileHash = async (file, method, encoding) => {
	return new Promise(resolve => {
		const fd = fs.createReadStream(file);
		const hash = crypto.createHash(method);
		
		fd.on('data', chunk => hash.update(chunk));
		fd.on('end', () => resolve(hash.digest(encoding)));
	});
};

/**
 * Wrapper for asynchronously checking if a file exists.
 * @param {string} file 
 */
const fileExists = async (file) => {
	try {
		await fsp.access(file);
		return true;
	} catch (e) {
		return false;
	}
};

/**
 * Read a portion of a file.
 * @param {string} file Path of the file.
 * @param {number} offset Offset to start reading from
 * @param {number} length Total bytes to read.
 */
const readFile = async (file, offset, length) => {
	const fd = await fsp.open(file);
	const buf = BufferWrapper.alloc(length);

	await fd.read(buf.raw, 0, length, offset);
	await fd.close();

	return buf;
};

/**
 * Recursively delete a directory and everything inside of it.
 * Returns the total size of all files deleted.
 * @param {string} dir 
 */
const deleteDirectory = async (dir) => {
	let deleteSize = 0;
	try {
		const entries = await fsp.readdir(dir);
		for (const entry of entries) {
			const entryPath = path.join(dir, entry);
			const entryStat = await fsp.stat(entryPath);

			if (entryStat.isDirectory()) {
				deleteSize += await deleteDirectory(entryPath);
			} else {
				await fsp.unlink(entryPath);
				deleteSize += entryStat.size;
			}
		}

		await fsp.rmdir(dir);
	} catch (e) {
		// Something failed to delete.
	}
	
	return deleteSize;
};

/**
 * Return a formatted representation of seconds.
 * Example: 26 will return 00:26
 * @param {number} seconds 
 * @returns {string}
 */
const formatPlaybackSeconds = (seconds) => {
	if (isNaN(seconds))
		return '00:00';
		
	return Math.floor(seconds / 60).toString().padStart(2, 0) + ':' + Math.round(seconds % 60).toString().padStart(2, 0);
};

module.exports = { 
	getJSON,
	readJSON,
	parseJSON,
	filesize,
	getFileHash,
	createDirectory,
	downloadFile,
	ping,
	get,
	queue,
	redraw,
	fileExists,
	readFile,
	deleteDirectory,
	formatPlaybackSeconds
};
