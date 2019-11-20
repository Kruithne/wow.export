const path = require('path');
const util = require('util');
const fs = require('fs');
const fsp = fs.promises;
const readline = require('readline');
const zlib = require('zlib');
const BufferWrapper = require('./buffer');

const MAX_HTTP_REDIRECT = 4;

/**
 * Async wrapper for http.get()/https.get().
 * The module used is determined by the prefix of the URL.
 * @param {string} url 
 * @param {object} options
 */
const get = async (url, options = {}) => {
	const http = require(url.startsWith('https') ? 'https' : 'http');
	let redirects = 0;
	let res = null;

	// Follow 301 redirects up to a count of MAX_HTTP_REDIRECT.
	while (!res || (res.statusCode === 301 && redirects < MAX_HTTP_REDIRECT)) {
		res = await new Promise((resolve, reject) => http.get(url, options, resolve).on('error', reject));
		redirects++;
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
 * Consume the entire contents of a stream as a UTF8 string.
 * @param {object} stream 
 */
const consumeUTF8Stream = async (stream) => {
	return new Promise(resolve => {
		let data = '';
		stream.setEncoding('utf8');
		stream.on('data', chunk => data += chunk);
		stream.on('end', () => resolve(data));
	});
};

/**
 * Obtain JSON from a remote end-point.
 * @param {string} url 
 */
const getJSON = async (url) => {
	let redirects = 0;
	let res = await get(url);
	
	// Abort with anything other than HTTP 200 OK at this point.
	if (res.statusCode !== 200)
		throw new Error('Unable to request JSON from end-point. HTTP ' + res.statusCode);

	return JSON.parse(await consumeUTF8Stream(res));
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

/**
 * Download a file (optionally to a local file).
 * GZIP deflation will be used if available.
 * Data is always returned even if `out` is provided.
 * @param {string} url Remote URL of the file to download.
 * @param {string} out Optional file to write file to.
 */
const downloadFile = async (url, out, partialOfs = -1, partialLen = -1) => {
	const headers = {'Accept-Encoding': 'gzip'};
	if (partialOfs > -1 && partialLen > -1)
		headers.Range = util.format('bytes=%d-%d', partialOfs, partialOfs + partialLen - 1);

	const res = await get(url, { headers });

	if (res.statusCode !== 200 && res.statusCode !== 206)
		throw new Error(util.format('Unable to download file %s: HTTP %d', url, res.statusCode));

	let totalBytes = 0;
	let buffers = [];

	let source = res;
	if (res.headers['content-encoding'] === 'gzip') {
		source = zlib.createGunzip();
		res.pipe(source);
	}

	await new Promise(resolve => {
		source.on('data', chunk => {
			totalBytes += chunk.byteLength;
			buffers.push(chunk);
		});

		source.on('end', resolve);
	});

	const merged = Buffer.concat(buffers, totalBytes);

	// Write the file to disk if requested.
	if (out) {
		await createDirectory(path.dirname(out));
		await fsp.writeFile(out, merged);
	}

	return new BufferWrapper(merged);
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
	return new Promise(res => fsp.access(file).then(res(true)).catch(res(false)));
};

/**
 * Read all lines of a file.
 * @param {string} file Path to the file.
 * @param {function} handler Invoked with every line.
 * @param {string} encoding File encoding, defaults to utf8.
 */
const readFileLines = async(file, handler, encoding = 'utf8') => {
	return new Promise((resolve, reject) => {
		const input = fs.createReadStream(file, { encoding });
		input.on('error', reject);
		input.on('end', resolve);

		const rl = readline.createInterface({ input });
		rl.on('line', handler);
	});
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
 * @param {string} dir 
 */
const deleteDirectory = async (dir) => {
	const entries = await fsp.readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory())
			await deleteDirectory(entryPath);
		else
			await fsp.unlink(entryPath);
	}
};

module.exports = { 
	getJSON,
	readJSON,
	filesize,
	getFileHash,
	createDirectory,
	downloadFile,
	ping,
	get,
	consumeUTF8Stream,
	queue,
	redraw,
	readFileLines,
	fileExists,
	readFile,
	deleteDirectory
};