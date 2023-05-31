/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import fs from 'node:fs/promises';

import { readJSON } from './generics';
import { toRaw } from 'vue';

import TactKeys from './casc/tact-keys';
import Log from './log';
import Constants from './constants';
import State from './state';
import Events from './events';

let isSaving = false;
let isQueued = false;

const defaultConfig = {
	listfileURL: 'https://www.kruithne.net/wow.export/data/listfile/master?v=%s',
	listfileCacheRefresh: 3,
	listfileSortByID: false,
	dbdURL: 'https://www.kruithne.net/wow.export/data/dbd/?def=%s',
	updateURL: 'https://www.kruithne.net/wow.export/update/%s/',
	cacheExpiry: 7,
	cascLocale: 2,
	recentLocal: [],
	sourceSelectUserRegion: null,
	tactKeysURL: 'https://www.kruithne.net/wow.export/data/tact/wow',
	exportDirectory: '',
	copyMode: 'FULL',
	pasteSelection: false,
	enableUnknownFiles: true,
	enableM2Skins: true,
	enableSharedTextures: true,
	enableSharedChildren: true,
	enableAbsoluteMTLPaths: false,
	enableAbsoluteCSVPaths: false,
	removePathSpaces: true,
	removePathSpacesCopy: true,
	exportTextureFormat: 'PNG',
	exportChannelMask: 15,
	showTextureInfo: true,
	exportModelFormat: 'OBJ',
	overwriteFiles: true,
	exportM2Bones: false,
	exportM2Meta: false,
	exportWMOMeta: false,
	exportBLPMeta: false,
	exportFoliageMeta: false,
	modelsShowM2: true,
	modelsShowWMO: true,
	listfileShowFileDataIDs: false,
	modelsAutoPreview: true,
	modelViewerShowGrid: true,
	modelViewerWireframe: false,
	modelViewerShowTextures: true,
	modelsExportCollision: false,
	modelsExportSkin: false,
	modelsExportSkel: false,
	modelsExportBone: false,
	modelsExportAnim: false,
	modelsExportWMOGroups: false,
	modelsExportUV2: false,
	modelsExportTextures: true,
	modelsExportAlpha: true,
	soundPlayerVolume: 0.7,
	soundPlayerAutoPlay: true,
	soundPlayerLoop: false,
	mapsShowSidebar: false,
	mapsIncludeWMO: true,
	mapsIncludeM2: true,
	mapsIncludeWMOSets: true,
	mapsIncludeFoliage: true,
	mapsIncludeLiquid: false,
	mapsIncludeGameObjects: true,
	mapsIncludeHoles: true,
	mapsExportRaw: false,
	regexFilters: false,
	exportMapQuality: 4096,
	splitLargeTerrainBakes: true,
	splitAlphaMaps: true,
	itemViewerEnabledTypes: ['Head', 'Neck', 'Shoulder', 'Shirt', 'Chest', 'Waist', 'Legs', 'Feet', 'Wrist', 'Hands', 'One-hand', 'Off-hand', 'Two-hand', 'Main-hand', 'Ranged', 'Back', 'Tabard'],
	chrCustShowNPCRaces: false,
	pathFormat: 'win32',
	lastExportFile: ''
};

/**
 * Clone one config object into another.
 * Arrays are cloned rather than passed by reference.
 * @param src - Source object.
 * @param target - Target object.
 */
function copyConfig(src: object, target: object): void {
	for (const [key, value] of Object.entries(src)) {
		if (Array.isArray(value)) {
			// Clone array rather than passing reference.
			target[key] = value.slice(0);
		} else {
			// Pass everything else in wholemeal.
			target[key] = value;
		}
	}
}

/**
 * Load configuration from disk.
 */
export async function load(): Promise<void> {
	const userConfig = await readJSON(Constants.CONFIG.USER_PATH) || {};

	Log.write('Loaded config defaults: %o', defaultConfig);
	Log.write('Loaded user config: %o', userConfig);

	const config = {};
	copyConfig(defaultConfig, config);
	copyConfig(userConfig, config);

	State.state.config = config;
	State.state.$watch('config', () => save(), { deep: true });
}

/**
 * Reset a configuration key to default.
 * @param {string} key
 */
export function resetToDefault(key: string): void {
	if (Object.prototype.hasOwnProperty.call(defaultConfig, key))
		State.state.config[key] = defaultConfig[key];
}

/**
 * Reset all configuration to default.
 */
export function resetAllToDefault(): void {
	State.state.config = structuredClone(defaultConfig);
}

/**
 * Mark configuration for saving.
 */
function save(): void {
	if (!isSaving) {
		isSaving = true;
		setImmediate(doSave);
	} else {
		// Queue another save.
		isQueued = true;
	}
}

/**
 * Persist configuration data to disk.
 */
async function doSave(): Promise<void> {
	const configSave = {};
	for (const [key, value] of Object.entries(State.state.config)) {
		// Only persist configuration values that do not match defaults.
		if (Object.prototype.hasOwnProperty.call(defaultConfig, key) && defaultConfig[key] === value)
			continue;

		configSave[key] = value;
	}

	const out = JSON.stringify(configSave, null, '\t');
	await fs.writeFile(Constants.CONFIG.USER_PATH, out, 'utf8');

	// If another save was attempted during this one, re-save.
	if (isQueued) {
		isQueued = false;
		doSave();
	} else {
		isSaving = false;
	}
}

// Track when the configuration screen is displayed and clone a copy of
// the current configuration into State.state.configEdit for reactive UI usage.
Events.on('screen-config', () => {
	State.state.configEdit = structuredClone(toRaw(State.state.config));
});

// When the user attempts to apply a new configuration, verify all of the
// new values as needed before applying them.
Events.on('click-config-apply', () => {
	const cfg = State.state.configEdit;

	if (cfg.exportDirectory.length === 0)
		return State.state.setToast('error', 'A valid export directory must be provided', null, -1);

	if (cfg.listfileURL.length === 0)
		return State.state.setToast('error', 'A valid listfile URL or path is required.', { 'Use Default': () => cfg.listfileURL = defaultConfig.listfileURL }, -1);

	if (cfg.tactKeysURL.length === 0 || !cfg.tactKeysURL.startsWith('http'))
		return State.state.setToast('error', 'A valid URL is required for encryption key updates.', { 'Use Default': () => cfg.tactKeysURL = defaultConfig.tactKeysURL }, -1);

	if (cfg.dbdURL.length === 0 || !cfg.dbdURL.startsWith('http'))
		return State.state.setToast('error', 'A valid URL is required for DBD updates.', { 'Use Default': () => cfg.dbdURL = defaultConfig.dbdURL }, -1);

	// Everything checks out, apply.
	State.state.config = cfg;
	State.state.showPreviousScreen();
	State.state.setToast('success', 'Changes to your configuration have been saved!');
});

// User has attempted to manually add an encryption key.
// Verify the input, register it to BLTEReader and store with keys.
Events.on('click-tact-key', () => {
	if (TactKeys.addKey(State.state.userInputTactKeyName, State.state.userInputTactKey))
		State.state.setToast('success', 'Successfully added decryption key.');
	else
		State.state.setToast('error', 'Invalid encryption key.', null, -1);
});

// When the user clicks 'Discard' on the configuration screen, simply
// move back to the previous screen on the stack.
Events.on('click-config-discard', () => State.state.showPreviousScreen());

// When the user clicks 'Reset to Default', apply the default configuration to our
// reactive edit object instead of our normal config allowing them to still discard.
Events.on('click-config-reset', () => {
	State.state.configEdit = structuredClone(defaultConfig);
});

export default {
	load,
	resetToDefault,
	resetAllToDefault
};