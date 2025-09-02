/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
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
const BLPFile = require('../casc/blp');

const DBItemDisplays = require('../db/caches/DBItemDisplays');
const DBCreatures = require('../db/caches/DBCreatures');

const M2Renderer = require('../3D/renderers/M2Renderer');
const M3Renderer = require('../3D/renderers/M3Renderer');
const M2Exporter = require('../3D/exporters/M2Exporter');
const M3Exporter = require('../3D/exporters/M3Exporter');

const WMORenderer = require('../3D/renderers/WMORenderer');
const WMOExporter = require('../3D/exporters/WMOExporter');

const textureRibbon = require('./texture-ribbon');
const textureExporter = require('./texture-exporter');
const uvDrawer = require('./uv-drawer');
// const AnimMapper = require('../3D/AnimMapper');

const MODEL_TYPE_M3 = Symbol('modelM3');
const MODEL_TYPE_M2 = Symbol('modelM2');
const MODEL_TYPE_WMO = Symbol('modelWMO');

const exportExtensions = {
	'OBJ': '.obj',
	'GLTF': '.gltf'
};

const activeSkins = new Map();
let selectedVariantTextureIDs = new Array();
let selectedSkinName = null;

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

/**
 * Clear the currently active texture preview.
 */
const clearTexturePreview = () => {
	core.view.modelTexturePreviewURL = '';
	core.view.modelTexturePreviewUVOverlay = '';
	core.view.modelViewerUVLayers = [];
};

/**
 * Initialize UV layers for the current model.
 */
const initializeUVLayers = () => {
	if (!activeRenderer || !activeRenderer.getUVLayers) {
		core.view.modelViewerUVLayers = [];
		return;
	}

	const uvLayerData = activeRenderer.getUVLayers();
	core.view.modelViewerUVLayers = [
		{ name: 'UV Off', data: null, active: true },
		...uvLayerData.layers
	];
};

/**
 * Toggle UV layer visibility.
 * @param {string} layerName - Name of the UV layer to toggle
 */
const toggleUVLayer = (layerName) => {
	const layer = core.view.modelViewerUVLayers.find(l => l.name === layerName);
	if (!layer)
		return;

	core.view.modelViewerUVLayers.forEach(l => {
		l.active = (l === layer);
	});

	if (layerName === 'UV Off' || !layer.data) {
		core.view.modelTexturePreviewUVOverlay = '';
	} else if (activeRenderer && activeRenderer.getUVLayers) {
		const uvLayerData = activeRenderer.getUVLayers();
		const overlayDataURL = uvDrawer.generateUVLayerDataURL(
			layer.data,
			core.view.modelTexturePreviewWidth,
			core.view.modelTexturePreviewHeight,
			uvLayerData.indices
		);
		core.view.modelTexturePreviewUVOverlay = overlayDataURL;
	}
};

/**
 * Preview a texture by the given fileDataID.
 * @param {number} fileDataID 
 * @param {string} name
 */
const previewTextureByID = async (fileDataID, name) => {
	const texture = listfile.getByID(fileDataID) ?? listfile.formatUnknownFile(fileDataID);

	core.view.isBusy++;
	core.setToast('progress', util.format('Loading %s, please wait...', texture), null, -1, false);
	log.write('Previewing texture file %s', texture);

	try {
		const view = core.view;
		const file = await core.view.casc.getFile(fileDataID);

		const blp = new BLPFile(file);

		view.modelTexturePreviewURL = blp.getDataURL(view.config.exportChannelMask);
		view.modelTexturePreviewWidth = blp.width;
		view.modelTexturePreviewHeight = blp.height;
		view.modelTexturePreviewName = name;

		// Initialize UV layers when texture preview is shown
		initializeUVLayers();

		core.hideToast();
	} catch (e) {
		if (e instanceof EncryptionError) {
			// Missing decryption key.
			core.setToast('error', util.format('The texture %s is encrypted with an unknown key (%s).', texture, e.key), null, -1);
			log.write('Failed to decrypt texture %s (%s)', texture, e.key);
		} else {
			// Error reading/parsing texture.
			core.setToast('error', 'Unable to preview texture ' + texture, { 'View Log': () => log.openRuntimeLog() }, -1);
			log.write('Failed to open CASC file: %s', e.message);
		}
	}

	core.view.isBusy--;
};

const previewModel = async (fileName) => {
	core.view.isBusy++;
	core.setToast('progress', util.format('Loading %s, please wait...', fileName), null, -1, false);
	log.write('Previewing model %s', fileName);

	// Reset texture ribbon.
	textureRibbon.reset();

	// Hide current texture preview.
	clearTexturePreview();

	// Reset skin selection.
	core.view.modelViewerSkins = [];
	core.view.modelViewerSkinsSelection = [];

	core.view.modelViewerAnims = [];

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
		selectedSkinName = null;

		const fileDataID = listfile.getByFilename(fileName);
		const file = await core.view.casc.getFile(fileDataID);
		let isM2 = false;
		let isM3 = false;

		const fileNameLower = fileName.toLowerCase();
		if (fileNameLower.endsWith('.m2')) {
			core.view.modelViewerActiveType = 'm2';
			activeRenderer = new M2Renderer(file, renderGroup, true, core.view.config.modelViewerShowTextures);
			isM2 = true;
		} else if (fileNameLower.endsWith('.m3')) {
			core.view.modelViewerActiveType = 'm3';
			activeRenderer = new M3Renderer(file, renderGroup, true, core.view.config.modelViewerShowTextures);
			isM3 = true;
		} else if (fileNameLower.endsWith('.wmo')) {
			core.view.modelViewerActiveType = 'wmo';
			activeRenderer = new WMORenderer(file, fileName, renderGroup, core.view.config.modelViewerShowTextures);
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

			// if (fileNameLower.endsWith('.m2')) {
			// 	const animList = [];

			// 	for (const animationID of Array.from(new Set(activeRenderer.m2.animations.map((animation) => animation.id))).sort())
			// 		animList.push({ id: animationID, label: AnimMapper.get_anim_name(animationID) });
				
			// 	core.view.modelViewerAnims = animList;
			// 	core.view.modelViewerAnimSelection = animList.slice(0, 1);
			// }
		} else if (isM3) {
			// TODO: M3
		}

		updateCameraBounding();

		activePath = fileName;

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

const exportFiles = async (files, isLocal = false, exportID = -1) => {
	const exportPaths = core.openLastExportStream();
	const format = core.view.config.exportModelFormat;

	const manifest = { type: 'MODELS', exportID, succeeded: [], failed: [] };

	if (format === 'PNG' || format === 'CLIPBOARD') {
		// For PNG exports, we only export the viewport, not the selected files.
		if (activePath) {
			core.setToast('progress', 'Saving preview, hold on...', null, -1, false);
			
			const canvas = document.getElementById('model-preview').querySelector('canvas');
			const buf = await BufferWrapper.fromCanvas(canvas, 'image/png');
			
			if (format === 'PNG') {
				const exportPath = ExportHelper.getExportPath(activePath);
				let outFile = ExportHelper.replaceExtension(exportPath, '.png');
				
				if (core.view.config.modelsExportPngIncrements)
					outFile = await ExportHelper.getIncrementalFilename(outFile);
				
				const outDir = path.dirname(outFile);

				await buf.writeToFile(outFile);
				await exportPaths?.writeLine('PNG:' + outFile);

				log.write('Saved 3D preview screenshot to %s', outFile);
				core.setToast('success', util.format('Successfully exported preview to %s', outFile), { 'View in Explorer': () => nw.Shell.openItem(outDir) }, -1);
			} else if (format === 'CLIPBOARD') {
				const clipboard = nw.Clipboard.get();
				clipboard.set(buf.toBase64(), 'png', true);

				log.write('Copied 3D preview to clipboard (%s)', activePath);
				core.setToast('success', '3D preview has been copied to the clipboard', null, -1, true);
			}
		} else {
			core.setToast('error', 'The selected export option only works for model previews. Preview something first!', null, -1);
		}
	} else {
		const casc = core.view.casc;
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
				fileName = listfile.getByID(fileDataID);
			} else {
				fileName = listfile.stripFileEntry(fileEntry);
				fileDataID = listfile.getByFilename(fileName);
			}

			const fileManifest = [];
			
			try {
				let fileType;
				const data = await (isLocal ? BufferWrapper.readFile(fileName) : casc.getFile(fileDataID));
				
				if (fileName === undefined) {
					// In the event that we're exporting a file by ID that does not exist in the listfile
					// then we can't presume the file type and need to investigate the headers.
					const magic = data.readUInt32LE();
					data.seek(0);

					if (magic == constants.MAGIC.M3DT) {
						fileType = MODEL_TYPE_M3;
						fileName = listfile.formatUnknownFile(fileDataID, '.m3');
					} else if (magic === constants.MAGIC.MD20 || magic === constants.MAGIC.MD21) {
						fileType = MODEL_TYPE_M2;
						fileName = listfile.formatUnknownFile(fileDataID, '.m2');
					} else {
						// Naively assume that if it's not M2, then it's WMO. This could be better.
						fileType = MODEL_TYPE_WMO;
						fileName = listfile.formatUnknownFile(fileDataID, '.wmo');
					}
				} else {
					// We already have a filename for this entry, so we can assume the file type via extension.
					const fileNameLower = fileName.toLowerCase();
					if (fileNameLower.endsWith('.m3') === true)
						fileType = MODEL_TYPE_M3;
					else if (fileNameLower.endsWith('.m2') === true)
						fileType = MODEL_TYPE_M2;
					else if (fileNameLower.endsWith('.wmo') === true)
						fileType = MODEL_TYPE_WMO;
				}

				if (!fileType)
					throw new Error('Unknown model file type for %d', fileDataID);

				let exportPath;
				if (isLocal) {
					exportPath = fileName;
				} else if (fileType === MODEL_TYPE_M2 && selectedSkinName !== null && fileName === activePath && format !== 'RAW') {
					const baseFileName = path.basename(fileName, path.extname(fileName));
					let skinnedName;

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
						await exportPaths?.writeLine(exportPath);

						let exporter;
						if (fileType === MODEL_TYPE_M2)
							exporter = new M2Exporter(data, getVariantTextureIDs(fileName), fileDataID);
						else if (fileType === MODEL_TYPE_M3)
							exporter = new M3Exporter(data, getVariantTextureIDs(fileName), fileDataID);
						else if (fileType === MODEL_TYPE_WMO)
							exporter = new WMOExporter(data, fileDataID);

						await exporter.exportRaw(exportPath, helper, fileManifest);
						if (fileType === MODEL_TYPE_WMO)
							WMOExporter.clearCache();
						break;
					}
					case 'OBJ':
					case 'GLTF':
						exportPath = ExportHelper.replaceExtension(exportPath, exportExtensions[format]);

						if (fileType === MODEL_TYPE_M2) {
							const exporter = new M2Exporter(data, getVariantTextureIDs(fileName), fileDataID);

							// Respect geoset masking for selected model.
							if (fileName == activePath)
								exporter.setGeosetMask(core.view.modelViewerGeosets);

							if (format === 'OBJ') {
								await exporter.exportAsOBJ(exportPath, core.view.config.modelsExportCollision, helper, fileManifest);
								await exportPaths?.writeLine('M2_OBJ:' + exportPath);
							} else if (format === 'GLTF') {
								await exporter.exportAsGLTF(exportPath, helper, fileManifest);
								await exportPaths?.writeLine('M2_GLTF:' + exportPath);
							}

							// Abort if the export has been cancelled.
							if (helper.isCancelled())
								return;
						} else if (fileType === MODEL_TYPE_M3) {
							const exporter = new M3Exporter(data, getVariantTextureIDs(fileName), fileDataID);

							// Respect geoset masking for selected model.
							// if (fileName == activePath)
							// 	exporter.setGeosetMask(core.view.modelViewerGeosets);

							if (format === 'OBJ') {
								await exporter.exportAsOBJ(exportPath, core.view.config.modelsExportCollision, helper, fileManifest);
								await exportPaths?.writeLine('M3_OBJ:' + exportPath);
							} else if (format === 'GLTF') {
								await exporter.exportAsGLTF(exportPath, helper, fileManifest);
								await exportPaths?.writeLine('M3_GLTF:' + exportPath);
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
								exporter.setGroupMask(core.view.modelViewerWMOGroups);
								exporter.setDoodadSetMask(core.view.modelViewerWMOSets);
							}

							if (format === 'OBJ') {
								await exporter.exportAsOBJ(exportPath, helper, fileManifest);
								await exportPaths?.writeLine('WMO_OBJ:' + exportPath);
							} else if (format === 'GLTF') {
								await exporter.exportAsGLTF(exportPath, helper);
								await exportPaths?.writeLine('WMO_GLTF:' + exportPath, fileManifest);
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
				manifest.succeeded.push({ fileDataID, files: fileManifest });
			} catch (e) {
				helper.mark(fileName, false, e.message, e.stack);
				manifest.failed.push({ fileDataID });
			}
		}

		helper.finish();
	}

	// Write export information.
	exportPaths?.close();

	// Dispatch file manifest to RCP.
	core.rcp.dispatchHook('HOOK_EXPORT_COMPLETE', manifest);
};

/**
 * Update the 3D model listfile.
 * Invoke when users change the visibility settings for model types.
 */
const updateListfile = () => {
	// Filters for the model viewer depending on user settings.
	const modelExt = [];
	if (core.view.config.modelsShowM3)
		modelExt.push('.m3');

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
	const light = new THREE.HemisphereLight(0xffffff, 0x080820, 3);
	scene.add(light);
	scene.add(renderGroup);

	if (core.view.config.modelViewerShowBackground)
		scene.background = new THREE.Color(core.view.config.modelViewerBackgroundColor);

	grid = new THREE.GridHelper(100, 100, 0x57afe2, 0x808080);

	if (core.view.config.modelViewerShowGrid)
		scene.add(grid);

	// WoW models are by default facing the wrong way; rotate everything.
	renderGroup.rotateOnAxis(new THREE.Vector3(0, 1, 0), -90 * (Math.PI / 180));

	core.view.modelViewerContext = Object.seal({ camera, scene, controls: null });
});

core.events.on('rcp-export-models', (files, id) => {
	// RCP should provide an array of fileDataIDs to export.
	exportFiles(files, false, id);
});

core.registerLoadFunc(async () => {
	// Track changes to the visible model listfile types.
	core.view.$watch('config.modelsShowM3', updateListfile);
	core.view.$watch('config.modelsShowM2', updateListfile);
	core.view.$watch('config.modelsShowWMO', updateListfile);

	// When the selected model skin is changed, update our model.
	core.view.$watch('modelViewerSkinsSelection', async selection => {
		// Don't do anything if we're lacking skins.
		if (!activeRenderer || activeSkins.size === 0)
			return;

		// Skin selector is single-select, should only be one item.
		const selected = selection[0];
		const display = activeSkins.get(selected.id);
		selectedSkinName = selected.id;

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

	core.view.$watch('config.modelViewerShowBackground', () => {
		if (core.view.config.modelViewerShowBackground)
			scene.background = new THREE.Color(core.view.config.modelViewerBackgroundColor);
		else
			scene.background = null;
	});

	core.view.$watch('config.modelViewerBackgroundColor', () => {
		if (core.view.config.modelViewerShowBackground)
			scene.background = new THREE.Color(core.view.config.modelViewerBackgroundColor);
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

	// Track when the user clicks to preview a model texture.
	core.events.on('click-preview-texture', async (fileDataID, displayName) => {
		await previewTextureByID(fileDataID, displayName);
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

	// Track when the user clicks to toggle UV layer.
	core.events.on('toggle-uv-layer', (layerName) => {
		toggleUVLayer(layerName);
	});

	// Track when the user clicks to export a texture from the ribbon.
	core.events.on('click-export-ribbon-texture', async (fileDataID, displayName) => {
		await textureExporter.exportSingleTexture(fileDataID);
	});

});