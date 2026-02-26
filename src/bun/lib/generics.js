import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

import * as log from './log.js';
import * as constants from './constants.js';
import BufferWrapper from './buffer.js';

const JEDEC = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

export const get = async (url) => {
	const fetch_options = {
		cache: 'no-cache',
		headers: {
			'User-Agent': constants.USER_AGENT,
		},

		redirect: 'follow',
		signal: AbortSignal.timeout(30000)
	};

	let index = 1;
	let res = null;

	const url_stack = Array.isArray(url) ? url : [url];

	while ((res === null || !res.ok) && url_stack.length > 0) {
		const url = url_stack.shift();
		log.write(`get -> [${index}/${url_stack.length + index}]: ${url}`);

		try {
			res = await fetch(url, fetch_options);
			log.write(`get -> [${index++}][${res.status}] ${url}`);
		} catch (error) {
			log.write(`fetch failed ${url}: ${error.message}`);
			index++;
			if (url_stack.length === 0)
				throw error;
		}
	}

	return res;
};

export const getJSON = async (url) => {
	const res = await get(url);
	if (!res.ok)
		throw new Error(`Unable to request JSON from end-point. HTTP ${res.status} ${res.statusText}`);

	return res.json();
};

export const readJSON = async (file, ignoreComments = false) => {
	try {
		const raw = await fsp.readFile(file, 'utf8');
		if (ignoreComments)
			return JSON.parse(raw.split(/\r?\n/).filter(e => !e.startsWith('//')).join('\n'));

		return JSON.parse(raw);
	} catch (e) {
		if (e.code === 'EPERM')
			throw e;

		return null;
	}
};

export const parseJSON = (data) => {
	try {
		return JSON.parse(data);
	} catch (e) {
		return undefined;
	}
};

export const queue = async (items, handler, limit) => {
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

export const ping = async (url) => {
	const pingStart = Date.now();

	await get(url);
	return (Date.now() - pingStart);
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

		log.write('Requesting data from %s (offset: %d, length: %d)', url, partialOfs, partialLen);

		const protocol = url.startsWith('https') ? https : http;
		const req = protocol.get(url, options, res => {
			if (res.statusCode == 301 || res.statusCode == 302) {
				log.write('Got redirect to ' + res.headers.location);
				return resolve(requestData(res.headers.location, partialOfs, partialLen));
			}

			if (res.statusCode < 200 || res.statusCode > 302)
				return reject(new Error(`Status Code: ${res.statusCode}`));

			const chunks = [];
			let downloaded = 0;
			let last_logged_pct = 0;
			const totalSize = parseInt(res.headers['content-length'] || '0');

			if (totalSize > 0)
				log.write('Starting download: %d bytes expected', totalSize);

			res.on('data', chunk => {
				chunks.push(chunk);
				downloaded += chunk.length;

				if (totalSize > 0) {
					const pct = Math.floor((downloaded / totalSize) * 100);
					const pct_threshold = Math.floor(pct / 25) * 25;

					if (pct_threshold > last_logged_pct && pct_threshold < 100) {
						log.write('Download progress: %d/%d bytes (%d%%)', downloaded, totalSize, pct);
						last_logged_pct = pct_threshold;
					}
				}
			});

			res.on('end', () => {
				log.write('Download complete: %d bytes received', downloaded);
				resolve(Buffer.concat(chunks));
			});
		});

		req.setTimeout(60000, () => {
			req.destroy();
			reject(new Error('Request timeout after 60s'));
		});

		req.on('error', reject);
		req.end();
	});
}

export const downloadFile = async (url, out, partialOfs = -1, partialLen = -1, deflate = false) => {
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

export const createDirectory = async (dir) => {
	await fsp.mkdir(dir, { recursive: true });
};

export const filesize = (input) => {
	if (isNaN(input))
		return input;

	input = Number(input);
	const isNegative = input < 0;
	const result = [];

	if (isNegative)
		input = -input;

	let exponent = Math.floor(Math.log(input) / Math.log(1024));
	if (exponent < 0)
		exponent = 0;

	if (exponent > 8)
		exponent = 8;

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

	if (isNegative)
		result[0] = -result[0];

	return result.join(' ');
};

export const getFileHash = async (file, method, encoding) => {
	return new Promise(resolve => {
		const fd = fs.createReadStream(file);
		const hash = crypto.createHash(method);

		fd.on('data', chunk => hash.update(chunk));
		fd.on('end', () => resolve(hash.digest(encoding)));
	});
};

export const fileExists = async (file) => {
	try {
		await fsp.access(file);
		return true;
	} catch (e) {
		return false;
	}
};

export const directoryIsWritable = async (dir) => {
	try {
		await fsp.access(dir, fs.constants.W_OK);
		return true;
	} catch (e) {
		return false;
	}
};

export const readFile = async (file, offset, length) => {
	const fd = await fsp.open(file);
	const buf = BufferWrapper.alloc(length);

	await fd.read(buf.raw, 0, length, offset);
	await fd.close();

	return buf;
};

export const deleteDirectory = async (dir) => {
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
		// deletion failure
	}

	return deleteSize;
};

export const batchWork = async (name, work, processor, batch_size = 1000) => {
	log.write('Starting batch work "%s" with %d items...', name, work.length);
	const start_time = Date.now();

	for (let i = 0; i < work.length; i++)
		processor(work[i], i);

	const duration = Date.now() - start_time;
	log.write('Batch work "%s" completed in %dms (%d items)', name, duration, work.length);
};
