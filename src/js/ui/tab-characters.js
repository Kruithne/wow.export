/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../core');
const log = require('../log');
const path = require('path');
const util = require('util');
const CharMaterialRenderer = require('../3D/renderers/CharMaterialRenderer');
const M2Renderer = require('../3D/renderers/M2Renderer');
const M2Exporter = require('../3D/exporters/M2Exporter');
const WDCReader = require('../db/WDCReader');
const BufferWrapper = require('../buffer');
const ExportHelper = require('../casc/export-helper');
const FileWriter = require('../file-writer');
const listfile = require('../casc/listfile');

let camera;
let scene;
let grid;

const activeSkins = new Map();
const renderGroup = new THREE.Group();

let isFirstModel = true;
let activeRenderer;
let activeModel;

// TODO: Need to make these accessible while in the character tab. Not sure how scope works here.
const chrModelIDToFileDataID = new Map();
const chrModelIDToTextureLayoutID = new Map();
const optionsByChrModel = new Map();
const optionToChoices = new Map();
const chrRaceMap = new Map();
const chrRaceXChrModelMap = new Map();
const choiceToGeoset = new Map();
const choiceToChrCustMaterialID = new Map();
const geosetMap = new Map();
const chrCustMatMap = new Map();
const chrModelTextureLayerMap = new Map();
const charComponentTextureSectionMap = new Map();
const chrModelMaterialMap = new Map();

const chrMaterials = new Map();

let currentCharComponentTextureLayoutID = 0;

// Can we just keep DB2s opened? 
let chrCustChoiceDB;
let chrCustOptDB;
let chrCustElementDB;
let chrCustGeosetDB;

core.events.once('screen-tab-characters', async () => {
	const state = core.view;

	// Initialize a loading screen.
	const progress = core.createProgress(5);
	core.view.setScreen('loading');
	core.view.isBusy++;

	await progress.step('Loading character models..');
	const chrModelDB = new WDCReader('DBFilesClient/ChrModel.db2');
	await chrModelDB.parse();

	await progress.step('Loading character customization choices...');
	chrCustChoiceDB = new WDCReader('DBFilesClient/ChrCustomizationChoice.db2');
	await chrCustChoiceDB.parse();

	await progress.step('Loading character customization options...');
	chrCustOptDB = new WDCReader('DBFilesClient/ChrCustomizationOption.db2');
	await chrCustOptDB.parse();

	// TODO: We already have these loaded through DBCreatures cache. Get from there instead.
	await progress.step('Loading creature display info...');
	const creatureDisplayInfoDB = new WDCReader('DBFilesClient/CreatureDisplayInfo.db2');
	await creatureDisplayInfoDB.parse();

	await progress.step('Loading creature model data...');
	const creatureModelDataDB = new WDCReader('DBFilesClient/CreatureModelData.db2');
	await creatureModelDataDB.parse();

	// TODO: There is so many DB2 loading below relying on fields existing, we should probably check for them first and handle missing ones gracefully.

	for (const [chrModelID, chrModelRow] of chrModelDB.getAllRows()) {
		const displayRow = creatureDisplayInfoDB.getRow(chrModelRow.DisplayID);
		if (displayRow === null) {
			log.write(`No display info for chrModelID ${chrModelID}, DisplayID ${chrModelRow.DisplayID} not found, skipping.`);
			continue;
		}

		const modelRow = creatureModelDataDB.getRow(displayRow.ModelID);
		if (modelRow === null) {
			log.write(`No model data found for CreatureModelDataID ${displayRow.ModelID}, skipping.`);
			continue;
		}

		chrModelIDToFileDataID.set(chrModelID, modelRow.FileDataID);
		chrModelIDToTextureLayoutID.set(chrModelID, chrModelRow.CharComponentTextureLayoutID);

		for (const [chrCustomizationOptionID, chrCustomizationOptionRow] of chrCustOptDB.getAllRows()) {
			if (chrCustomizationOptionRow.ChrModelID != chrModelID)
				continue;

			const choiceList = [];

			if (!optionsByChrModel.has(chrCustomizationOptionRow.ChrModelID))
				optionsByChrModel.set(chrCustomizationOptionRow.ChrModelID, []);

			optionsByChrModel.get(chrCustomizationOptionRow.ChrModelID).push({ id: chrCustomizationOptionID, label: chrCustomizationOptionRow.Name_lang });

			for (const [chrCustomizationChoiceID, chrCustomizationChoiceRow] of chrCustChoiceDB.getAllRows()) {
				if (chrCustomizationChoiceRow.ChrCustomizationOptionID != chrCustomizationOptionID)
					continue;

				// Generate name because Blizz hasn't gotten around to setting it for everything yet.
				let name = '';
				if (chrCustomizationChoiceRow.Name_lang != '')
					name = chrCustomizationChoiceRow.Name_lang;
				else
					name = 'Choice ' + chrCustomizationChoiceRow.OrderIndex;

				choiceList.push({ id: chrCustomizationChoiceID, label: name });
			}

			optionToChoices.set(chrCustomizationOptionID, choiceList);
		}
	}

	await progress.step('Loading character races..');
	const chrRacesDB = new WDCReader('DBFilesClient/ChrRaces.db2');
	await chrRacesDB.parse();

	for (const [chrRaceID, chrRaceRow] of chrRacesDB.getAllRows()) {
		const flags = chrRaceRow.Flags;
		chrRaceMap.set(chrRaceID, { id: chrRaceID, name: chrRaceRow.Name_lang, isNPCRace: (flags & 1) == 1 });
	}

	await progress.step('Loading character race models..');
	const chrRaceXChrModelDB = new WDCReader('DBFilesClient/ChrRaceXChrModel.db2');
	await chrRaceXChrModelDB.parse();

	for (const [chrRaceXChrModelID, chrRaceXChrModelRow] of chrRaceXChrModelDB.getAllRows()) {
		if (!chrRaceXChrModelMap.has(chrRaceXChrModelRow.ChrRacesID))
			chrRaceXChrModelMap.set(chrRaceXChrModelRow.ChrRacesID, new Map());

		chrRaceXChrModelMap.get(chrRaceXChrModelRow.ChrRacesID).set(chrRaceXChrModelRow.Sex, chrRaceXChrModelRow.ChrModelID);
	}

	await progress.step('Loading character model materials..');
	const chrModelMatDB = new WDCReader('DBFilesClient/ChrModelMaterial.db2');
	await chrModelMatDB.parse();

	for (const [chrModelMaterialID, chrModelMaterialRow] of chrModelMatDB.getAllRows())
		chrModelMaterialMap.set(chrModelMaterialRow.CharComponentTextureLayoutsID + "-" + chrModelMaterialRow.TextureType, chrModelMaterialRow);

	// await progress.step('Loading character customization table...');
	// const chrCustDB = new WDCReader('DBFilesClient/ChrCustomization.db2');
	// await chrCustDB.parse();

	// load charComponentTextureSection
	await progress.step('Loading character component texture sections...');
	const charComponentTextureSectionDB = new WDCReader('DBFilesClient/CharComponentTextureSections.db2');
	await charComponentTextureSectionDB.parse();
	for (const [charComponentTextureSectionID, charComponentTextureSectionRow] of charComponentTextureSectionDB.getAllRows()) {
		if (!charComponentTextureSectionMap.has(charComponentTextureSectionRow.CharComponentTextureLayoutID))
			charComponentTextureSectionMap.set(charComponentTextureSectionRow.CharComponentTextureLayoutID, []);

		charComponentTextureSectionMap.get(charComponentTextureSectionRow.CharComponentTextureLayoutID).push(charComponentTextureSectionRow);
	}

	await progress.step('Loading character model texture layers...');
	const chrModelTextureLayerDB = new WDCReader('DBFilesClient/ChrModelTextureLayer.db2');
	await chrModelTextureLayerDB.parse();
	for (const [chrModelTextureLayerID, chrModelTextureLayerRow] of chrModelTextureLayerDB.getAllRows())
		chrModelTextureLayerMap.set(chrModelTextureLayerRow.CharComponentTextureLayoutsID + "-" + chrModelTextureLayerRow.ChrModelTextureTargetID[0], chrModelTextureLayerRow);

	await progress.step('Loading texture mapping...');
	const tfdDB = new WDCReader('DBFilesClient/TextureFileData.db2');
	await tfdDB.parse();
	const tfdMap = new Map();
	for (const [tfdID, tfdRow] of tfdDB.getAllRows()) {
		// Skip specular (1) and emissive (2)
		if (tfdRow.UsageType != 0)
			continue;
		tfdMap.set(tfdRow.MaterialResourcesID, tfdRow.FileDataID);
	}

	await progress.step('Loading character customization materials...');
	const chrCustMatDB = new WDCReader('DBFilesClient/ChrCustomizationMaterial.db2');
	await chrCustMatDB.parse();

	await progress.step('Loading character customization elements...');
	chrCustElementDB = new WDCReader('DBFilesClient/ChrCustomizationElement.db2');
	await chrCustElementDB.parse();

	for (const [chrCustomizationElementID, chrCustomizationElementRow] of chrCustElementDB.getAllRows()) {
		if (chrCustomizationElementRow.ChrCustomizationGeosetID != 0)
			choiceToGeoset.set(chrCustomizationElementRow.ChrCustomizationChoiceID, chrCustomizationElementRow.ChrCustomizationGeosetID);

		if (chrCustomizationElementRow.ChrCustomizationMaterialID != 0) {
			if (choiceToChrCustMaterialID.has(chrCustomizationElementRow.ChrCustomizationChoiceID))
				choiceToChrCustMaterialID.get(chrCustomizationElementRow.ChrCustomizationChoiceID).push({ ChrCustomizationMaterialID: chrCustomizationElementRow.ChrCustomizationMaterialID, RelatedChrCustomizationChoiceID: chrCustomizationElementRow.RelatedChrCustomizationChoiceID });
			else
				choiceToChrCustMaterialID.set(chrCustomizationElementRow.ChrCustomizationChoiceID, [{ ChrCustomizationMaterialID: chrCustomizationElementRow.ChrCustomizationMaterialID, RelatedChrCustomizationChoiceID: chrCustomizationElementRow.RelatedChrCustomizationChoiceID }]);

			const matRow = chrCustMatDB.getRow(chrCustomizationElementRow.ChrCustomizationMaterialID);
			chrCustMatMap.set(matRow.ID, {ChrModelTextureTargetID: matRow.ChrModelTextureTargetID, FileDataID: tfdMap.get(matRow.MaterialResourcesID)});
		}
	}

	await progress.step('Loading character customization geosets...');
	chrCustGeosetDB = new WDCReader('DBFilesClient/ChrCustomizationGeoset.db2');
	await chrCustGeosetDB.parse();

	for (const [chrCustomizationGeosetID, chrCustomizationGeosetRow] of chrCustGeosetDB.getAllRows()) {
		const geoset = chrCustomizationGeosetRow.GeosetType.toString().padStart(2, '0') + chrCustomizationGeosetRow.GeosetID.toString().padStart(2, '0');
		geosetMap.set(chrCustomizationGeosetID, Number(geoset));
	}

	// Initialize model viewer.
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

	updateChrModelList();

	core.view.chrModelViewerContext = Object.seal({ camera, scene, controls: null });

	// Show the characters screen.
	state.loadPct = -1;
	core.view.isBusy--;
	core.view.setScreen('tab-characters');
});

core.registerLoadFunc(async () => {
	const state = core.view;

	// If NPC race toggle changes, refresh model list.
	core.view.$watch('config.chrCustShowNPCRaces', () => {
		updateChrModelList();
	});

	core.view.$watch('chrCustImportString', () => {
		loadImportString(state.chrCustImportString);
	});

	core.events.on('click-export-character', async () => {
		await exportCharModel();
	});

	// When the selected model skin is changed, update our model.
	core.view.$watch('chrCustModelSelection', async (selection) => {
		const selected = selection[0];
		console.log('Selection changed to ID ' + selected.id + ', label ' + selected.label);

		const availableOptions = optionsByChrModel.get(selected.id);
		if (availableOptions === undefined) {
			console.log('No options available for this model.');
			return;
		}

		// Empty the arrays.
		state.chrCustOptions.splice(0, state.chrCustOptions.length);
		state.chrCustOptionSelection.splice(0, state.chrCustOptionSelection.length);

		// Reset active choices
		state.chrCustActiveChoices.splice(0, state.chrCustActiveChoices.length);

		// Add the new options.
		state.chrCustOptions.push(...availableOptions);
		state.chrCustOptionSelection.push(...availableOptions.slice(0, 1));

		console.log("Set currentCharComponentTextureLayoutID to " + currentCharComponentTextureLayoutID);
		currentCharComponentTextureLayoutID = chrModelIDToTextureLayoutID.get(selected.id);

		const fileDataID = chrModelIDToFileDataID.get(selected.id);

		// Check if the first file in the selection is "new".
		if (!core.view.isBusy && fileDataID && activeModel !== fileDataID)
			previewModel(fileDataID);

		// Reset/init texture preview (DEV, should be off-screen canvas probs similar to ADT texture baking).
		for (const chrMaterial of chrMaterials.values())
			chrMaterial.dispose();

		chrMaterials.clear();

	}, { deep: true });

	core.view.$watch('chrCustOptionSelection', async (selection) => {
		const selected = selection[0];
		console.log('Option selection changed to ID ' + selected.id + ', label ' + selected.label);

		const availableChoices = optionToChoices.get(selected.id);
		if (availableChoices === undefined) {
			console.log('No choices available for this option.');
			return;
		}

		// Empty the arrays.
		state.chrCustChoices.splice(0, state.chrCustChoices.length);
		state.chrCustChoiceSelection.splice(0, state.chrCustChoiceSelection.length);

		// Add the new options.
		state.chrCustChoices.push(...availableChoices);

		const selectedChoice = state.chrCustActiveChoices.find((choice) => choice.optionID === selected.id);

		if (selectedChoice !== undefined)
			state.chrCustChoiceSelection.push(...availableChoices.filter((x => x.id === selectedChoice.choiceID)));
		else
			state.chrCustChoiceSelection.push(...availableChoices.slice(0, 1));

	}, { deep: true });

	core.view.$watch('chrCustChoiceSelection', async (selection) => {
		const selected = selection[0];
		console.log('Choice selection for option ID ' + state.chrCustOptionSelection[0].id + ', label ' + state.chrCustOptionSelection[0].label + ' changed to choice ID ' + selected.id + ', label ' + selected.label);
		if (state.chrCustActiveChoices.find((choice) => choice.optionID === state.chrCustOptionSelection[0].id) === undefined) {
			state.chrCustActiveChoices.push({ optionID: state.chrCustOptionSelection[0].id, choiceID: selected.id });
		} else {
			const index = state.chrCustActiveChoices.findIndex((choice) => choice.optionID === state.chrCustOptionSelection[0].id);
			state.chrCustActiveChoices[index].choiceID = selected.id;
		}
	}, { deep: true });

	core.view.$watch('chrCustActiveChoices', async (selection) => {
		if (core.view.isBusy)
			return;
		console.log('Active choices changed');

		for (const activeChoice of selection) {
			// Update all geosets for this option.
			const availableChoices = optionToChoices.get(activeChoice.optionID);

			for (const availableChoice of availableChoices) {
				const chrCustGeoID = choiceToGeoset.get(availableChoice.id);
				const geoset = geosetMap.get(chrCustGeoID);

				if (geoset !== undefined) {
					for (const availableGeoset of state.modelViewerGeosets) {
						// HACK: Never touch geoset 0 (base skin)
						if (availableGeoset.id == 0)
							continue;

						if (availableGeoset.id === geoset) {
							let shouldBeChecked = availableChoice.id == activeChoice.choiceID;
							if (availableGeoset.checked != shouldBeChecked) {
								// console.log('Updating geoset ' + availableGeoset.id + ' to ' + shouldBeChecked + ' because of choice ' + activeChoice.choiceID);
								availableGeoset.checked = shouldBeChecked;
							}
						}
					}
				}
			}

			// Update material (if applicable)
			const chrCustMatIDs = choiceToChrCustMaterialID.get(activeChoice.choiceID);
			// console.log(activeChoice.optionID, activeChoice.choiceID, chrCustMatIDs);

			if (chrCustMatIDs != undefined) {
				for (const chrCustMatID of chrCustMatIDs) {
					if (chrCustMatID.RelatedChrCustomizationChoiceID != 0) {
						const hasRelatedChoice = selection.find((selectedChoice) => selectedChoice.choiceID === chrCustMatID.RelatedChrCustomizationChoiceID);
						if (!hasRelatedChoice)
							continue;
					}

					const chrCustMat = chrCustMatMap.get(chrCustMatID.ChrCustomizationMaterialID);
					const chrModelTextureTarget = chrCustMat.ChrModelTextureTargetID;

					// Find row in ChrModelTextureLayer that matches ChrModelTextureTargetID and current CharComponentTextureLayoutID
					const chrModelTextureLayer = chrModelTextureLayerMap.get(currentCharComponentTextureLayoutID + "-" + chrModelTextureTarget);
					if (chrModelTextureLayer === undefined) {
						console.log("Unable to find ChrModelTextureLayer for ChrModelTextureTargetID " + chrModelTextureTarget + " and CharComponentTextureLayoutID " + currentCharComponentTextureLayoutID)
						// TODO: Investigate but continue for now, this breaks e.g. dwarven beards
						continue;
					}
					
					// Find row in CharComponentTextureSection based on chrModelTextureLayer.TextureSectionTypeBitMask and current CharComponentTextureLayoutID
					const charComponentTextureSectionResults = charComponentTextureSectionMap.get(currentCharComponentTextureLayoutID);
					let charComponentTextureSection;
					for (const charComponentTextureSectionRow of charComponentTextureSectionResults) {
						// Check TextureSectionTypeBitMask to see if it contains SectionType (1-14) 
						// -1 for non-sectiontype 
						if ((1 << charComponentTextureSectionRow.SectionType) & chrModelTextureLayer.TextureSectionTypeBitMask) {
							charComponentTextureSection = charComponentTextureSectionRow;
							break;
						}
					}

					if (charComponentTextureSection === undefined)
						console.log("Unable to find CharComponentTextureSection for TextureSectionTypeBitMask " + chrModelTextureLayer.TextureSectionTypeBitMask + " and CharComponentTextureLayoutID " + currentCharComponentTextureLayoutID)
					
					// Find row in ChrModelMaterial based on chrModelTextureLayer.TextureType and current CharComponentTextureLayoutID
					const chrModelMaterial = chrModelMaterialMap.get(currentCharComponentTextureLayoutID + "-" + chrModelTextureLayer.TextureType);
					if (chrModelMaterial === undefined)
						console.log("Unable to find ChrModelMaterial for TextureType " + chrModelTextureLayer.TextureType + " and CharComponentTextureLayoutID " + currentCharComponentTextureLayoutID)

					let chrMaterial;
					
					if (!chrMaterials.has(chrModelMaterial.TextureType)) {
						chrMaterial = new CharMaterialRenderer(chrModelMaterial.TextureType, chrModelMaterial.Width, chrModelMaterial.Height);
						chrMaterials.set(chrModelMaterial.TextureType, chrMaterial);
					} else {
						chrMaterial = chrMaterials.get(chrModelMaterial.TextureType);
					}

					chrMaterial.SetTextureTarget(chrCustMat, charComponentTextureSection, chrModelMaterial, chrModelTextureLayer);
				}
			}

			// Update skinned model (DH wings, Dracthyr armor, Mechagnome armor, etc) (if applicable)
		}

		for (const [chrModelTextureTarget, chrMaterial] of chrMaterials)
			activeRenderer.overrideTextureTypeWithURI(chrModelTextureTarget,  chrMaterial.GetURI());

	}, { deep: true });
});

async function updateChrModelList() {
	const characterModelList = [];

	// Keep a list of listed models, some races are duplicated because of multi-factions.
	const listedModels = [];

	// Build character model list.
	for (const [chrRaceID, chrRaceInfo] of chrRaceMap) {
		if (!chrRaceXChrModelMap.has(chrRaceID))
			continue;

		const chrModels = chrRaceXChrModelMap.get(chrRaceID);
		for (const [chrSex, chrModelID] of chrModels) {
			if (!core.view.config.chrCustShowNPCRaces && chrRaceInfo.isNPCRace || listedModels.includes(chrModelID))
				continue;

			listedModels.push(chrModelID);
			characterModelList.push({id: chrModelID, label: chrRaceInfo.name + ' body type ' + chrSex});
		}
	}

	// Empty the arrays.
	core.view.chrCustModels.splice(0, core.view.chrCustModels.length);
	core.view.chrCustModelSelection.splice(0, core.view.chrCustModelSelection.length);

	// Add the new skins.
	core.view.chrCustModels.push(...characterModelList);
	core.view.chrCustModelSelection.push(...characterModelList.slice(0, 1));
}

async function previewModel(fileDataID) {
	core.view.isBusy++;
	core.setToast('progress', 'Loading model, please wait...', null, -1, false);
	log.write('Previewing model %s', fileDataID);

	// Empty the arrays.
	core.view.modelViewerSkins.splice(0, core.view.modelViewerSkins.length);
	core.view.modelViewerSkinsSelection.splice(0, core.view.modelViewerSkinsSelection.length);

	try {
		// Dispose the currently active renderer.
		if (activeRenderer) {
			activeRenderer.dispose();
			activeRenderer = undefined;
			activeModel = undefined;
		}

		// Clear the active skin map.
		activeSkins.clear();

		const file = await core.view.casc.getFile(fileDataID);

		activeRenderer = new M2Renderer(file, renderGroup, true);

		await activeRenderer.load();

		updateCameraBounding();

		activeModel = fileDataID;

		// Renderer did not provide any 3D data.
		if (renderGroup.children.length === 0)
			core.setToast('info', util.format('The model %s doesn\'t have any 3D data associated with it.', fileDataID), null, 4000);
		else
			core.view.hideToast();
	} catch (e) {
		// Error reading/parsing model.
		core.setToast('error', 'Unable to preview model ' + fileDataID, { 'View log': () => log.openRuntimelog() }, -1);
		log.write('Failed to open CASC file: %s', e.message);
	}

	core.view.isBusy--;
}

/** Update the camera to match render group bounding. */
function updateCameraBounding() {
	// Get the bounding box for the model.
	const boundingBox = new THREE.Box3();
	boundingBox.setFromObject(renderGroup);

	// Calculate center point and size from bounding box.
	const center = boundingBox.getCenter(new THREE.Vector3());
	const size = boundingBox.getSize(new THREE.Vector3());

	const maxDim = Math.max(size.x, size.y, size.z);
	const fov = camera.fov * (Math.PI / 180);
	const cameraZ = (Math.abs(maxDim / 4 * Math.tan(fov * 2))) * 6;

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
}

async function loadImportString(importString) {
	core.view.isBusy++;
	core.setToast('progress', 'Importing, please wait..', null, -1, false);

	if (importString.length === 0) {
		// Reset active choices.
		core.view.chrCustActiveChoices.splice(0, core.view.chrCustActiveChoices.length);
		core.view.hideToast();
		core.view.isBusy--;
		return;
	}

	const parsed = JSON.parse(importString);

	const selectedChrModelID = core.view.chrCustModelSelection[0].id;

	// Get available option IDs
	const availableOptions = optionsByChrModel.get(selectedChrModelID);
	const availableOptionsIDs = [];
	for (const option of availableOptions)
		availableOptionsIDs.push(option.id);

	// Reset active choices.
	core.view.chrCustActiveChoices.splice(0, core.view.chrCustActiveChoices.length);

	const parsedChoices = [];
	for (const [key, customizationEntry] of Object.entries(parsed.customizations)) {
		if (!availableOptionsIDs.includes(customizationEntry.option.id))
			continue;

		parsedChoices.push({optionID: customizationEntry.option.id, choiceID: customizationEntry.choice.id});
	}
	core.view.chrCustActiveChoices.push(...parsedChoices);
	core.view.hideToast();
	core.view.isBusy--;
}

const exportCharModel = async () => {
	const exportPaths = new FileWriter(core.view.lastExportPath, 'utf8');

	const casc = core.view.casc;
	const helper = new ExportHelper(1, 'model');
	helper.start();

	// Abort if the export has been cancelled.
	if (helper.isCancelled())
		return;
	
	const fileDataID = activeModel;
	const fileName = listfile.getByID(fileDataID);

	const fileManifest = [];
	
	try {
		const data = await casc.getFile(fileDataID);
		const exportPath = ExportHelper.replaceExtension(ExportHelper.getExportPath(fileName), ".gltf");
		const exporter = new M2Exporter(data, [], fileDataID);

		for (const [chrModelTextureTarget, chrMaterial] of chrMaterials)
			exporter.addURITexture(chrModelTextureTarget, chrMaterial.GetURI());

		// Respect geoset masking for selected model.
		exporter.setGeosetMask(core.view.modelViewerGeosets);

		await exporter.exportAsGLTF(exportPath, helper, fileManifest);
		exportPaths.writeLine('M2_GLTF:' + exportPath);

		// Abort if the export has been cancelled.
		if (helper.isCancelled())
			return;

		helper.mark(fileName, true);
	} catch (e) {
		helper.mark(fileName, false, e.message, e.stack);
	}


	helper.finish();

	// Write export information.
	await exportPaths.close();
};