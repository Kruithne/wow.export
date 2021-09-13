/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const util = require('util');
const EventEmitter = require('events');
const generics = require('../generics');
const core = require('../core');
const log = require('../log');

/**
 * Defines the maximum char length of the internal buffer string.
 * @type {number}
 */
const MAX_BUFFER_SIZE = 1024 * 1024;

class RCPConnection extends EventEmitter {
	/**
	 * Construct a new RCPConnection instance.
	 * @param {number} id
	 * @param {net.Socket} socket 
	 */
	constructor(id, socket) {
		super();

		this.id = id;
		this.socket = socket;
		this.socket.setEncoding('utf8');

		this.buffer = '';

		socket.on('data', data => this.onData(data));
		socket.on('error', err => this.onError(err));
		socket.on('end', () => this.onEnd());

		this.log('Connection established from [%s]:%d', socket.remoteAddress, socket.remotePort);

		// Indicate clearly that a remote connection is active, and provide immediate
		// options for the user to disconnect it or disable remote connections entirely.
		core.setToast('success', util.format('New remote connection from %s (%d)', socket.remoteAddress, socket.remotePort), {
			'Disconnect': () => { this.disconnect(); },
			'Disable Remote Connections': () => { core.view.config.rcpEnabled = false; }
		}, -1);
	}

	/**
	 * Serialize data and send it to this connection.
	 * @param {number} id
	 * @param {object} [data]
	 * @param {boolean} [end=false]
	 */
	sendData(id, data = {}, end = false) {
		data.id = id;

		const json = JSON.stringify(data);
		const out = json.length + '\0' + json;

		end ? this.socket.end(out) : this.socket.write(out);
	}

	/**
	 * Invoked when this connection receives data.
	 * @param {string} data 
	 */
	onData(data) {
		this.buffer += data;
		this.processBuffer();
	}

	/**
	 * Process the internal buffer for messages.
	 */
	processBuffer() {
		// Enforce a limit on the internal buffer to prevent flooding.
		if (this.buffer >= MAX_BUFFER_SIZE) {
			this.buffer = '';
			return this.sendData('ERR_DATA_FLOOD', {}, true);
		}

		const delimiter = this.buffer.indexOf('\0');
		if (delimiter > 0) {
			const size = parseInt(this.buffer.substring(0, delimiter));
			if (isNaN(size) || size <= 0)
				return this.sendData('ERR_INVALID_SEGMENTATION', {}, true);

			const offset = delimiter + 1;
			const availableSize = this.buffer.length - (offset);
			if (availableSize >= size) {
				// Enough data available in buffer to process this payload.
				const data = this.buffer.substring(offset, offset + size);
				const json = generics.parseJSON(data);

				if (json === undefined)
					return this.sendData('ERR_INVALID_JSON', {}, true);

				this.emit('payload', json);
				this.buffer = this.buffer.substring(offset + size);

				if (this.buffer.length > 0)
					this.processBuffer();
			}
		}
	}

	/**
	 * Write a message to the log, prefixed with this RCP ID.
	 * @param {string} message 
	 */
	log(message, ...params) {
		log.write('[RCP:' + this.id + '] ' + message, ...params);
	}

	/**
	 * Invoked when this connection ends normally.
	 */
	onEnd() {
		this.log('Disconnected (end)');
		this.emit('end');
	}

	/**
	 * Invoked when this connection encounters an error.
	 * @param {Error} err 
	 */
	onError(err) {
		this.log('Disconnected (%s)', err.message);
		this.emit('end');
	}

	/**
	 * Forcibly disconnect this connection.
	 */
	disconnect() {
		this.socket.destroy();
	}
}

module.exports = RCPConnection;