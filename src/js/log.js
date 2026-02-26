import { log as rpc_log } from '../views/main/rpc.js';
import * as platform from './platform.js';
import constants from './constants.js';

let mark_timer = 0;

const get_timestamp = () => {
	const time = new Date();
	return String(time.getHours()).padStart(2, '0')
		+ ':' + String(time.getMinutes()).padStart(2, '0')
		+ ':' + String(time.getSeconds()).padStart(2, '0');
};

const format_args = (...params) => {
	if (params.length === 0)
		return '';

	let msg = String(params[0]);
	let arg_idx = 1;

	msg = msg.replace(/%[sdoO%]/g, (match) => {
		if (match === '%%')
			return '%';

		if (arg_idx >= params.length)
			return match;

		const val = params[arg_idx++];

		switch (match) {
			case '%s': return String(val);
			case '%d': return Number(val).toString();
			case '%o':
			case '%O':
				try { return JSON.stringify(val); }
				catch { return String(val); }
		}
		return match;
	});

	while (arg_idx < params.length)
		msg += ' ' + String(params[arg_idx++]);

	return msg;
};

export const write = (...params) => {
	const line = '[' + get_timestamp() + '] ' + format_args(...params);
	rpc_log.info(line);
	console.log(line);
};

export const timeLog = () => {
	mark_timer = Date.now();
};

export const timeEnd = (label, ...params) => {
	write(label + ' (%dms)', ...params, (Date.now() - mark_timer));
};

export const openRuntimeLog = () => {
	platform.open_path(constants.RUNTIME_LOG);
};

export default { write, timeLog, timeEnd, openRuntimeLog };
