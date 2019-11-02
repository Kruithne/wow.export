const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const log = require('./log');

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
 * Ping a URL and measure the response time.
 * Not perfectly accurate, but good enough for our purposes.
 * Returns -1 on error or HTTP code other than 200.
 * @param {string} url 
 */
const ping = async (url) => {
    const pingStart = Date.now();
    
    try {
        await get(url);
        return (Date.now() - pingStart);
    } catch (e) {
        log.write('Failed ping to %s: %s', url, e.message);
    }

    return -1;
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

module.exports = { getJSON, filesize, getFileHash, createDirectory, downloadFile, ping };