import fs from 'node:fs';
import util from 'node:util';

const MAX_LOG_POOL = 10000;
const MAX_DRAIN_PER_TICK = 50;

let mark_timer = 0;
let is_clogged = false;
let stream = null;
const pool = [];

const get_timestamp = () => {
	const time = new Date();
	return util.format(
		'%s:%s:%s',
		time.getHours().toString().padStart(2, '0'),
		time.getMinutes().toString().padStart(2, '0'),
		time.getSeconds().toString().padStart(2, '0'));
};

const drain_pool = () => {
	is_clogged = false;

	if (pool.length === 0)
		return;

	let ticks = 0;
	while (!is_clogged && ticks < MAX_DRAIN_PER_TICK && pool.length > 0) {
		is_clogged = !stream.write(pool.shift());
		ticks++;
	}

	if (!is_clogged && pool.length > 0)
		process.nextTick(drain_pool);
};

export const time_log = () => {
	mark_timer = Date.now();
};

export const time_end = (label, ...params) => {
	write(label + ' (%dms)', ...params, (Date.now() - mark_timer));
};

export const write = (...parameters) => {
	const line = '[' + get_timestamp() + '] ' + util.format(...parameters) + '\n';

	if (!stream) {
		console.log(line.trimEnd());
		return;
	}

	if (!is_clogged) {
		is_clogged = !stream.write(line);
	} else {
		if (pool.length < MAX_LOG_POOL)
			pool.push(line);
		else if (pool.length === MAX_LOG_POOL)
			pool.push('[' + get_timestamp() + '] WARNING: Log pool overflow - some log entries have been truncated.\n');
	}

	console.log(line.trimEnd());
};

export const init = (log_path) => {
	stream = fs.createWriteStream(log_path);
	stream.on('drain', drain_pool);
};
