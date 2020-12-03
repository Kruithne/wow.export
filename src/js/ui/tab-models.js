/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Martin Benjamins <marlamin@marlamin.com>
	License: MIT
 */
const core = require('../core');
const log = require('../log');
const util = require('util');
const path = require('path');
const listfile = require('../casc/listfile');
const constants = require('../constants');

const DBItemDisplays = require('../db/caches/DBItemDisplays');
const DBCharacters = require('../db/caches/DBCharacter');
const DBCreatures = require('../db/caches/DBCreatures');

const EncryptionError = require('../casc/blte-reader').EncryptionError;
const BufferWrapper = require('../buffer');
const ExportHelper = require('../casc/export-helper');

const M2Renderer = require('../3D/renderers/M2Renderer');
const M2Exporter = require('../3D/exporters/M2Exporter');

const WMORenderer = require('../3D/renderers/WMORenderer');
const WMOExporter = require('../3D/exporters/WMOExporter');


const exportExtensions = {
	'OBJ': '.obj',
	'GLTF': '.gltf'
};

const activeSkins = new Map();
let selectedVariantTexID = 0;

let selectedFile = null;
let isFirstModel = true;

let camera, scene, grid;
const renderGroup = new THREE.Group();

let activeRenderer;
let activePath;

const previewModel = async (fileName) => {
	core.view.isBusy++;
	core.setToast('progress', util.format('Loading %s, please wait...', fileName), null, -1, false);
	log.write('Previewing model %s', fileName);

	try {
		// Dispose the currently active renderer.
		if (activeRenderer) {
			activeRenderer.dispose();
			activeRenderer = null;
			activePath = null;
		}

		// Hide controls by default.
		core.view.modelViewerShowChrCust = false;
		core.view.modelViewerShowSkins = false;

		// Clear the active skin map.
		activeSkins.clear();
		selectedVariantTexID = 0;

		const fileDataID = listfile.getByFilename(fileName);
		core.view.modelViewerCurrFileDataID = fileDataID;

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
			// Check if model is a character model
			if (DBCharacters.isCharacterCustomizationAvailable() && DBCharacters.isFileDataIDCharacterModel(fileDataID)) {
				core.view.modelViewerShowChrCust = true;
				try {
					let defaultOptions = new Map();

					let categoryList = new Array();
					const chrModelID = DBCharacters.getChrModelIDByFileDataID(fileDataID);
					const optionsForModel = DBCharacters.getOptionsByChrModelID(chrModelID);

					for (const chrCustomizationOption of optionsForModel) {
						if (!(chrCustomizationOption.name in categoryList)) {
							categoryList.push({ id: chrCustomizationOption.id, label: chrCustomizationOption.name});
							let choices = DBCharacters.getChoicesByOption(chrCustomizationOption.id);
							for (const chrCustomizationChoice of choices) {
								if (!(chrCustomizationOption.id in defaultOptions)) {
									defaultOptions.set(chrCustomizationOption.id, chrCustomizationChoice.id);
									break;
								}
							}
						}
					}

					core.view.modelViewerChrCustCategories = categoryList;
					core.view.modelViewerSelectedChrCustCategory = categoryList.slice(0, 1);		
					core.view.modelViewerChrCustCurrent = defaultOptions;
				} catch (e) {
					log.write('Unable to load character customization system: %s', e.message);
				}
			} else {
				// Not a character model, check for creature skins.
				let displays = DBCreatures.getCreatureDisplaysByFileDataID(fileDataID);
				let isFirst = true;
				const skinList = [];
				let modelName = listfile.getByID(fileDataID);
				modelName = path.basename(modelName, '.m2');
				
				// Check for item textures
				if (displays === undefined)
					displays = DBItemDisplays.getItemDisplaysByFileDataID(fileDataID);

				if (displays !== undefined) {
					for (const display of displays) {
						if (display.textures.length == 0)
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

						if (cleanSkinName == '')
							cleanSkinName = 'base';

						if (display.extraGeosets?.length > 0)
							skinName = skinName + display.extraGeosets.join(',');

						cleanSkinName = cleanSkinName + ' (' + display.ID + ')';

						if (activeSkins.has(skinName))
							continue;

						// Push the skin onto the display list.
						skinList.push({ id: skinName, label: cleanSkinName });

						// Keep a mapping of the name -> fileDataID for user selects.
						activeSkins.set(skinName, display);
						isFirst = false;
					}
				}

				core.view.modelViewerShowSkins = true;
				core.view.modelViewerSkins = skinList;
				core.view.modelViewerSkinsSelection = skinList.slice(0, 1);		
			}
		}

		updateCameraBounding();

		activePath = fileName;

		// Renderer did not provide any 3D data.
		if (renderGroup.children.length === 0)
			core.setToast('info', util.format('The model %s doesn\'t have any 3D data associated with it.', fileName), null, 4000);
		else
			core.hideToast();

		selectedFile = fileName;
	} catch (e) {
		if (e instanceof EncryptionError) {
			// Missing decryption key.
			core.setToast('error', util.format('The model %s is encrypted with an unknown key (%s).', fileName, e.key));
			log.write('Failed to decrypt model %s (%s)', fileName, e.key);
		} else {
			// Error reading/parsing model.
			core.setToast('error', 'Unable to preview model ' + fileName, { 'View Log': () => log.openRuntimeLog() });
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

const exportFiles = async (files, isLocal = false) => {
	const format = core.view.config.exportModelFormat;
	if (format === 'PNG') {
		// For PNG exports, we only export the viewport, not the selected files.
		if (activePath) {
			core.setToast('progress', 'Saving preview, hold on...', null, -1, false);
			const exportPath = ExportHelper.getExportPath(activePath);

			const canvas = document.getElementById('model-preview').querySelector('canvas');
			const buf = await BufferWrapper.fromCanvas(canvas, 'image/png');
			await buf.writeToFile(ExportHelper.replaceExtension(exportPath, '.png'));

			log.write('Saved 3D preview screenshot to %s', exportPath);
			core.setToast('success', util.format('Successfully exported preview to %s!', exportPath));
		} else {
			core.setToast('error', 'The PNG export option only works for model previews. Preview something first!');
		}
	} else {
		const exportSkins = core.view.config.modelsExportSkin;
		const helper = new ExportHelper(files.length, 'model');
		helper.start();

		for (const fileName of files) {
			// Abort if the export has been cancelled.
			if (helper.isCancelled())
				return;

			try {
				const data = await (isLocal ? BufferWrapper.readFile(fileName) : core.view.casc.getFileByName(fileName));
				let exportPath = isLocal ? fileName : ExportHelper.getExportPath(fileName);
				const fileNameLower = fileName.toLowerCase();

				switch (format) {
					case 'RAW':
						// Export as raw file with no conversions.
						await data.writeToFile(exportPath);

						if (exportSkins === true && fileNameLower.endsWith('.m2') === true) {
							const exporter = new M2Exporter(data, selectedVariantTexID);
							await exporter.exportTextures(exportPath, true, null, helper);

							const skins = exporter.m2.getSkinList();
							const skinPath = path.dirname(exportPath);
							for (const skin of skins) {
								// Abort if the export has been cancelled.
								if (helper.isCancelled())
									return;

								const skinData = await core.view.casc.getFile(skin.fileDataID);
								await skinData.writeToFile(path.join(skinPath, path.basename(skin.fileName)));
							}
						}
						break;

					case 'OBJ':
					case 'GLTF':
						exportPath = ExportHelper.replaceExtension(exportPath, exportExtensions[format]);

						if (fileNameLower.endsWith('.m2')) {
							const exporter = new M2Exporter(data, selectedVariantTexID);

							// Respect geoset masking for selected model.
							if (fileName == activePath)
								exporter.setGeosetMask(core.view.modelViewerGeosets);

							if (format === 'OBJ')
								await exporter.exportAsOBJ(exportPath, core.view.config.modelsExportCollision, helper);
							else if (format === 'GLTF')
								await exporter.exportAsGLTF(exportPath, helper);

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

							if (format === 'OBJ')
								await exporter.exportAsOBJ(exportPath, helper);
							else if (format === 'GLTF')
								await exporter.exportAsGLTF(exportPath, helper);
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
	core.view.listfileModels = listfile.getFilenamesByExtension(modelExt);
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
			for (let j = 0; j < currGeosets.length; j++) {
				if (currGeosets[j].id > 0 && currGeosets[j].id < 900)
					currGeosets[j].checked = false;
			}

			for (let i = 0; i < display.extraGeosets.length; i++) {
				for (let j = 0; j < currGeosets.length; j++) {
					if (currGeosets[j].id == display.extraGeosets[i])
						currGeosets[j].checked = true;
				}
			}
		} else {
			for (let i = 0; i < currGeosets.length; i++)
				currGeosets[i].checked = (currGeosets[i].id.toString().endsWith('0') || currGeosets[i].id.toString().endsWith('01'));
		}

		const fileDataID = display.textures[0];
		if (fileDataID !== undefined) {
			selectedVariantTexID = fileDataID;
			activeRenderer.loadNPCVariantTexture(fileDataID);
		}
	});

	// When the selected customization option is changed, update choice listbox.
	core.view.$watch('modelViewerSelectedChrCustCategory', async selection => {
		if (!activeRenderer)
			return;

		// Option selector is single-select, should only be one item.
		const selectedOptionID = selection[0].id;

		let choiceList = DBCharacters.getChoicesByOption(selectedOptionID);
		let currentlySelectedIndex = 0;

		// Check if user had already selected a choice, if so, select that later on. 
		for (let i = 0; i < choiceList.length; i++) {
			if (core.view.modelViewerChrCustCurrent.has(selectedOptionID) && core.view.modelViewerChrCustCurrent.get(selectedOptionID) == choiceList[i].id)
				currentlySelectedIndex = i;
		}

		core.view.modelViewerChrCustChoices = choiceList;
		core.view.modelViewerSelectedChrCustChoice = [choiceList[currentlySelectedIndex]];	
	});

	// When the selected customization choice is changed, update geosets.
	core.view.$watch('modelViewerSelectedChrCustChoice', async selection => {
		if (!activeRenderer)
			return;

		// Option selector is single-select, should only be one item.
		const selectedChoiceID = selection[0].id;
		activeRenderer.applyCharacterCustomizationChoice(selectedChoiceID);

		// Set current choice for this option to the newly selected choice.
		core.view.modelViewerChrCustCurrent.set(core.view.modelViewerSelectedChrCustCategory[0].id, selectedChoiceID);
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
		const first = selection[0];
		if (!core.view.isBusy && first && selectedFile !== first)
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