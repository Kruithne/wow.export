const log_color = (color, text) => `${Bun.color(color, 'ansi_16m')}${text}\x1b[0m`;

export const log = {
	error: (msg, ...params) => log.print(log_color('red', 'ERR ') + msg, ...params),
	warn: (msg, ...params) => log.print(log_color('yellow', 'WARN ') + msg, ...params),
	success: (msg, ...params) => log.print(log_color('green', 'DONE ') + msg, ...params),
	info: (msg, ...params) => log.print(log_color('cyan', 'INFO ') + msg, ...params),
	print: (msg, ...params) => console.log(msg.replace(/\*([^*]+)\*/gm, (m, g1) => log_color('cyan', g1)), ...params)
};

export { log_color };
