import constants from './constants.js';
import log from './log.js';

export const get = async (url) => {
	const fetch_options = {
		cache: 'no-cache',
		headers: { 'User-Agent': constants.USER_AGENT },
		redirect: 'follow',
		signal: AbortSignal.timeout(30000)
	};

	let index = 1;
	let res = null;
	const url_stack = Array.isArray(url) ? url : [url];

	while ((res === null || !res.ok) && url_stack.length > 0) {
		const current = url_stack.shift();
		log.write('get -> [%d/%d]: %s', index, url_stack.length + index, current);

		try {
			res = await fetch(current, fetch_options);
			log.write('get -> [%d][%d] %s', index++, res.status, current);
		} catch (error) {
			log.write('fetch failed %s: %s', current, error.message);
			index++;
			if (url_stack.length === 0)
				throw error;
		}
	}

	return res;
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
				index++;
				free--;
			}

			if (complete === items.length)
				return resolve();
		};

		check();
	});
};

export const ping = async (url) => {
	const start = Date.now();
	await get(url);
	return Date.now() - start;
};

export const parseJSON = (data) => {
	try {
		return JSON.parse(data);
	} catch {
		return undefined;
	}
};

export const getJSON = async (url) => {
	const res = await get(url);
	if (!res.ok)
		throw new Error('Unable to request JSON from end-point. HTTP ' + res.status + ' ' + res.statusText);

	return res.json();
};

export const redraw = async () => {
	return new Promise(resolve => {
		requestAnimationFrame(() => requestAnimationFrame(resolve));
	});
};

const JEDEC = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

export const filesize = (input) => {
	if (isNaN(input))
		return input;

	input = Number(input);
	const is_negative = input < 0;
	const result = [];

	if (is_negative)
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

	if (is_negative)
		result[0] = -result[0];

	return result.join(' ');
};

export const batchWork = async (name, work, processor, batch_size = 1000) => {
	return new Promise((resolve, reject) => {
		let index = 0;
		const total = work.length;
		const start_time = Date.now();
		let last_pct = 0;

		log.write('Starting batch work "%s" with %d items...', name, total);

		const channel = new MessageChannel();
		channel.port2.onmessage = () => process_batch();
		const schedule_next = () => channel.port1.postMessage(null);

		const cleanup = () => {
			channel.port1.close();
			channel.port2.close();
		};

		const process_batch = () => {
			try {
				const end = Math.min(index + batch_size, total);

				for (let i = index; i < end; i++)
					processor(work[i], i);

				index = end;

				const pct = Math.floor((index / total) * 100);
				if (pct >= last_pct + 10 && pct < 100) {
					log.write('Batch work "%s" progress: %d%% (%d/%d)', name, pct, index, total);
					last_pct = pct;
				}

				if (index < total) {
					schedule_next();
				} else {
					log.write('Batch work "%s" completed in %dms (%d items)', name, Date.now() - start_time, total);
					cleanup();
					resolve();
				}
			} catch (error) {
				cleanup();
				reject(error);
			}
		};

		process_batch();
	});
};

export const formatPlaybackSeconds = (seconds) => {
	if (isNaN(seconds))
		return '00:00';

	return Math.floor(seconds / 60).toString().padStart(2, '0') + ':' + Math.round(seconds % 60).toString().padStart(2, '0');
};

export const fileExists = async (path) => {
	const { fs } = await import('../views/main/rpc.js');
	return fs.exists(path);
};

export const createDirectory = async (path) => {
	const { fs } = await import('../views/main/rpc.js');
	return fs.mkdir(path);
};

export default {
	getJSON,
	parseJSON,
	filesize,
	ping,
	get,
	queue,
	redraw,
	formatPlaybackSeconds,
	batchWork,
	fileExists,
	createDirectory
};
