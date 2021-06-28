/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../core');
const log = require('../log');
const util = require('util');
const path = require('path');
const BufferWrapper = require('../buffer');
const ExportHelper = require('../casc/export-helper');
const listfile = require('../casc/listfile');
const constants = require('../constants');
const EncryptionError = require('../casc/blte-reader').EncryptionError;
const FileWriter = require('../file-writer');

const DBItemDisplays = require('../db/caches/DBItemDisplays');
const DBCreatures = require('../db/caches/DBCreatures');

const M2Renderer = require('../3D/renderers/M2Renderer');
const M2Exporter = require('../3D/exporters/M2Exporter');

const WMORenderer = require('../3D/renderers/WMORenderer');
const WMOExporter = require('../3D/exporters/WMOExporter');
const WMOLoader = require('../3D/loaders/WMOLoader');

const WDCReader = require('../db/WDCReader');

const exportExtensions = {
	'OBJ': '.obj',
	'GLTF': '.gltf'
};

const activeSkins = new Map();
let selectedVariantTextureIDs = new Array();

let isFirstModel = true;

let camera, scene, grid;
const renderGroup = new THREE.Group();

let activeRenderer;
let activePath;

/**
 * Lookup model displays for items/creatures.
 * @param {number} fileDataID 
 * @returns {Array}
 */
const getModelDisplays = (fileDataID) => {
	let displays = DBCreatures.getCreatureDisplaysByFileDataID(fileDataID);

	if (displays === undefined)
		displays = DBItemDisplays.getItemDisplaysByFileDataID(fileDataID);

	return displays ?? [];
};

const previewModel = async (fileName) => {
	core.view.isBusy++;
	core.setToast('progress', util.format('Loading %s, please wait...', fileName), null, -1, false);
	log.write('Previewing model %s', fileName);

	// Reset skin selection.
	core.view.modelViewerSkins = [];
	core.view.modelViewerSkinsSelection = [];

	try {
		// Dispose the currently active renderer.
		if (activeRenderer) {
			activeRenderer.dispose();
			activeRenderer = null;
			activePath = null;
		}

		// Clear the active skin map.
		activeSkins.clear();
		selectedVariantTextureIDs.length = 0;

		const fileDataID = listfile.getByFilename(fileName);
		const file = await core.view.casc.getFile(fileDataID);
		let isM2 = false;

		const fileNameLower = fileName.toLowerCase();
		if (fileNameLower.endsWith('.m2')) {
			core.view.modelViewerActiveType = 'm2';
			activeRenderer = new M2Renderer(file, renderGroup, true);
			isM2 = true;
		} else if (fileNameLower.endsWith('.wmo')) {
			core.view.modelViewerActiveType = 'wmo';
			activeRenderer = new WMORenderer(file, fileName, renderGroup);
		} else {
			throw new Error('Unknown model extension: %s', fileName);
		}

		await activeRenderer.load();

		if (isM2) {
			const displays = getModelDisplays(fileDataID);

			const skinList = [];
			let modelName = listfile.getByID(fileDataID);
			modelName = path.basename(modelName, 'm2');

			for (const display of displays) {
				if (display.textures.length === 0)
					continue;

				const texture = display.textures[0];

				let cleanSkinName = '';
				let skinName = listfile.getByID(texture);
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

				if (display.extraGeosets?.length > 0)
					skinName += display.extraGeosets.join(',');

				cleanSkinName += ' (' + display.ID + ')';

				if (activeSkins.has(skinName))
					continue;

				// Push the skin onto the display list.
				skinList.push({ id: skinName, label: cleanSkinName });

				// Keep a mapping of the name -> fileDataID for user selects.
				activeSkins.set(skinName, display);
			}

			core.view.modelViewerSkins = skinList;
			core.view.modelViewerSkinsSelection = skinList.slice(0, 1);
		}

		updateCameraBounding();

		activePath = fileName;
		console.log(activeRenderer);

		// Renderer did not provide any 3D data.
		if (renderGroup.children.length === 0)
			core.setToast('info', util.format('The model %s doesn\'t have any 3D data associated with it.', fileName), null, 4000);
		else
			core.hideToast();
	} catch (e) {
		if (e instanceof EncryptionError) {
			// Missing decryption key.
			core.setToast('error', util.format('The model %s is encrypted with an unknown key (%s).', fileName, e.key), null, -1);
			log.write('Failed to decrypt model %s (%s)', fileName, e.key);
		} else {
			// Error reading/parsing model.
			core.setToast('error', 'Unable to preview model ' + fileName, { 'View Log': () => log.openRuntimeLog() }, -1);
			log.write('Failed to open CASC file: %s', e.message);
		}
	}

	core.view.isBusy--;
};

/**
 * Update the camera to match render group bounding.
 */
const updateCameraBounding = () => {
	// Get the bounding box for the model.
	const boundingBox = new THREE.Box3();
	boundingBox.setFromObject(renderGroup);

	// Calculate center point and size from bounding box.
	const center = boundingBox.getCenter(new THREE.Vector3());
	const size = boundingBox.getSize(new THREE.Vector3());

	const maxDim = Math.max(size.x, size.y, size.z);
	const fov = camera.fov * (Math.PI / 180);
	let cameraZ = (Math.abs(maxDim / 4 * Math.tan(fov * 2))) * 6;

	if (isFirstModel || core.view.modelViewerAutoAdjust) {
		camera.position.set(center.x, center.y, cameraZ);
		isFirstModel = false;
	}

	const minZ = boundingBox.min.z;
	const cameraToFarEdge = (minZ < 0) ? -minZ + cameraZ : cameraZ - minZ;

	camera.updateProjectionMatrix();

	const controls = core.view.modelViewerContext.controls;
	if (controls) {
		controls.target = center;
		controls.maxDistance = cameraToFarEdge * 2;
	}
};

/**
 * Resolves variant texture IDs based on user selection.
 * @param {string} fileName 
 * @returns {Array}
 */
const getVariantTextureIDs = (fileName) => {
	if (fileName === activePath) {
		// Selected model may have user-selected skins, use them.
		return selectedVariantTextureIDs;
	} else {
		// Resolve default skins for auxiliary selections.
		const fileDataID = listfile.getByFilename(fileName);
		const displays = getModelDisplays(fileDataID);

		return displays.find(e => e.textures.length > 0)?.textures ?? [];
	}
};

const exportFiles = async (files, isLocal = false) => {
	const exportPaths = new FileWriter(constants.LAST_EXPORT, 'utf8');
	const format = core.view.config.exportModelFormat;
	if (format === 'PNG') {
		// For PNG exports, we only export the viewport, not the selected files.
		if (activePath) {
			core.setToast('progress', 'Saving preview, hold on...', null, -1, false);
			const exportPath = ExportHelper.getExportPath(activePath);

			const canvas = document.getElementById('model-preview').querySelector('canvas');
			const buf = await BufferWrapper.fromCanvas(canvas, 'image/png');

			const outFile = ExportHelper.replaceExtension(exportPath, '.png');
			await buf.writeToFile(outFile);
			exportPaths.writeLine('PNG:' + outFile);

			log.write('Saved 3D preview screenshot to %s', exportPath);
			core.setToast('success', util.format('Successfully exported preview to %s!', exportPath), null, -1);
		} else {
			core.setToast('error', 'The PNG export option only works for model previews. Preview something first!', null, -1);
		}
	} else {
		const casc = core.view.casc;
		const config = core.view.config;

		const exportWMOGroups = core.view.config.modelsExportWMOGroups;
		const helper = new ExportHelper(files.length, 'model');
		helper.start();

		for (let fileName of files) {
			// Abort if the export has been cancelled.
			if (helper.isCancelled())
				return;

			fileName = listfile.stripFileEntry(fileName);
			const fileDataID = listfile.getByFilename(fileName);
			
			try {
				const data = await (isLocal ? BufferWrapper.readFile(fileName) : casc.getFileByName(fileName));
				let exportPath = isLocal ? fileName : ExportHelper.getExportPath(fileName);
				const fileNameLower = fileName.toLowerCase();

				switch (format) {
					case 'RAW':
						// Export as raw file with no conversions.
						await data.writeToFile(exportPath);
						exportPaths.writeLine(exportPath);

						const outDir = path.dirname(exportPath);
						const loadM2 = config.modelsExportSkin || config.modelsExportSkel || config.modelsExportBone;
						if (loadM2 && fileNameLower.endsWith('.m2') === true) {
							const exporter = new M2Exporter(data, getVariantTextureIDs(fileName), fileDataID);
							const m2 = exporter.m2;
							await m2.load();

							if (config.modelsExportSkin === true) {
								await exporter.exportTextures(exportPath, true, null, helper);

								const skins = m2.getSkinList();
								for (const skin of skins) {
									// Abort if the export has been cancelled.
									if (helper.isCancelled())
										return;

									const skinData = await casc.getFile(skin.fileDataID);
									await skinData.writeToFile(path.join(outDir, path.basename(skin.fileName)));
								}
							}

							const basename = path.basename(fileName);
							if (config.modelsExportSkel && m2.skeletonFileID) {
								const skelData = await casc.getFile(m2.skeletonFileID);
								await skelData.writeToFile(path.join(outDir, basename + '.skel'));
							}

							if (config.modelsExportBone && m2.boneFileIDs) {
								for (let i = 0, n = m2.boneFileIDs.length; i < n; i++) {
									const boneData = await casc.getFile(m2.boneFileIDs[i]);
									await boneData.writeToFile(path.join(outDir, basename + '_' + i + '.bone'));
								}
							}
						} else if (fileNameLower.endsWith('.wmo') === true) {
							const exporter = new WMOExporter(data, fileDataID);
							const wmo = exporter.wmo;
							await wmo.load();

							// Export raw textures.
							await exporter.exportTextures(exportPath, null, helper, true);

							if (exportWMOGroups === true) {
								for (let i = 0, n = wmo.groupCount; i < n; i++) {
									// Abort if the export has been cancelled.
									if (helper.isCancelled())
										return;

									const groupName = fileName.replace('.wmo', '_' + i.toString().padStart(3, '0') + '.wmo');
									let groupData;
									if (wmo.groupIDs)
										groupData = await casc.getFile(wmo.groupIDs[i]);
									else
										groupData = await casc.getFileByName(groupName);

									await groupData.writeToFile(path.join(outDir, path.basename(groupName)));
								}
							}
						}
						break;

					case 'OBJ':
					case 'GLTF':
						exportPath = ExportHelper.replaceExtension(exportPath, exportExtensions[format]);

						if (fileNameLower.endsWith('.m2')) {
							const exporter = new M2Exporter(data, getVariantTextureIDs(fileName), fileDataID);

							// Respect geoset masking for selected model.
							if (fileName == activePath)
								exporter.setGeosetMask(core.view.modelViewerGeosets);

							if (format === 'OBJ') {
								await exporter.exportAsOBJ(exportPath, core.view.config.modelsExportCollision, helper);
								exportPaths.writeLine('M2_OBJ:' + exportPath);
							} else if (format === 'GLTF') {
								await exporter.exportAsGLTF(exportPath, helper);
								exportPaths.writeLine('M2_GLTF:' + exportPath);
							}

							// Abort if the export has been cancelled.
							if (helper.isCancelled())
								return;
						} else if (fileNameLower.endsWith('.wmo')) {
							// WMO loading currently loads group objects directly from CASC.
							// In order to load these properly, we would need to know the internal name here.
							if (isLocal)
								throw new Error('Converting local WMO objects is currently not supported.');

							const exporter = new WMOExporter(data, fileName);

							// Respect group/set masking for selected WMO.
							if (fileName === activePath) {
								exporter.setGroupMask(core.view.modelViewerWMOGroups);
								exporter.setDoodadSetMask(core.view.modelViewerWMOSets);
							}

							if (format === 'OBJ') {
								await exporter.exportAsOBJ(exportPath, helper);
								exportPaths.writeLine('WMO_OBJ:' + exportPath);
							} else if (format === 'GLTF') {
								await exporter.exportAsGLTF(exportPath, helper);
								exportPaths.writeLine('WMO_GLTF:' + exportPath);
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
};

/**
 * Update the 3D model listfile.
 * Invoke when users change the visibility settings for model types.
 */
const updateListfile = () => {
	// Filters for the model viewer depending on user settings.
	const modelExt = [];
	if (core.view.config.modelsShowM2)
		modelExt.push('.m2');
	
	if (core.view.config.modelsShowWMO)
		modelExt.push(['.wmo', constants.LISTFILE_MODEL_FILTER]);

	// Create a new listfile using the given configuration.
	core.view.listfileModels = listfile.getFilenamesByExtension(modelExt, core.view.config.listfileShowFileDataIDs);
};

// Register a drop handler for M2 files.
core.registerDropHandler({
	ext: ['.m2'],
	prompt: count => util.format('Export %d models as %s', count, core.view.config.exportModelFormat),
	process: files => exportFiles(files, true)
});

// The first time the user opens up the model tab, initialize 3D preview.
core.events.once('screen-tab-models', () => {
	camera = new THREE.PerspectiveCamera(70, undefined, 0.01, 2000);

	scene = new THREE.Scene();
	const light = new THREE.HemisphereLight(0xffffff, 0x080820, 1);
	scene.add(light);
	scene.add(renderGroup);

	grid = new THREE.GridHelper(100, 100, 0x57afe2, 0x808080);

	if (core.view.config.modelViewerShowGrid)
		scene.add(grid);

	// WoW models are by default facing the wrong way; rotate everything.
	renderGroup.rotateOnAxis(new THREE.Vector3(0, 1, 0), -90 * (Math.PI / 180));

	core.view.modelViewerContext = Object.seal({ camera, scene, controls: null });
});

core.registerLoadFunc(async () => {
	// Track changes to the visible model listfile types.
	core.view.$watch('config.modelsShowM2', updateListfile);
	core.view.$watch('config.modelsShowWMO', updateListfile);

	// When users toggle the sidebar, we need to manually dispatch a
	// resize event for the window so the modelview component corrects.
	core.view.$watch('config.modelsShowSidebar', () => {
		window.dispatchEvent(new Event('resize'));
	});

	// When the selected model skin is changed, update our model.
	core.view.$watch('modelViewerSkinsSelection', async selection => {
		// Don't do anything if we're lacking skins.
		if (!activeRenderer || activeSkins.size === 0)
			return;

		// Skin selector is single-select, should only be one item.
		const selected = selection[0];
		const display = activeSkins.get(selected.id);

		let currGeosets = core.view.modelViewerGeosets;

		if (display.extraGeosets !== undefined) {
			for (const geoset of currGeosets) {
				if (geoset.id > 0 && geoset.id < 900)
					geoset.checked = false;
			}

			for (const extraGeoset of display.extraGeosets) {
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

		if (display.textures.length > 0)
			selectedVariantTextureIDs = [...display.textures];

		activeRenderer.applyReplaceableTextures(display);
	});

	core.view.$watch('config.modelViewerShowGrid', () => {
		if (core.view.config.modelViewerShowGrid)
			scene.add(grid);
		else
			scene.remove(grid);
	});

	// Track selection changes on the model listbox and preview first model.
	core.view.$watch('selectionModels', async selection => {
		// Don't do anything if we're not loading models.
		if (!core.view.config.modelsAutoPreview)
			return;

		// Check if the first file in the selection is "new".
		const first = listfile.stripFileEntry(selection[0]);
		if (!core.view.isBusy && first && activePath !== first)
			previewModel(first);
	});

	// Track when the user clicks to export selected textures.
	core.events.on('click-export-model', async () => {
		const userSelection = core.view.selectionModels;
		if (userSelection.length === 0) {
			core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
			return;
		}

		await exportFiles(userSelection, false);
	});
});