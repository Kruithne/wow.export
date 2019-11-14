const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const BufferWrapper = require('./buffer');

const MAX_HTTP_REDIRECT = 4;

/**
 * Async wrapper for http.get()/https.get().
 * The module used is determined by the prefix of the URL.
 * @param {string} url 
 */
const get = async (url) => {
	return new Promise((resolve, reject) => {
		const http = require(url.startsWith('https') ? 'https' : 'http');
		http.get(url, res => resolve(res)).on('error', e => reject(e));
	});
};

/**
 * Dispatch an async handler for an array of items with a limit to how
 * many can be resolving at once.
 * @param {Array} items Each one is passed to the handler.
 * @param {function} handler Must be async.
 * @param {number} limit This many will be resolving at any given time.
 */
const queue = async (items, handler, limit) => {
	return new Promise(resolve => {
		let free = limit;
		let complete = -1;
		let index = 0;
		const check = () => {
			complete++;
			free++;

			while (free > 0 && index < items.length) {
				handler(items[index]).then(check);
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
 * Consume the entire contents of a stream into a buffer.
 * @param {object} stream 
 * @param {number} contentLength Expected content length.
 * @param {function} reporter Reporter function
 */
const consumeStream = async (stream, contentLength, reporter) => {
	return new Promise(resolve => {
		const buf = BufferWrapper.alloc(contentLength);
		stream.on('data', chunk => {
			buf.writeBuffer(chunk);

			// Report progress to provided reporter function.
			if (reporter)
				reporter(buf.offset, contentLength);
		});

		stream.on('end', () => {
			buf.seek(0); // Reset position.
			resolve(buf);
		});
	});
};

/**
 * Obtain JSON from a remote end-point.
 * @param {string} url 
 */
const getJSON = async (url) => {
	let redirects = 0;
	let res = await get(url);

	// Follow 301 redirects up to a count of MAX_HTTP_REDIRECT.
	while (res.statusCode === 301 && redirects < MAX_HTTP_REDIRECT) {
		res = await get(res.headers.location);
		redirects++;
	}
	
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
 * Download a file to the given output path.
 * @param {string} url 
 * @param {string} out 
 */
const downloadFile = async (url, out) =>{
	await createDirectory(path.dirname(out));
	const res = await get(url);

	return new Promise(resolve => {
		const fd = fs.createWriteStream(out);
		fd.on('finish', () => {
			fd.close();
			resolve();
		});
		res.pipe(fd);
	});
};

/**
 * Create all directories in a given path if they do not exist.
 * @param {string} dir Directory path.
 */
const createDirectory = async (dir) => {
	await fsp.access(dir).catch(async () => {
		await fsp.mkdir(dir, { recursive: true });
	});
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
	consumeStream,
	queue,
	redraw
};