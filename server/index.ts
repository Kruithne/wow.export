/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import http from 'http';

function make_generic_response(status_code: number): Response {
	return new Response(http.STATUS_CODES[status_code], { status: status_code });
}

const server = Bun.serve({
	port: 3001, // Do not change without consulting @Kruithne
	development: false,

	fetch(req) {
		console.log(req);
		return new Response('You\'ve reached wow.export.net, please leave a message after the beep.');
	},

	error(error: Error) {
		console.error(error);
		return make_generic_response(500); // Internal Server Error
	}
});

console.log(`Ready for connections ${server.port}...`);