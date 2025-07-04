# Remote Control Protocol

A remote control protocol (RCP) is now provided in wow.export which allows other applications to connect directly to a running wow.export instance and control it without requiring using interaction.

This can be used to automate various tasks in wow.export which would otherwise require more complicated (and less forward compatible) visual automation.

---

## Introduction

While RCP is enabled, wow.export will listen for TCP connections on the configured port (17751 by default). All data is sent as UTF-8 encoded strings for simplicity.

Each "message" sent/received via the RCP should be a JSON encoded message prefixed with its length, separated by a single null character.

![RCP Payload](/doc_images/rcp_payload.png)

The length is included as part of the UTF-8 string, not written to the stream as a number, to simplify parsing in modern libraries.

Every message must contain an `id` property which informs the receiver how to handle the message. For example, when a client connects to the RCP, wow.export will send a `CONNECTED` message to the client containing details that identify the application versions (see Server Responses section).

Messages sent to wow.export may not be processed immediately. If the application is "busy", the message will be queued and processed at a later time. This can potentially be minutes (or hours) later if a heavy task is active.

---

## Basic Example (NodeJS)

```js
const net = require('net');
const { EventEmitter } = require('events');

/**
 * RCPClient is a wrapper for the net.Socket class.
 * @class RCPClient
 */
class RCPClient extends EventEmitter {
	constructor() {
		super();

		this.socket = new net.Socket();
		this.buffer = '';
	}

	/**
	 * Connect via RCP to an instance of wow.export
	 * @param {string} [host=127.0.0.1]
	 * @param {number} [port=17751]
	 */
	async connect(host = '127.0.0.1', port = 17751) {
		console.log('Connecting to wow.export RCP at [%s]:%d', host, port);
		await new Promise(res => this.socket.connect(port, host, res));

		this.socket.on('data', data => this.onData(data));
		this.socket.on('close', () => this.onConnectionClose());
	}

	/**
	 * Invoked when this connection receives UTF-8 data.
	 * @param {string} data 
	 */
	onData(data) {
		this.buffer += data;
		this.processData();
	}

	/**
	 * Invoked when this connection closes.
	 */
	onConnectionClose() {
		console.log('Remote connection closed.');
	}

	/**
	 * Write data to the socket.
	 * @param {object} data 
	 */
	write(data) {
		const json = JSON.stringify(data);
		this.socket.write(json.length + '\0' + json);
		console.log('→ %s (%d)', data.id, json.length);
	}

	/**
	 * Asynchronous short-hand for awaiting a specific message.
	 * @param {string} id 
	 */
	async forMessage(id) {
		return new Promise(res => this.once(id, res));
	}

	/**
	 * Scans the internal buffer for messages and parses them.
	 */
	processData() {
		const delimiter = this.buffer.indexOf('\0');
		if (delimiter > 0) {
			const size = parseInt(this.buffer.substring(0, delimiter));
			if (isNaN(size) || size <= 0)
				throw new Error('Invalid stream segmentation');

			const offset = delimiter + 1;
			const availableSize = this.buffer.length - (offset);
			if (availableSize >= size) {
				// Enough data available in buffer to process this payload.
				const data = this.buffer.substring(offset, offset + size);
				const json = JSON.parse(data);

				if (typeof json.id !== 'string')
					throw new Error('Invalid JSON payload');

				console.log('← %s (%d)', json.id, size);
				this.emit(json.id, json);

				this.buffer = this.buffer.substring(offset + size);

				if (this.buffer.length > 0)
					this.processData();
			}
		}
	}
}

(async () => {
	// Create a new connection.
	const client = new RCPClient();
	await client.connect('127.0.0.1', 17751);

	// Wait for the connection message.
	const connected = await client.forMessage('CONNECTED');
	console.log('Connected to wow.export %s (%s) [%s] with RCP protocol v%d', connected.version, connected.flavour, connected.build, connected.rcp);

	// Request available installations for the EU region CDN.
	client.write({ id: 'LOAD_CASC_REMOTE', regionTag: 'eu' });

	// Wait for installation list and then initiate loading of our build.
	const cascBuilds = await client.forMessage('CASC_INSTALL_BUILDS');
	const buildIndex = cascBuilds.builds.findIndex(build => build.Product === 'wow');
	client.write({ id: 'LOAD_CASC_BUILD', buildIndex });

	// Wait for the CASC initiation to complete.
	const casc = await client.forMessage('CASC_INFO');
	console.log('Successfully loaded %s installation (%s)', casc.buildName, casc.buildKey);

	// Search for all corgi-related models.
	client.write({ id: 'LISTFILE_SEARCH', search: 'corgi.*\\.m2', useRegularExpression: true });
	const listfile = await client.forMessage('LISTFILE_RESULT');

	// Listen for export events.
	client.write({ id: 'HOOK_REGISTER', hookID: 'HOOK_EXPORT_COMPLETE' });
	client.on('HOOK_EVENT', data => {
		if (data.hookID === 'HOOK_EXPORT_COMPLETE')
			console.log('%d succeeded', data.succeeded.length);
			console.log('%d failed.', data.failed.length);
	});

	// Export every corgi-related model.
	const fileDataIDs = listfile.entries.map(e => e.fileDataID);
	client.write({ id: 'EXPORT_MODEL', fileDataID: fileDataIDs });
})();
```
---
## Client Commands (Client → Server)

### `CONFIG_GET`

Requests either a specific or the entire wow.export user configuration.

Always use caution when adjusting configuration values, as incorrect values can cause potentially harmful errors.

If `key` is provided, a `CONFIG_SINGLE` will be sent in response, otherwise a `CONFIG_FULL` will be sent in response.

| Property | Type   | Required |
| -------- | ----   | -------- |
| key      | string | No |

### `CONFIG_SET`

Sets the value of a specific configuration key. Only one configuration value can be changed per message.

Sends `CONFIG_SET_DONE` in response which contains the updated key/value pair.

| Property | Type | Required |
| -------- | ---- | -------- |
| key | string | Yes |
| value | any | Yes |

### `CONFIG_RESET`

Resets either a specification configuration key, or the entire configuration to the internally defined default state.

Sends `CONFIG_SINGLE` if a key is specified, containing the reset key/value pair, otherwise sends `CONFIG_FULL` with the fully reset configuration.

| Property | Type | Required |
| --- | --- | --- |
| key | string | No |

### `RESTART_APP`

Initiates a restart of the wow.export application. Once this command has been sent, no further commands will be processed (unless they are queued before this one).

During restart, all RCP connections are disabled and will not be automatically reestablished. Applications must reconnect once wow.export has restarted.

### `GET_CONSTANTS`

Responds with `CONSTANTS` containing the internal constants used by wow.export.

### `GET_CDN_REGIONS`

Responds with `CDN_REGIONS` containing a map of the Blizzard CDN servers.

### `HOOK_REGISTER`

Registers a hook which listens for a specific event. Every time the event occurs, the connection will automatically be sent a `HOOK_EVENT` message until the hook is removed using `HOOK_DEREGISTER`.

Responds with `HOOK_REGISTERED` once the hook is successfully registered. If an unknown `hookID` is provided, responds with `ERR_UNKNOWN_HOOK`.

For a list of available hooks, see the Hooks section below.

| Property | Type | Required |
| --- | --- | --- |
| hookID | string | Yes |

### `HOOK_DEREGISTER`

Removes an existing hook so that this connection stops receiving messages for a given event. Has no effect if the given `hookID` hasn't been registered using `HOOK_REGISTER`.

Responds with `HOOK_DEREGISTERED` to indicate the command was processed, even if no hook existed to be removed.

For a list of available hooks, see the Hooks section below.

| Property | Type | Required |
| --- | --- | --- |
| hookID | string | Yes |

### `GET_CASC_INFO`

Responses with `CASC_INFO` containing information on the currently active CASC installation. If no CASC installation has been loaded, responds with `CASC_UNAVAILABLE`.

### `LOAD_CASC_REMOTE`

Instructs wow.export to initiate a remote CASC installation using the Blizzard CDN servers. The provided `regionTag` should match a server obtained through `GET_CDN_REGIONS`.

Responds with `CASC_INSTALL_BUILDS` once the installation has been initiated, otherwise responds with `ERR_INVALID_INSTALL` if the installation is invalid.

In the event that a CASC installation is already loaded (not just initiated) in wow.export, then the `ERR_CASC_ACTIVE` error is sent. To load a new CASC installation, wow.export must be restarted.

| Property | Type | Required |
| --- | --- | --- |
| regionTag | string | Yes |


### `LOAD_CASC_LOCAL`

Instructs wow.export to initiate a local CASC installation using a local game installation. The provided `installDirectory` string must point to a valid game installation.

Responds with `CASC_INSTALL_BUILDS` once the installation has been initiated, otherwise responds with `ERR_INVALID_INSTALL` if the given directory does not contain a valid installation.

In the event that a CASC installation is already loaded (not just initiated) in wow.export, then the `ERR_CASC_ACTIVE` error is sent. To load a new CASC installation, wow.export must be restarted.

| Property | Type | Required |
| --- | --- | --- |
| installDirectory | string | Yes |

### `LOAD_CASC_BUILD`

Instructs wow.export to load a specific build (by index) from the last received `CASC_INSTALL_BUILDS` for a local or remote build initiated with either `LOAD_CASC_REMOTE` or `LOAD_CASC_LOCAL`.

If `LOAD_CASC_REMOTE` or `LOAD_CASC_LOCAL` haven't been sent by the client and no `CASC_INSTALL_BUILDS` has been sent by the server, then `ERR_NO_CASC_SETUP` will be sent in response.

If the given `buildIndex` is not an index of the given builds array sent by `CASC_INSTALL_BUILDS`, then `ERR_INVALID_CASC_BUILD` will be sent in response.

In the event that the CASC installation could not be loaded, then `ERR_CASC_FAILED` will be sent in response. The most common fix to this problem is to run the installation repair tool on the Battle.net launcher.

Once the given CASC build has been loaded (which may take several minutes depending on hardware and/or internet connection), a `CASC_INFO` response will be sent.

| Property | Type | Required | 
| --- | --- | --- |
| buildIndex | number | Yes |

### `CLEAR_CACHE`

Instructs wow.export to clear the internal data cache, and will then send a `CACHE_CLEARED` in response.

Once the cache has been cleared, no further actions will be processed until wow.export has been restarted.

### `LISTFILE_QUERY_ID`

Requests the name of a file as it appears on the actively loaded listfile for a given `fileDataID`. If the `fileDataID` cannot be found on the loaded listfile, an empty string is returned.

Responds with `LISTFILE_RESULT` containing a `fileDataID`/`fileName` pair.

A listfile is only loaded if wow.export has an active CASC installation active. If this is not the case, `ERR_LISTFILE_NOT_LOADED` will be returned.

| Property | Type | Required |
| --- | --- | --- |
| fileDataID | number | Yes |

### `LISTFILE_QUERY_NAME`

Requests the `fileDataID` of a given `fileName` as it appears on the actively loaded listfile. If the `fileName` is not on the listfile, then `0` is returned as the `fileDataID`.

The given `fileName` must be a full internal filename and will only return if it exactly matches an entry. Partial names, wildcards or regular expressions are **not** accepted here, use `LISTFILE_SEARCH` instead.

Responds with `LISTFILE_RESULT` containing a `fileDataID`/`fileName` pair.

A listfile is only loaded if wow.export has an active CASC installation active. If this is not the case, `ERR_LISTFILE_NOT_LOADED` will be returned.

### `LISTFILE_SEARCH`

Searches the active listfile for a given string, returning all file entries where the file name contains the given `search` string.

Unlike the interfaces on wow.export which contain filtered sub-sections of the listfile, this will search the **entire** listfile including **all** file types. Searching for short terms may result in large responses.

To retrieve the entire listfile, `search` may be an empty string. Be aware that listfiles contain **millions** of entries, and this will return them all.

For more advanced searching, `useRegularExpression` can be set to `true` so that `search` is treated as a case-insensitive regular expression.

Responds with `LISTFILE_RESULT` once the search is complete.

A listfile is only loaded if wow.export has an active CASC installation active. If this is not the case, `ERR_LISTFILE_NOT_LOADED` will be returned.

| Property | Type | Required |
| --- | --- | --- |
| search | string | Yes |
| useRegularExpression | boolean | No (default: false)

### `EXPORT_MODEL`

Instructs wow.export to export one or more 3D models. The `fileDataID` property can be provided as a number, or an array of numbers, each one must be a valid `fileDataID` for an M2/WMO model.

If the export is successfully started, the server will send a `EXPORT_START` message with an `exportID` property, which can be used in conjunction with the `HOOK_EXPORT_COMPLETE` hook, with the `type` as `MODELS`.

To configure export parameters, such as toggling RGBA channel visibility on an exported BLP texture, you need to adjust the application config before the export. This can be done programmatically in RCP using `CONFIG_SET`.

If no CASC installation is loaded in wow.export, `ERR_NO_CASC` will be returned.

| Property | Type | Required |
| --- | --- | --- |
| fileDataID | number\|number[] | Yes |

### `EXPORT_TEXTURE`

Instructs wow.export to export one or more BLP textures. The `fileDataID` property can be provided as a number, or an array of numbers, each one must be a valid `fileDataID` for an BLP texture.

If the export is successfully started, the server will send a `EXPORT_START` message with an `exportID` property, which can be used in conjunction with the `HOOK_EXPORT_COMPLETE` hook, with the `type` as `TEXTURES`.

If no CASC installation is loaded in wow.export, `ERR_NO_CASC` will be returned.

| Property | Type | Required |
| --- | --- | --- |
| fileDataID | number\|number[] | Yes |

---

## Server Responses (Server → Client)

### `CONNECTED`

Sent immediately after a connection is established.

| Property | Type | Note |
| --- | --- | --- |
| version | string | Current version of wow.export, ie 0.1.39 |
| flavour | string | Build flavor, win-x64 for most people. |
| build | string | Unique build ID, used in update process. |
| rcp | number | RCP revision, currently 1. If changed, assume breaking changes. |

### `CONFIG_SINGLE`

Sent in response to `CONFIG_GET` or `CONFIG_RESET` if a `key` was provided.

| Property | Type | Note |
| --- | --- | --- |
| key | string | The same key which was requested. |
| value | any | The configuration value. |

### `CONFIG_FULL`

Sent in response to `CONFIG_GET` or `CONFIG_RESET` if `key` was omitted.

| Property | Type | Note |
| --- | --- | --- |
| config | object | Contains the entire configuration structure. |

### `CONFIG_SET_DONE`

Sent in response to `CONFIG_SET`.

| Property | Type | Note |
| --- | --- | --- |
| key | string | The same key which was set. |
| value | any | The new configuration value. |

### `CONSTANTS`

Sent in response to `GET_CONSTANTS`.

| Property | Type | Note |
| --- | --- | --- |
| constants | object | Contains the entire constant structure. |

### `CDN_REGIONS`

Sent in response to `GET_CDN_REGIONS`.

| Property | Type | Note |
| --- | --- | --- |
| regions | Region[] | Array of CDN regions. |

**Region structure:**

| Property | Type | Note | 
| --- | --- | --- |
| tag | string | Regional tag, e.g 'eu'. |
| url | string | CDN patch URL |
| delay | number | Ping (missing if ping hasn't ponged yet) |

### `CACHE_CLEARED`

Sent in response to `CLEAR_CACHE`. wow.export must be restarted after receiving this message.

### `HOOK_REGISTERED`

Sent in response to `HOOK_REGISTER` to indicate that the hook has been successfully registered.

| Property | Type | Note |
| --- | --- | --- |
| hookID | string | ID of the hook registered.

### `HOOK_DEREGISTERED`

Sent in response to `HOOK_DEREGISTER` to indicate that the hook has been successfully registered.

| Property | Type | Note |
| --- | --- | --- |
| hookID | string | ID of the hook deregistered.

### `HOOK_EVENT`

Sent when a hook registered with `HOOK_REGISTERED` is triggered. The data contained in this message will vary depending on the hook, see the Hooks section.

| Property | Type | Note |
| --- | --- | --- |
| hookID | string | ID of the hook which fired. |

### `LISTFILE_RESULT`

Sent in response to a `LISTFILE_QUERY_NAME` or `LISTFILE_QUERY_ID` request. Always contains a key/pair value.

| Property | Type | Note |
| --- | --- | --- |
| fileDataID | number |
| fileName | string |

### `LISTFILE_SEARCH_RESULT`

Sent in response to a `LISTFILE_SEARCH` request.

| Property | Type | Note |
| --- | --- |--- |
| entries | ListfileEntry[] | See ListfileEntry structure below. |

**ListfileEntry structure**:
| Property | Type | Note |
| --- | --- | --- |
| fileDataID | number |
| fileName | string |

### `CASC_UNAVAILABLE`

Sent in response to `GET_CASC_INFO` if no CASC installation is loaded.

### `CASC_INFO`

Sent in response to `GET_CASC_INFO` or `LOAD_CASC_BUILD`.

| Property | Type | Note |
| --- | --- | --- |
| type | string | CASCRemote or CASCLocal |
| build | BuildInfo | See BuildInfo structure below. |
| buildConfig | BuildConfig | See BuildConfig structure below. |
| buildName | string | Build name (e.g 9.1.0.39653). |
| buildKey | string | 32-length build key.

**BuildInfo structure:**

| Property | Type | Note |
| --- | --- | --- |
| Active | string |
| Armadillo | string |
| Branch | string |
| BuildKey | string |
| CDNHosts | string |
| CDNKey | string | 
| CDNPath | string |
| CDNServers | string | 
| IMSize | string |
| InstallKey | string |
| LastActivated | string |
| Product | string | 
| Tags | string |
| Version | string |

**BuildConfig structure:**

| Property | Type | Note |
| --- | --- | --- |
| buildName | string |
| buildPartialPriority | string |
| buildPlaybuildInstaller | string
| buildProduct | string | 
| buildUid | string |
| download | string |
| downloadSize | string |
| encoding | string |
| encodingSize | string |
| install | string |
| installSize | string |
| patch | string |
| patchConfig | string |
| patchSize | string |
| root | string |
| size | string |
| sizeSize | string |


### `CASC_INSTALL_BUILDS`

Sent in response to `LOAD_CASC_LOCAL` or `LOAD_CASC_REMOTE`.

| Property | Type | Note |
| --- | --- | --- |
| builds | BuildInfo[] | See BuildInfo structure below. |

**BuildInfo structure:**

| Property | Type | Note |
| --- | --- | --- |
| Active | string |
| Armadillo | string |
| Branch | string |
| BuildKey | string |
| CDNHosts | string |
| CDNKey | string | 
| CDNPath | string |
| CDNServers | string | 
| IMSize | string |
| InstallKey | string |
| LastActivated | string |
| Product | string | 
| Tags | string |
| Version | string |

### `ERR_DATA_FLOOD`

Sent if excessive data is being sent to the server, generally indicating incorrect or missing message segmentation.

### `ERR_INVALID_SEGMENTATION`

Sent if the server encounters an error parsing the segmentation of a message.

### `ERR_INVALID_JSON`

Sent if the JSON encoded object for a message could not be decoded.

### `ERR_INVALID_ACTION`

Sent if the `id` field of a message is missing or invalid.

### `ERR_INVALID_PARAMETERS`

Sent if the expected parameters for a specific message are not met or contain invalid types. Check documentation for help.

| Property | Type | Note |
| --- | --- |--- |
| required | object | Contains the required parameter types. |

### `ERR_CASC_ACTIVE`

Sent when attempting to initiate a CASC installation while a CASC installation is already loaded in wow.export. Restart wow.export to load another installation.

### `ERR_UNKNOWN_HOOK`

Sent when attempting to register an unknown hook using `HOOK_REGISTER`.

### `ERR_INVALID_INSTALL`

Sent in response to `LOAD_CASC_REMOTE` or `LOAD_CASC_LOCAL` if the given installation is not valid.

### `ERR_NO_CASC_SETUP`

Sent in response to `LOAD_CASC_BUILD` if no CASC build has been initiated via `LOAD_CASC_REMOTE` or `LOAD_CASC_LOCAL`.

### `ERR_INVALID_CASC_BUILD`

Sent in response to `LOAD_CASC_BUILD` if the given `buildIndex` does not exist in the array of builds provided by `CASC_INSTALL_BUILDS`.

### `ERR_CASC_FAILED`

Sent if an internal error occurs while trying to load a CASC installation. This generally indicates a corrupted installation and can commonly be fixed by running the 'repair installation' feature of the Battle.net launcher.

### `ERR_LISTFILE_NOT_LOADED`

Sent in response to any listfile query requests before a listfile has been loaded. A listfile is loaded when a CASC build is loaded.

### `ERR_NO_CASC`

Sent in response to any export request if a CASC installation has not yet been loaded.

---

## Hooks

### `HOOK_BUSY_STATE`

Triggered when the internal "busy state" of wow.export changes. The event may triggered multiple times with the same value if numerous tasks are working at the same time.

Incoming messages via RCP are not processed while the busy state is `true`, but can still be sent. They will be stored in a queue and processed once active tasks have finished.

| Property | Type | Note |
| --- | --- | --- |
| busy | boolean | 

### `HOOK_INSTALL_READY`

Triggered when a CASC installation has been loaded by wow.export. This event will only occur once during the lifecycle of the application, since it must be restarted to load another CASC installation.

| Property | Type | Note |
| --- | --- | --- |
| type | string | CASCRemote or CASCLocal |
| build | BuildInfo | See BuildInfo in `CASC_INFO` event. |
| buildConfig | BuildConfig | See BuildConfig in `CASC_INFO` event. |
| buildName | string | Build name (e.g 9.1.0.39653). |
| buildKey | string | 32-length build key.

### `HOOK_EXPORT_COMPLETE`

Triggered when an export task has completed.

| Property | Type | Note |
| --- | --- | --- |
| exportID | number | Unique ID returned from an `EXPORT_` command. |
| type | string | Indicates the export type e.g `MODELS` |
| succeeded | object[] | Array of successfully exported files. |
| failed | object[] | Array of failed files. |

The contents of the succeeded/failed array objects varies on the export type and export factors. A BLP texture exported as PNG will add one entry to the array.

In contrast, exporting an M2 model as RAW with all of the options enabled will add numerous entries to the list, mapping all the exported files. All entries will follow the same structure.

| Property | Type | Note |
| --- | --- | --- |
| type | string | Exported file type, see table below.
| fileDataID | number | ID of the file the data came from.
| file | string | Absolute path of the exported file (omitted for failed files).


Below is a list of potential types that may be included in an export manifest.

| Type | Note |
| --- | --- |
| BLP | Raw BLP texture file.
| PNG | Converted PNG texture file.
| META | JSON file containing meta data.
| OBJ | Converted 3D model geometry.
| MTL | OBJ material library.
| PHYS_OBJ | Converted 3D collision model geometry.
| PLACEMENT | CSV file containing child model placement.
| SKIN | Raw M2 skin file.
| SKEL | Raw M2 skeleton file.
| BONE | Raw M2 bone file.
| ANIM | Raw M2 animation file.
| M2 | Raw M2 model file.
| WMO | Raw WMO model.
| WMO_GROUP | Raw WMO group file.

---

## Frequently Asked Questions

### Q: How do I disable this feature?

A: The RCP is disabled by default, it must be enabled **manually** in the settings.

### Q: Is it possible to tell when RCP is connected?

A: Yes, when a connection is established via RCP, a notification will appear at the top of wow.export with buttons to disconnect the connection or disable the feature entirely.

### Q: Does this allow other people to connect to my PC?

A: By default, no. If the RCP is enabled, it will operate on the configured port (17751 by default). If you open this port on your firewall, other computers on the **same network** may connect via the RCP. For remote computers to connect, you would need to add a port-forwarding rule on your router (not recommended).

### Q: Can I apply a password to RCP?

A: Currently, no. The wow.export RCP is not intended for open-internet access. If this interests you, [submit a ticket via GitHub](https://github.com/Kruithne/wow.export/issues) and we will expand security measures based on user interest.

### Q: Can multiple applications access the RCP simultaneously?

A: Yes, multiple applications can open connections to an individual instance of wow.export at the same time.

### Q: RCP can't control the feature I want?

A: Only requested features are added as available RCP commands. Create a [ticket on GitHub](https://github.com/Kruithne/wow.export/issues) to request new commands for the RCP.