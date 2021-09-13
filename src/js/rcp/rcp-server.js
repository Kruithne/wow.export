/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const net = require('net');
const core = require('../core');
const log = require('../log');
const constants = require('../constants');
const listfile = require('../casc/listfile');
const RCPConnection = require('./rcp-connection');
const { resetAllToDefault, resetToDefault } = require('../config');

const CASCLocal = require('../casc/casc-source-local');
const CASCRemote = require('../casc/casc-source-remote');

class RCPServer {
	constructor() {
		this.connections = new Map();
		this.server = null;

		this.isBusy = false;
		this.queue = [];
		this.hooks = new Map();
	}

	/**
	 * Returns true of the RCP server is currently running.
	 * @returns {boolean}
	 */
	get isRunning() {
		return this.server !== null;
	}

	/**
	 * The amount of active connections.
	 * @returns {number}
	 */
	get numConnections() {
		return this.connections.size;
	}

	/**
	 * Invoked when the application loads.
	 */
	load() {
		if (core.view.config.rcpEnabled)
			this.start();

		// Track if the user enables/disables RCP.
		core.view.$watch('config.rcpEnabled', state => {
			if (state !== this.isRunning)
				state ? this.start() : this.stop();
		});

		// Monitor when the application becomes non-busy and check our internal
		// action queue. If holding, dispatch first payload to restart queue.
		core.view.$watch('isBusy', state => {
			if (state === 0 && !this.isBusy && this.queue.length > 0) {
				const next = this.queue.shift();
				this.handlePayload(next.data, next.connection);
			}

			this.dispatchHook('HOOK_BUSY_STATE', { busy: state > 0 || this.isBusy });
		});
	}

	/**
	 * Handle an incoming payload from an RCP client.
	 * @param {object} data 
	 * @param {RCPConnection} connection 
	 */
	async handlePayload(data, connection) {
		// If the application is busy, queue the given payload for layer.
		if (this.isBusy || core.view.isBusy > 0) {
			this.queue.push({ data, connection });
			return;
		}

		// Check for a numeric payload identifier and a matching handler.
		if (typeof data.id === 'string' && SERVER_HANDLERS.hasOwnProperty(data.id)) {
			this.isBusy = true;
			connection.log('Received %s: %o', data.id, data);
			await SERVER_HANDLERS[data.id].call(this, data, connection);
			this.isBusy = false;
		} else {
			connection.log('Received invalid action %s', data.id);
			connection.sendData('ERR_INVALID_ACTION');
		}

		// Resume queue, if necessary.
		if (core.view.isBusy === 0 && this.queue.length > 0) {
			const next = this.queue.shift();
			this.handlePayload(next.data, next.connection);
		}
	}

	/**
	 * Handle an incoming GET_CONFIG payload.
	 * @param {object} data
	 * @param {RCPConnection} client
	 */
	handleGetConfig(data, client) {
		if (typeof data.key === 'string')
			client.sendData('CONFIG_SINGLE', { key: data.key, value: core.view.config[data.key] });
		else
			client.sendData('CONFIG_FULL', { config: core.view.config });
	}

	/**
	 * Handle an incoming SET_CONFIG request.
	 * @param {object} data
	 * @param {RCPConnection} client
	 */
	handleSetConfig(data, client) {
		if (!this.validateParameters(client, data, { key: 'string', value: 'any' }))
			return;

		core.view.config[data.key] = data.value;
		client.sendData('CONFIG_SET_DONE', { key: data.key, value: core.view.config[data.key] });
	}

	/**
	 * Handle an incoming RESET_CONFIG request.
	 * @param {object} data 
	 * @param {RCPConnection} client 
	 */
	handleResetConfig(data, client) {
		if (typeof data.key === 'string') {
			resetToDefault(data.key);
			client.sendData('CONFIG_SINGLE', { key: data.key, value: core.view.config[data.key] });
		} else {
			resetAllToDefault();
			client.sendData('CONFIG_FULL', { config: core.view.config });
		}
	}

	/**
	 * Handle an incoming RESTART_APP request.
	 * @param {object} data 
	 * @param {RCPConnection} client 
	 */
	async handleRestartApp(data, client) {
		// Enforce a small delay to prevent RCP DoS.
		this.isBusy = true;
		core.view.isBusy++;
		await new Promise(res => setTimeout(res, 3000));

		// Restart Chromium.
		chrome.runtime.reload();
	}

	/**
	 * Handle an incoming GET_CONSTANTS request.
	 * @param {object} data 
	 * @param {RCPConnection} client 
	 */
	handleGetConstants(data, client) {
		client.sendData('CONSTANTS', { constants });
	}

	/**
	 * Handle an incoming GET_CDN_REGIONS request.
	 * @param {object} data 
	 * @param {RCPConnection} client 
	 */
	handleGetCDNRegions(data, client) {
		client.sendData('CDN_REGIONS', { regions: core.view.cdnRegions });
	}

	/**
	 * Handle an incoming REGISTER_HOOK request.
	 * @param {object} data 
	 * @param {RCPConnection} client 
	 */
	handleRegisterHook(data, client) {
		if (!this.validateParameters(client, data, { hookID: 'string' }))
			return;

		// Only allow pre-defined hooks to be registered.
		if (!SERVER_HOOKS.includes(data.hookID))
			return client.sendData('ERR_UNKNOWN_HOOK');

		const hookID = data.hookID;
		if (!this.hooks.has(hookID))
			this.hooks.set(hookID, new Set());

		this.hooks.get(hookID).add(client.id);
		client.log('Registered hook %s', hookID);
		client.sendData('HOOK_REGISTERED', { hookID });
	}

	/**
	 * Handle an incoming DEREGISTER_HOOK request.
	 * @param {object} data 
	 * @param {RCPConnection} client 
	 */
	handleDeregisterHook(data, client) {
		if (!this.validateParameters(client, data, { hookID: 'string'}))
			return;

		const hookID = data.hookID;
		const hooks = this.hooks.get(hookID);
		if (hooks) {
			hooks.delete(client.id);

			// Clean-up any empty hook sets.
			if (hooks.size === 0)
				this.hooks.delete(hookID);

			client.log('Deregistered hook %s', hookID);
		}

		client.sendData('HOOK_DEREGISTERED', { hookID });
	}

	/**
	 * Handle an incoming GET_CASC_INFO request.
	 * @param {object} data 
	 * @param {RCPConnection} client 
	 */
	handleGetCASCInfo(data, client) {
		const casc = core.view.casc;
		if (!casc)
			return client.sendData('CASC_UNAVAILABLE');

		client.sendData('CASC_INFO', {
			type: casc.constructor.name,
			build: casc.build,
			buildConfig: casc.buildConfig,
			buildName: casc.getBuildName(),
			buildKey: casc.getBuildKey()
		});
	}

	/**
	 * Handle an incoming LOAD_CASC_LOCAL request.
	 * @param {object} data 
	 * @param {RCPConnection} client 
	 */
	async handleLoadCASCLocal(data, client) {
		// Do not attempt to initialize CASC if it's already active.
		if (core.view.casc)
			return client.sendData('ERR_CASC_ACTIVE');

		if (!this.validateParameters(client, data, { installDirectory: 'string' }))
			return;

		try {
			const casc = new CASCLocal(data.installDirectory);
			await casc.init();

			client._casc = casc;
			client.sendData('CASC_INSTALL_BUILDS', { builds: casc.builds });
		} catch (e) {
			client.sendData('ERR_INVALID_INSTALL');
		}
	}

	/**
	 * Handle an incoming LOAD_CASC_REMOTE request.
	 * @param {object} data 
	 * @param {RCPConnection} client 
	 */
	async handleLoadCASCRemote(data, client) {
		// Do not attempt to initialize CASC if it's already active.
		if (core.view.casc)
			return client.sendData('ERR_CASC_ACTIVE');

		if (!this.validateParameters(client, data, { regionTag: 'string'}))
			return;

		try {
			const casc = new CASCRemote(data.regionTag);
			await casc.init();

			client._casc = casc;
			client.sendData('CASC_INSTALL_BUILDS', { builds: casc.builds });
		} catch (e) {
			client.sendData('ERR_INVALID_INSTALL');
		}
	}

	/**
	 * Handle an incoming LOAD_CASC_BUILD request.
	 * @param {object} data 
	 * @param {RCPConnection} client 
	 */
	async handleLoadCASCBuild(data, client) {
		const casc = client._casc;

		// Sending LOAD_CASC_BUILD before LOAD_CASC_REMOTE/LOAD_CASC_LOCAL is bad.
		if (!casc)
			return client.sendData('ERR_NO_CASC_SETUP');

		if (!this.validateParameters(client, data, { buildIndex: 'number' }))
			return;

		// The given build index must be within the range of our available builds.
		if (data.buildIndex < 0 || data.buildIndex >= casc.builds.length)
			return client.sendData('ERR_INVALID_CASC_BUILD');

		core.view.showLoadScreen();

		try {
			await casc.load(data.buildIndex);
			core.view.setScreen('tab-models');
		} catch (e) {
			log.write('Failed to load CASC: %o', e);
			core.view.setScreen('source-select');

			client.sendData('ERR_CASC_FAILED');
		}

		client._casc = undefined;
		this.handleGetCASCInfo(data, client);
	}

	/**
	 * Handle an incoming CACHE_CLEAR request.
	 * @param {object} data 
	 * @param {RCPConnection} client 
	 */
	handleClearCache(data, client) {
		// Register an event for when the cache is cleared.
		core.events.once('cache-cleared', () => {
			// Remote controller should restart now.
			client.sendData('CACHE_CLEARED');
		});

		// Trigger cache clear.
		core.events.emit('click-cache-clear');
	}

	/**
	 * Handle an incoming LISTFILE_QUERY_ID request.
	 * @param {object} data 
	 * @param {RCPConnection} client 
	 */
	handleListfileQueryID(data, client) {
		if (!listfile.isLoaded())
			return client.sendData('ERR_LISTFILE_NOT_LOADED');

		if (!this.validateParameters(client, data, { fileDataID: 'number' }))
			return;

		const fileDataID = data.fileDataID;
		const fileName = listfile.getByID(fileDataID) ?? '';
		client.sendData('LISTFILE_RESULT', { fileDataID, fileName });
	}

	/**
	 * Handle an incoming LISTFILE_QUERY_NAME request.
	 * @param {object} data 
	 * @param {RCPConnection} client 
	 */
	handleListfileQueryName(data, client) {
		if (!listfile.isLoaded())
			return client.sendData('ERR_LISTFILE_NOT_LOADED');

		if (!this.validateParameters(client, data, { fileName: 'string' }))
			return;

		const fileName = data.fileName;
		const fileDataID = listfile.getByFilename(fileName) ?? 0;
		client.sendData('LISTFILE_RESULT', { fileDataID, fileName });
	}

	/**
	 * Handle an incoming LISTFILE_SEARCH request.
	 * @param {object} data 
	 * @param {RCPConnection} client 
	 */
	handleListfileSearch(data, client) {
		if (!listfile.isLoaded())
			return client.sendData('ERR_LISTFILE_NOT_LOADED');

		if (!this.validateParameters(client, data, { search: 'string' }))
			return;

		const filter = data.useRegularExpression ? new RegExp(data.search) : data.search;
		client.sendData('LISTFILE_SEARCH_RESULT', { entries: listfile.getFilteredEntries(filter) });
	}

	/**
	 * Handle an incoming export request.
	 * @param {string} exportEvent
	 * @param {object} data 
	 * @param {RCPConnection} client 
	 */
	handleExport(exportEvent, data, client) {
		if (!core.view.casc)
			return client.sendData('ERR_NO_CASC');

		if (!this.validateParameters(client, data, { fileDataID: ['number', 'number[]']}))
			return;

		const files = Array.isArray(data.fileDataID) ? data.fileDataID : [data.fileDataID];
		core.events.emit(exportEvent, files);
	}

	/**
	 * Handle an incoming EXPORT_MODEL request.
	 * @param {object} data 
	 * @param {RCPConnection} client 
	 */
	handleExportModel(data, client) {
		this.handleExport('rcp-export-models', data, client);
	}

	/**
	 * Handle an incoming EXPORT_TEXTURE request.
	 * @param {object} data 
	 * @param {RCPConnection} client 
	 */
	handleExportTexture(data, client) {
		this.handleExport('rcp-export-textures', data, client);
	}

	/**
	 * Dispatch a payload to hooked clients.
	 * @param {string} hookID 
	 * @param {object} [data]
	 */
	dispatchHook(hookID, data = {}) {
		if (!this.isRunning)
			return;

		if (this.hooks.has(hookID)) {
			const payload = Object.assign({ hookID }, data);
			for (const clientID of this.hooks.get(hookID))
				this.connections.get(clientID)?.sendData('HOOK_EVENT', payload);
		}
	}

	/**
	 * Delete all existing hooks for a given client.
	 * @param {string} clientID
	 */
	deleteHooks(clientID) {
		for (const [hookID, hooks] of this.hooks) {
			hooks.delete(clientID);

			// Clear empty hook sets.
			if (hooks.size === 0)
				this.hooks.delete(hookID);
		}
	}

	/**
	 * Generates a unique connection ID.
	 * @returns {string}
	 */
	generateID() {
		let id = -1;
		while (id === -1 || this.connections.has(id))
			id = Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, 0);

		return id;
	}

	/**
	 * Validate a set of parameters for a request.
	 * @param {RCPConnection} client 
	 * @param {object} data 
	 * @param {object} required 
	 * @returns {boolean}
	 */
	validateParameters(client, data, required) {
		for (const [key, value] of Object.entries(required)) {
			const types = Array.isArray(value) ? value : [value];
			let valid = false;

			const check = data[key];
			for (const type of types) {
				if (type === 'any') {
					if (check === undefined)
						continue;
				} else if (type.endsWith('[]')) {
					const arrayType = type.substring(0, type.length - 2);
					if (!Array.isArray(check) || check.some(e => typeof e !== arrayType))
						continue;
				} else if (typeof check !== type) {
					continue;
				}

				valid = true;
				continue;
			}

			if (!valid) {
				client.sendData('ERR_INVALID_PARAMETERS', required);
				return false;
			}
		}

		return true;
	}

	/**
	 * Start the internal RCP server.
	 */
	start() {
		if (this.isRunning)
			throw new Error('RCP server is already running.');

		this.connections.clear();
		const port = core.view.config.rcpPort;

		this.server = net.createServer(socket => {
			const connectionID = this.generateID();
			const connection = new RCPConnection(connectionID, socket);
			this.connections.set(connectionID, connection);

			connection.on('payload', data => this.handlePayload(data, connection));
			connection.once('end', () => {
				this.connections.delete(connectionID);
				this.deleteHooks(connectionID);
			});

			const manifest = nw.App.manifest;
			connection.sendData('CONNECTED', {
				version: manifest.version,
				flavour: manifest.flavour,
				build: manifest.guid,
				rcp: 1, // Forward compatibility
			});
		});

		this.server.on('error', err => {
			log.write('RCP server failed to start (%s): %s', err.code, err.message);
			core.setToast('error', 'RCP server encountered an error (' + err.code + ')', null, -1);

			this.server.close();
		});

		this.server.listen(port, () => {
			log.write('Listening for RCP connections on port %d', port);
		});
	}

	/**
	 * Stop the internal RCP server.
	 */
	stop() {
		if (!this.isRunning)
			return;

		log.write('Stopping RCP server and terminating %d connections', this.numConnections);

		for (const connection of this.connections.values())
			connection.disconnect();

		this.hooks.clear();
		this.connections.clear();
		this.server.close();
	}
}

/**
 * Defines valid server hooks that can be registered.
 * @type {Array.<string>}
 */
const SERVER_HOOKS = [
	'HOOK_BUSY_STATE',
	'HOOK_INSTALL_READY',
	'HOOK_EXPORT_COMPLETE'
];

/**
 * Maps client payload identifiers to internal handler functions.
 * @type {Object.<number, function>}
 */
const SERVER_HANDLERS = {
	CONFIG_GET: RCPServer.prototype.handleGetConfig,
	CONFIG_SET: RCPServer.prototype.handleSetConfig,
	CONFIG_RESET: RCPServer.prototype.handleResetConfig,
	RESTART_APP: RCPServer.prototype.handleRestartApp,
	GET_CONSTANTS: RCPServer.prototype.handleGetConstants,
	GET_CDN_REGIONS: RCPServer.prototype.handleGetCDNRegions,
	HOOK_REGISTER: RCPServer.prototype.handleRegisterHook,
	HOOK_DEREGISTER: RCPServer.prototype.handleDeregisterHook,
	GET_CASC_INFO: RCPServer.prototype.handleGetCASCInfo,
	LOAD_CASC_REMOTE: RCPServer.prototype.handleLoadCASCRemote,
	LOAD_CASC_LOCAL: RCPServer.prototype.handleLoadCASCLocal,
	LOAD_CASC_BUILD: RCPServer.prototype.handleLoadCASCBuild,
	CLEAR_CACHE: RCPServer.prototype.handleClearCache,
	LISTFILE_QUERY_ID: RCPServer.prototype.handleListfileQueryID,
	LISTFILE_QUERY_NAME: RCPServer.prototype.handleListfileQueryName,
	LISTFILE_SEARCH: RCPServer.prototype.handleListfileSearch,
	EXPORT_MODEL: RCPServer.prototype.handleExportModel,
	EXPORT_TEXTURE: RCPServer.prototype.handleExportTexture
};

module.exports = RCPServer;