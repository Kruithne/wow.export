// This file defines all built-in modules to be made available to the application.
const path = require('path');
const util = require('util');
const fs = require('fs');
const fsp = fs.promises;
const assert = require('assert').strict;
const node_crypto = require('crypto');
const zlib = require('zlib');
const EventEmitter = require('events');
const cp = require('child_process');
const os = require('os');

// For debug builds, we need to inject them into the global context.
// For reason builds, the above constants will be packaged inside the bundled scope.
if (!BUILD_RELEASE) {
	window.path = path;
	window.util = util;
	window.fs = fs;
	window.fsp = fsp;
	window.assert = assert;
	window.node_crypto = node_crypto;
	window.zlib = zlib;
	window.EventEmitter = EventEmitter;
	window.cp = cp;
	window.os = os;
}