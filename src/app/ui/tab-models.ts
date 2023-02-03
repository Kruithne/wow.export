/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import util from 'node:util';
import path from 'node:path';
import fs from 'node:fs';

import State from '../state';
import Constants from '../constants';
import Log from '../log';
import BLPImage from '../casc/blp';
import Listfile, { ListfileFilter } from '../casc/listfile';
import BufferWrapper, { canvasToBuffer } from '../buffer';
import ExportHelper from '../casc/export-helper';
import { EncryptionError } from '../casc/blte-reader';
import FileWriter from '../file-writer';

import * as DBCreatures from '../db/caches/DBCreatures';
import * as DBItemDisplays from '../db/caches/DBItemDisplays';

import M2Renderer, { DisplayInfo } from '../3D/renderers/M2Renderer';
import M2Exporter from '../3D/exporters/M2Exporter';

import WMORenderer from '../3D/renderers/WMORenderer';
import WMOExporter from '../3D/exporters/WMOExporter';

import { CreatureDisplayInfoEntry } from '../db/caches/DBCreatures';
import { ItemDisplayInfoEntry } from '../db/caches/DBItemDisplays';

import * as THREE from 'three';
import textureRibbon from '../ui/texture-ribbon';

const MODEL_TYPE_M2 = Symbol('ModelType_M2');
const MODEL_TYPE_WMO = Symbol('ModelType_WMO');

type ModelType = typeof MODEL_TYPE_M2 | typeof MODEL_TYPE_WMO;

type SkinInfo = {
	id: string,
	label: string
};

const exportExtensions = {
	'OBJ': '.obj',
	'GLTF': '.gltf'
};

const activeSkins = new Map<string, DisplayInfo>();
let selectedVariantTextureIDs = Array<number>();
let selectedSkinName: string | null;

let isFirstModel = true;

let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let grid: THREE.GridHelper;

const renderGroup = new THREE.Group();

let activeRenderer: M2Renderer | WMORenderer | undefined;
let activePath: string | undefined;

/**
 * Lookup model displays for items/creatures.
 * @param fileDataID
 * @returns
 */
function getModelDisplays(fileDataID: number): Array<DisplayInfo> {
	let displays: Array<DisplayInfo> | undefined = DBCreatures.getCreatureDisplaysByFileDataID(fileDataID);

	if (displays === undefined)
		displays = DBItemDisplays.getItemDisplaysByFileDataID(fileDataID);

	return displays ?? [];
}

/** Clear the currently active texture preview. */
function clearTexturePreview(): void {
	State.modelTexturePreviewURL = '';
}

/**
 * Preview a texture by the given fileDataID.
 * @param fileDataID
 * @param name
 */
async function previewTextureByID(fileDataID: number, name: string): Promise<void> {
	const texture = Listfile.getByID(fileDataID) ?? Listfile.formatUnknownFile(fileDataID);

	State.isBusy++;
	State.setToast('progress', util.format('Loading %s, please wait...', texture), null, -1, false);
	Log.write('Previewing texture file %s', texture);

	try {
		const view = State;
		const file = await State.casc.getFile(fileDataID);

		const blp = new BLPImage(file);

		view.modelTexturePreviewURL = blp.getDataURL(view.config.exportChannelMask);
		view.modelTexturePreviewWidth = blp.width;
		view.modelTexturePreviewHeight = blp.height;
		view.modelTexturePreviewName = name;

		State.hideToast();
	} catch (e) {
		if (e instanceof EncryptionError) {
			// Missing decryption key.
			State.setToast('error', util.format('The texture %s is encrypted with an unknown key (%s).', texture, e.key), null, -1);
			Log.write('Failed to decrypt texture %s (%s)', texture, e.key);
		} else {
			// Error reading/parsing texture.
			State.setToast('error', 'Unable to preview texture ' + texture, { 'View Log': () => Log.openRuntimeLog() }, -1);
			Log.write('Failed to open CASC file: %s', e.message);
		}
	}

	State.isBusy--;
}

async function previewModel(fileName: string): Promise<void> {
	State.isBusy++;
	State.setToast('progress', util.format('Loading %s, please wait...', fileName), null, -1, false);
	Log.write('Previewing model %s', fileName);

	// Reset texture ribbon.
	textureRibbon.reset();

	// Hide current texture preview.
	clearTexturePreview();

	// Reset skin selection.
	State.modelViewerSkins = [];
	State.modelViewerSkinsSelection = [];

	try {
		// Dispose the currently active renderer.
		if (activeRenderer) {
			activeRenderer.dispose();
			activeRenderer = undefined;
			activePath = undefined;
		}

		// Clear the active skin map.
		activeSkins.clear();
		selectedVariantTextureIDs.length = 0;
		selectedSkinName = null;

		const fileDataID = Listfile.getByFilename(fileName);
		if (fileDataID === undefined)
			throw new Error(util.format('Unknown model file: %s', fileName));

		const file = await State.casc.getFile(fileDataID);
		let isM2 = false;

		const fileNameLower = fileName.toLowerCase();
		if (fileNameLower.endsWith('.m2')) {
			State.modelViewerActiveType = 'm2';
			activeRenderer = new M2Renderer(file, renderGroup, true);
			isM2 = true;
		} else if (fileNameLower.endsWith('.wmo')) {
			State.modelViewerActiveType = 'wmo';
			activeRenderer = new WMORenderer(file, fileName, renderGroup);
		} else {
			throw new Error(util.format('Unknown model extension: %s', fileName));
		}

		await activeRenderer.load();

		if (isM2) {
			const displays = getModelDisplays(fileDataID);

			const skinList = Array<SkinInfo>();
			let modelName = Listfile.getByID(fileDataID) as string; // TODO: Handle undefined?
			modelName = path.basename(modelName, 'm2');

			for (const display of displays) {
				if (display.textures.length === 0)
					continue;

				const texture = display.textures[0];

				let cleanSkinName = '';
				let skinName = Listfile.getByID(texture);
				if (skinName !== undefined) {
					// Display the texture name without path/extension.
					skinName = path.basename(skinName, '.blp');
					cleanSkinName = skinName.replace(modelName, '').replace('_', '');
				} else {
					// Handle unknown textures.
					skinName = 'unknown_' + texture;
				}

				if (cleanSkinName.length === 0)
					cleanSkinName = 'base';

				const creatureDisplay = display as CreatureDisplayInfoEntry;
				if (creatureDisplay.extraGeosets !== undefined && creatureDisplay.extraGeosets.length > 0)
					skinName += creatureDisplay.extraGeosets.join(',');

				cleanSkinName += ' (' + display.ID + ')';

				if (activeSkins.has(skinName))
					continue;

				// Push the skin onto the display list.
				skinList.push({ id: skinName, label: cleanSkinName });

				// Keep a mapping of the name -> fileDataID for user selects.
				activeSkins.set(skinName, display);
			}

			State.modelViewerSkins = skinList;
			State.modelViewerSkinsSelection = skinList.slice(0, 1);
		}

		updateCameraBounding();

		activePath = fileName;

		// Renderer did not provide any 3D data.
		if (renderGroup.children.length === 0)
			State.setToast('info', util.format('The model %s doesn\'t have any 3D data associated with it.', fileName), null, 4000);

		else
			State.hideToast();
	} catch (e) {
		if (e instanceof EncryptionError) {
			// Missing decryption key.
			State.setToast('error', util.format('The model %s is encrypted with an unknown key (%s).', fileName, e.key), null, -1);
			Log.write('Failed to decrypt model %s (%s)', fileName, e.key);
		} else {
			// Error reading/parsing model.
			State.setToast('error', 'Unable to preview model ' + fileName, { 'View Log': () => Log.openRuntimeLog() }, -1);
			Log.write('Failed to open CASC file: %s', e.message);
		}
	}

	State.isBusy--;
}

/** Update the camera to match render group bounding. */
function updateCameraBounding(): void {
	// Get the bounding box for the model.
	const boundingBox = new THREE.Box3();
	boundingBox.setFromObject(renderGroup);

	// Calculate center point and size from bounding box.
	const center = boundingBox.getCenter(new THREE.Vector3());
	const size = boundingBox.getSize(new THREE.Vector3());

	const maxDim = Math.max(size.x, size.y, size.z);
	const fov = camera.fov * (Math.PI / 180);
	const cameraZ = (Math.abs(maxDim / 4 * Math.tan(fov * 2))) * 6;

	if (isFirstModel || State.modelViewerAutoAdjust) {
		camera.position.set(center.x, center.y, cameraZ);
		isFirstModel = false;
	}

	const minZ = boundingBox.min.z;
	const cameraToFarEdge = (minZ < 0) ? -minZ + cameraZ : cameraZ - minZ;

	camera.updateProjectionMatrix();

	const controls = State.modelViewerContext.controls;
	if (controls) {
		controls.target = center;
		controls.maxDistance = cameraToFarEdge * 2;
	}
}

/**
 * Resolves variant texture IDs based on user selection.
 * @param fileName
 * @returns
 */
function getVariantTextureIDs(fileName: string): Array<number> {
	if (fileName === activePath) {
		// Selected model may have user-selected skins, use them.
		return selectedVariantTextureIDs;
	} else {
		// Resolve default skins for auxiliary selections.
		const fileDataID = Listfile.getByFilename(fileName);
		if (fileDataID === undefined)
			return [];

		const displays = getModelDisplays(fileDataID);
		return displays.find(e => e.textures.length > 0)?.textures ?? [];
	}
}

async function exportFiles(files, isLocal = false): Promise<void> {
	const exportPaths = new FileWriter(State.lastExportPath, 'utf8');
	const format = State.config.exportModelFormat;

	if (format === 'PNG' || format === 'CLIPBOARD') {
		// For PNG exports, we only export the viewport, not the selected files.
		if (activePath !== undefined) {
			State.setToast('progress', 'Saving preview, hold on...', null, -1, false);

			const modelPreview = document.getElementById('model-preview') as HTMLElement;
			const canvas = modelPreview.querySelector('canvas') as HTMLCanvasElement;
			const buf = new BufferWrapper(await canvasToBuffer(canvas, 'image/png'));

			if (format === 'PNG') {
				const exportPath = ExportHelper.getExportPath(activePath);
				const outFile = ExportHelper.replaceExtension(exportPath, '.png');
				const outDir = path.dirname(outFile);

				await buf.writeToFile(outFile);
				exportPaths.writeLine('PNG:' + outFile);

				Log.write('Saved 3D preview screenshot to %s', outFile);
				State.setToast('success', util.format('Successfully exported preview to %s', outFile), { 'View in Explorer': () => nw.Shell.openItem(outDir) }, -1);
			} else if (format === 'CLIPBOARD') {
				const clipboard = nw.Clipboard.get();
				clipboard.set(buf.readString(undefined, 'base64'), 'png', true);

				Log.write('Copied 3D preview to clipboard (%s)', activePath);
				State.setToast('success', '3D preview has been copied to the clipboard', null, -1, true);
			}
		} else {
			State.setToast('error', 'The selected export option only works for model previews. Preview something first!', null, -1);
		}
	} else {
		const casc = State.casc;
		const helper = new ExportHelper(files.length, 'model');
		helper.start();

		for (const fileEntry of files) {
			// Abort if the export has been cancelled.
			if (helper.isCancelled())
				return;

			let fileName;
			let fileDataID;

			if (typeof fileEntry === 'number') {
				fileDataID = fileEntry;
				fileName = Listfile.getByID(fileDataID);
			} else {
				fileName = Listfile.stripFileEntry(fileEntry);
				fileDataID = Listfile.getByFilename(fileName);
			}

			try {
				let fileType: ModelType | undefined;
				let data: BufferWrapper;

				if (isLocal)
					data = new BufferWrapper(await fs.promises.readFile(fileName));
				else
					data = await casc.getFile(fileDataID);

				if (fileName === undefined) {
					// In the event that we're exporting a file by ID that does not exist in the listfile
					// then we can't presume the file type and need to investigate the headers.
					const magic = data.readUInt32();
					data.seek(0);

					if (magic === Constants.MAGIC.MD20 || magic === Constants.MAGIC.MD21) {
						fileType = MODEL_TYPE_M2;
						fileName = Listfile.formatUnknownFile(fileDataID, '.m2');
					} else {
						// Naively assume that if it's not M2, then it's WMO. This could be better.
						fileType = MODEL_TYPE_WMO;
						fileName = Listfile.formatUnknownFile(fileDataID, '.wmo');
					}
				} else {
					// We already have a filename for this entry, so we can assume the file type via extension.
					const fileNameLower = fileName.toLowerCase();
					if (fileNameLower.endsWith('.m2') === true)
						fileType = MODEL_TYPE_M2;
					else if (fileNameLower.endsWith('.wmo') === true)
						fileType = MODEL_TYPE_WMO;
				}

				if (fileType === undefined)
					throw new Error(util.format('Unknown model file type for %d', fileDataID));

				let exportPath: string;
				if (isLocal) {
					exportPath = fileName;
				} else if (fileType === MODEL_TYPE_M2 && selectedSkinName !== null && fileName === activePath) {
					const baseFileName = path.basename(fileName, path.extname(fileName));
					let skinnedName: string;

					if (selectedSkinName.startsWith(baseFileName))
						skinnedName = ExportHelper.replaceBaseName(fileName, selectedSkinName);

					else
						skinnedName = ExportHelper.replaceBaseName(fileName, baseFileName + '_' + selectedSkinName);

					exportPath = ExportHelper.getExportPath(skinnedName);
				} else {
					exportPath = ExportHelper.getExportPath(fileName);
				}

				switch (format) {
					case 'RAW': {
						exportPaths.writeLine(exportPath);

						if (fileType === MODEL_TYPE_M2) {
							const exporter = new M2Exporter(data, getVariantTextureIDs(fileName), fileDataID);
							await exporter.exportRaw(exportPath, helper);
						} else if (fileType === MODEL_TYPE_WMO) {
							const exporter = new WMOExporter(data, fileDataID);
							await exporter.exportRaw(exportPath, helper);
						}
						break;
					}
					case 'OBJ':
					case 'GLTF':
						exportPath = ExportHelper.replaceExtension(exportPath, exportExtensions[format]);

						if (fileType === MODEL_TYPE_M2) {
							const exporter = new M2Exporter(data, getVariantTextureIDs(fileName), fileDataID);

							// Respect geoset masking for selected model.
							if (fileName == activePath)
								exporter.setGeosetMask(State.modelViewerGeosets);

							if (format === 'OBJ') {
								await exporter.exportAsOBJ(exportPath, State.config.modelsExportCollision, helper);
								exportPaths.writeLine('M2_OBJ:' + exportPath);
							}

							// Abort if the export has been cancelled.
							if (helper.isCancelled())
								return;
						} else if (fileType === MODEL_TYPE_WMO) {
							// WMO loading currently loads group objects directly from CASC.
							// In order to load these properly, we would need to know the internal name here.
							if (isLocal)
								throw new Error('Converting local WMO objects is currently not supported.');

							const exporter = new WMOExporter(data, fileName);

							// Respect group/set masking for selected WMO.
							if (fileName === activePath) {
								exporter.setGroupMask(State.modelViewerWMOGroups);
								exporter.setDoodadSetMask(State.modelViewerWMOSets);
							}

							if (format === 'OBJ') {
								await exporter.exportAsOBJ(exportPath, helper);
								exportPaths.writeLine('WMO_OBJ:' + exportPath);
							}

							WMOExporter.clearCache();

							// Abort if the export has been cancelled.
							if (helper.isCancelled())
								return;
						} else {
							throw new Error('Unexpected model format: ' + fileName);
						}

						break;

					default:
						throw new Error('Unexpected model export format: ' + format);
				}

				helper.mark(fileName, true);
			} catch (e) {
				helper.mark(fileName, false, e.message);
			}
		}

		helper.finish();
	}

	// Write export information.
	await exportPaths.close();
}

/**
 * Update the 3D model listfile.
 * Invoke when users change the visibility settings for model types.
 */
function updateListfile(): void {
	// Filters for the model viewer depending on user settings.
	const modelExt = Array<ListfileFilter>();
	if (State.config.modelsShowM2)
		modelExt.push('.m2');

	if (State.config.modelsShowWMO)
		modelExt.push({ ext: '.wmo', pattern: Constants.LISTFILE_MODEL_FILTER });

	// Create a new listfile using the given configuration.
	State.listfileModels = Listfile.getFilenamesByExtension(...modelExt);
}

// Register a drop handler for M2 files.
State.registerDropHandler({
	ext: ['.m2'],
	prompt: (count: number) => util.format('Export %d models as %s', count, State.config.exportModelFormat),
	process: (files: FileList) => exportFiles(files, true)
});

// The first time the user opens up the model tab, initialize 3D preview.
State.events.once('screen-tab-models', () => {
	camera = new THREE.PerspectiveCamera(70, undefined, 0.01, 2000);

	scene = new THREE.Scene();
	const light = new THREE.HemisphereLight(0xffffff, 0x080820, 1);
	scene.add(light);
	scene.add(renderGroup);

	grid = new THREE.GridHelper(100, 100, 0x57afe2, 0x808080);

	if (State.config.modelViewerShowGrid)
		scene.add(grid);

	// WoW models are by default facing the wrong way; rotate everything.
	renderGroup.rotateOnAxis(new THREE.Vector3(0, 1, 0), -90 * (Math.PI / 180));

	State.modelViewerContext = Object.seal({ camera, scene, controls: null });
});

State.registerLoadFunc(async () => {
	// Track changes to the visible model listfile types.
	State.$watch('config.modelsShowM2', updateListfile);
	State.$watch('config.modelsShowWMO', updateListfile);

	// When the selected model skin is changed, update our model.
	State.$watch('modelViewerSkinsSelection', async (selection: Array<SkinInfo>) => {
		// Don't do anything if we're lacking skins.
		if (!(activeRenderer instanceof M2Renderer) || activeSkins.size === 0)
			return;

		// Skin selector is single-select, should only be one item.
		const selected = selection[0];
		const display = activeSkins.get(selected.id);
		selectedSkinName = selected.id;

		const currGeosets = State.modelViewerGeosets;

		const creatureDisplay = display as CreatureDisplayInfoEntry;
		if (creatureDisplay.extraGeosets !== undefined) {
			for (const geoset of currGeosets) {
				if (geoset.id > 0 && geoset.id < 900)
					geoset.checked = false;
			}

			for (const extraGeoset of creatureDisplay.extraGeosets) {
				for (const geoset of currGeosets) {
					if (geoset.id === extraGeoset)
						geoset.checked = true;
				}
			}
		} else {
			for (const geoset of currGeosets) {
				const id = geoset.id.toString();
				geoset.checked = (id.endsWith('0') || id.endsWith('01'));
			}
		}

		const itemDisplay = display as ItemDisplayInfoEntry;
		if (itemDisplay.textures !== undefined && itemDisplay.textures.length > 0)
			selectedVariantTextureIDs = [...itemDisplay.textures];

		activeRenderer?.applyReplaceableTextures(display);
	});

	State.$watch('config.modelViewerShowGrid', () => {
		if (State.config.modelViewerShowGrid)
			scene.add(grid);
		else
			scene.remove(grid);
	});

	// Track selection changes on the model listbox and preview first model.
	State.$watch('selectionModels', async (selection: Array<string>) => {
		// Don't do anything if we're not loading models.
		if (!State.config.modelsAutoPreview)
			return;

		// Check if the first file in the selection is "new".
		const first = Listfile.stripFileEntry(selection[0]);
		if (!State.isBusy && first && activePath !== first)
			previewModel(first);
	});

	// Track when the user clicks to preview a model texture.
	State.events.on('click-preview-texture', async (fileDataID: number, displayName: string) => {
		await previewTextureByID(fileDataID, displayName);
	});

	// Track when the user clicks to export selected textures.
	State.events.on('click-export-model', async () => {
		const userSelection = State.selectionModels;
		if (userSelection.length === 0) {
			State.setToast('info', 'You didn\'t select any files to export; you should do that first.');
			return;
		}

		await exportFiles(userSelection, false);
	});
});