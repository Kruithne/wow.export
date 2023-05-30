/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */

const server = Bun.serve({
	port: 3001, // Do not change without consulting @Kruithne
	development: false,

	fetch(req) {
		console.log(req);
		return new Response('You\'ve reached wow.export.net, please leave a message after the beep.');
	},
});

console.log(`Ready for connections ${server.port}...`);