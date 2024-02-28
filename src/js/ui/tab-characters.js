/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
const core = require('../core');
const log = require('../log');
const util = require('util');
const CharMaterialRenderer = require('../3D/renderers/CharMaterialRenderer');
const M2Renderer = require('../3D/renderers/M2Renderer');
const M2Exporter = require('../3D/exporters/M2Exporter');
const WDCReader = require('../db/WDCReader');
const ExportHelper = require('../casc/export-helper');
const FileWriter = require('../file-writer');
const listfile = require('../casc/listfile');
const realmlist = require('../casc/realmlist');

let camera;
let scene;
let grid;

const activeSkins = new Map();
const renderGroup = new THREE.Group();

let activeRenderer;
let activeModel;

// TODO: Need to make these accessible while in the character tab. Not sure how scope works here.
const chrModelIDToFileDataID = new Map();
const chrModelIDToTextureLayoutID = new Map();
const optionsByChrModel = new Map();
const optionToChoices = new Map();
const defaultOptions = new Array();

const chrRaceMap = new Map();
const chrRaceXChrModelMap = new Map();

const choiceToGeoset = new Map();
const choiceToChrCustMaterialID = new Map();
const choiceToSkinnedModel = new Map();
const unsupportedChoices = new Array();

const geosetMap = new Map();
const chrCustMatMap = new Map();
const chrModelTextureLayerMap = new Map();
const charComponentTextureSectionMap = new Map();
const chrModelMaterialMap = new Map();
const chrCustSkinnedModelMap = new Map();

const skinnedModelRenderers = new Map();
const skinnedModelMeshes = new Set();

const chrMaterials = new Map();

//let textureShaderMap = new Map();
let currentCharComponentTextureLayoutID = 0;

// Can we just keep DB2s opened? 
let chrCustChoiceDB;
let chrCustOptDB;
let chrCustElementDB;
let chrCustGeosetDB;

async function resetMaterials() {
	for (const chrMaterial of chrMaterials.values()) {
		await chrMaterial.reset();
		await chrMaterial.update();
	}
}

function disposeSkinnedModels() {
	for (const [fileDataID, skinnedModelRenderer] of skinnedModelRenderers) {
		console.log('Disposing of unused skinned model ' + fileDataID);
		skinnedModelRenderer.dispose();
	}

	skinnedModelRenderers.clear();

	for (const mesh of skinnedModelMeshes)
		renderGroup.remove(mesh);

	skinnedModelMeshes.clear();
}

async function uploadRenderOverrideTextures() {
	for (const [chrModelTextureTarget, chrMaterial] of chrMaterials) {
		await chrMaterial.update();
		await activeRenderer.overrideTextureTypeWithCanvas(chrModelTextureTarget,  chrMaterial.getCanvas());
	}
}

async function updateActiveCustomization() {
	await resetMaterials();

	const newSkinnedModels = new Map();

	const selection = core.view.chrCustActiveChoices;
	for (const activeChoice of selection) {
		// Update all geosets for this option.
		const availableChoices = optionToChoices.get(activeChoice.optionID);

		for (const availableChoice of availableChoices) {
			const chrCustGeoID = choiceToGeoset.get(availableChoice.id);
			const geoset = geosetMap.get(chrCustGeoID);

			if (geoset !== undefined) {
				for (const availableGeoset of core.view.modelViewerGeosets) {
					// HACK: Never touch geoset 0 (base skin)
					if (availableGeoset.id == 0)
						continue;

					if (availableGeoset.id === geoset) {
						let shouldBeChecked = availableChoice.id == activeChoice.choiceID;
						if (availableGeoset.checked != shouldBeChecked)
							availableGeoset.checked = shouldBeChecked;
					}
				}
			}
		}

		// Update material (if applicable)
		const chrCustMatIDs = choiceToChrCustMaterialID.get(activeChoice.choiceID);

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

				// Find row in ChrModelMaterial based on chrModelTextureLayer.TextureType and current CharComponentTextureLayoutID
				const chrModelMaterial = chrModelMaterialMap.get(currentCharComponentTextureLayoutID + "-" + chrModelTextureLayer.TextureType);
				if (chrModelMaterial === undefined)
					console.log("Unable to find ChrModelMaterial for TextureType " + chrModelTextureLayer.TextureType + " and CharComponentTextureLayoutID " + currentCharComponentTextureLayoutID)

				let chrMaterial;
				
				if (!chrMaterials.has(chrModelMaterial.TextureType)) {
					chrMaterial = new CharMaterialRenderer(chrModelMaterial.TextureType, chrModelMaterial.Width, chrModelMaterial.Height);
					chrMaterials.set(chrModelMaterial.TextureType, chrMaterial);

					await chrMaterial.init();
				} else {
					chrMaterial = chrMaterials.get(chrModelMaterial.TextureType);
				}

				// Find row in CharComponentTextureSection based on chrModelTextureLayer.TextureSectionTypeBitMask and current CharComponentTextureLayoutID
				let charComponentTextureSection;

				if (chrModelTextureLayer.TextureSectionTypeBitMask == -1) {
					charComponentTextureSection = { X: 0, Y: 0, Width: chrModelMaterial.Width, Height: chrModelMaterial.Height };
				} else {
					const charComponentTextureSectionResults = charComponentTextureSectionMap.get(currentCharComponentTextureLayoutID);
					for (const charComponentTextureSectionRow of charComponentTextureSectionResults) {
						// Check TextureSectionTypeBitMask to see if it contains SectionType (1-14) 
						if ((1 << charComponentTextureSectionRow.SectionType) & chrModelTextureLayer.TextureSectionTypeBitMask) {
							charComponentTextureSection = charComponentTextureSectionRow;
							break;
						}
					}
				}

				if (charComponentTextureSection === undefined)
					console.log("Unable to find CharComponentTextureSection for TextureSectionTypeBitMask " + chrModelTextureLayer.TextureSectionTypeBitMask + " and CharComponentTextureLayoutID " + currentCharComponentTextureLayoutID)

				let useAlpha = true;
				// if (textureShaderMap.has(chrModelTextureLayer.TextureType)) {
				// 	const shadersForTexture = textureShaderMap.get(chrModelTextureLayer.TextureType);
				// 	const pixelShader = shadersForTexture.PS;
				// 	console.log("Texture type " + chrModelTextureLayer.TextureType + " " + listfile.getByID(chrCustMat.FileDataID) +" has pixel shader " + pixelShader);

				// 	// Yeah no this doesn't work and is NOT how all this is supposed to work
				// 	if (pixelShader.startsWith('Combiners_Opaque') && chrModelTextureLayer.TextureSectionTypeBitMask == -1)
				// 		useAlpha = false;
				// }

				await chrMaterial.setTextureTarget(chrCustMat, charComponentTextureSection, chrModelMaterial, chrModelTextureLayer, useAlpha);
			}
		}

		// Update skinned model (DH wings, Dracthyr armor, Mechagnome armor, etc) (if applicable)
		// const chrCustSkinnedModelID = choiceToSkinnedModel.get(activeChoice.choiceID);
		// if (chrCustSkinnedModelID != undefined) {
		// 	const skinnedModelRow = chrCustSkinnedModelMap.get(chrCustSkinnedModelID);
		// 	if (skinnedModelRow !== undefined)
		// 		newSkinnedModels.set(skinnedModelRow.CollectionsFileDataID, skinnedModelRow);
		// }
	}

	disposeSkinnedModels();

	for (const [fileDataID, skinnedModelRow] of newSkinnedModels) {
		console.log('Loading skinned model ' + fileDataID);

		// Load model
		const skinnedModelRenderer = new M2Renderer(await core.view.casc.getFile(fileDataID), renderGroup, false);
		await skinnedModelRenderer.load();

		// Set geosets
		const geosetToEnable = skinnedModelRow.GeosetType * 100 + skinnedModelRow.GeosetID;

		for (let i = 0; i < skinnedModelRenderer.geosetArray.length; i++) {
			const geoset = skinnedModelRenderer.geosetArray[i];
			const geosetID = geoset.id;
		
			if (geosetID === geosetToEnable) {
				geoset.enabled = true;
				console.log('Enabling geoset ' + geosetID);
			} else {
				geoset.enabled = false;
			}
		}

		// Manually call this because we don't load these as reactive.
		skinnedModelRenderer.updateGeosets();
		skinnedModelRenderers.set(fileDataID, skinnedModelRenderer);

		const mesh = skinnedModelRenderers.get(fileDataID).meshGroup.clone(true);
		renderGroup.add(mesh);

		skinnedModelMeshes.add(mesh);
	}

	await uploadRenderOverrideTextures();
}

async function updateChrRaceList() {
	// Keep a list of listed models.
	// Some races are duplicated because of multi-factions,
	// so we will store races based on unique model IDs.
	const listedModelIDs = [];
	const listedRaceIDs = [];
	
	// Empty the arrays.
	core.view.chrCustRaces = [];

	// Build character model list.
	for (const [chrRaceID, chrRaceInfo] of chrRaceMap) {
		if (!chrRaceXChrModelMap.has(chrRaceID))
			continue;

		const chrModels = chrRaceXChrModelMap.get(chrRaceID);
		for (const chrModelID of chrModels.values()) {
			// If we're filtering NPC races, bail out.
			if (!core.view.config.chrCustShowNPCRaces && chrRaceInfo.isNPCRace)
				continue;

			// If we've seen this character model before, we don't need to record it again.
			if (listedModelIDs.includes(chrModelID))
				continue;

			listedModelIDs.push(chrModelID);

			// Need to do a check here to ensure we didn't already add this race
			// in the case of them having more than one model type
			if (listedRaceIDs.includes(chrRaceID))
				continue;

			listedRaceIDs.push(chrRaceID);

			// By the time we get here, we know we have a genuinly new race to add to the list!
			// Let's polish it up.

			// Build the label for the race data
			let raceLabel = chrRaceInfo.name;

			// To easily distinguish some weird names, we'll label NPC races.
			// ie: thin humans are just called "human" and aren't given a unique body type.
			// In the future, we could show the ClientFileString column if the label is already taken.
			if (chrRaceInfo.isNPCRace)
				raceLabel = raceLabel + ' [NPC]';

			// It's ready to go:
			const newRace = {id: chrRaceInfo.id, label: raceLabel }
			core.view.chrCustRaces.push(newRace);

			// Do a quick check on our selection, if it exists.
			// Since we just instantiated a new object, we need to ensure the selection is updated.
			if (core.view.chrCustRaceSelection.length > 0 && newRace.id == core.view.chrCustRaceSelection[0].id)
				core.view.chrCustRaceSelection = [newRace];
		}
	}

	// Sort alphabetically
	core.view.chrCustRaces.sort((a, b) => {
		return a.label.localeCompare(b.label);
	});

	// If we haven't selected a race, OR we selected a race that's not in the current filter,
	// we'll just select the first one in the list:
	if (core.view.chrCustRaceSelection.length == 0 || !listedRaceIDs.includes(core.view.chrCustRaceSelection[0].id))
		core.view.chrCustRaceSelection = [core.view.chrCustRaces[0]];
}

async function updateChrModelList() {
	const modelsForRace = chrRaceXChrModelMap.get(core.view.chrCustRaceSelection[0].id);

	// We'll do a quick check for the index of the last selected model.
	// If it's valid, we'll try to select the same index for loading the next race models.
	let selectionIndex = 0; //default is the first model

	// This is better than trying to search based on sex... for now. In the future if we
	// can update the model list without having to instantiate new objects, it will be more efficient
	// to try something else.
	if (core.view.chrCustModelSelection.length > 0) {
		const modelIDMap = core.view.chrCustModels.map((model) => { return model.id });
		selectionIndex = modelIDMap.indexOf(core.view.chrCustModelSelection[0].id);
	}

	// Done with the old list, so clear it
	core.view.chrCustModels = [];

	// Track model IDs to validate our previously selected model type
	const listedModelIDs = [];
	
	for (const [chrSex, chrModelID] of modelsForRace) {
		// Track the sex so we can reference it later, should the model/race have changed.
		const newModel = { id: chrModelID, label: 'Type ' + (chrSex + 1) };
		core.view.chrCustModels.push(newModel);
		listedModelIDs.push(chrModelID);
	}

	// If we haven't selected a model, we'll try to select the body type at the same index.
	// If the old selection is no longer valid, or the index is out of range, just set it to the first one.
	if (core.view.chrCustModels.length < selectionIndex || selectionIndex < 0)
		selectionIndex = 0;

	// We've found the model index we want to load, so let's select it:
	core.view.chrCustModelSelection = [core.view.chrCustModels[selectionIndex]];
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
		
		// Reset skinned models
		for (const fileDataID of skinnedModelRenderers.keys()) {
			skinnedModelRenderers.get(fileDataID).dispose();
			skinnedModelRenderers.delete(fileDataID);
		}

		const file = await core.view.casc.getFile(fileDataID);

		activeRenderer = new M2Renderer(file, renderGroup, true);

		await activeRenderer.load();
		//textureShaderMap = activeRenderer.shaderMap;
		updateCameraBounding();

		activeModel = fileDataID;

		// Renderer did not provide any 3D data.
		if (renderGroup.children.length === 0)
			core.setToast('info', util.format('The model %s doesn\'t have any 3D data associated with it.', fileDataID), null, 4000);
		else
			core.view.hideToast();

		await updateActiveCustomization();
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

	const heightOffset = maxDim * 0.7;
	camera.position.set(center.x, heightOffset, cameraZ);

	const minZ = boundingBox.min.z;
	const cameraToFarEdge = (minZ < 0) ? -minZ + cameraZ : cameraZ - minZ;

	camera.updateProjectionMatrix();

	const controls = core.view.modelViewerContext.controls;
	if (controls) {
		controls.target = center;
		controls.maxDistance = cameraToFarEdge * 2;
	}
}

async function importCharacter() {
	// TODO
	// Remove pre-populated debug regions/realms from core.view.chrImportRegions and core.view.chrImportRealms
	// realmlist.parseRealmList() needs to populate chrImportRegions and chrImportRealms with labelled objects.
	// Add character API URL as a config option (https://marlam.in/we/api.php?region=%s&realm=%s&character=%s) by default
	// Validate in config.js#125 that the URL is valid
	// Add v-model input to settings window for customization.
	// Fetch JSON result from API here with region, realm and char name (chrImportChrName)
	// Pass JSON to loadImportString().
	// Fix sizing or replace dropdown menus for region/realm
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

	let parsed;
	try {
		parsed = JSON.parse(importString);
	} catch (e) {
		core.setToast('error', 'Invalid import string.', null, 3000);
		core.view.isBusy--;
		return;
	}

	//const selectedChrModelID = core.view.chrCustModelSelection[0].id;
	const playerRaceID = parsed.playable_race.id;
	core.view.chrCustRaceSelection = [core.view.chrCustRaces.find(e => e.id === playerRaceID)];

	// Get available option IDs
	const availableOptions = optionsByChrModel.get(playerRaceID);
	const availableOptionsIDs = [];
	for (const option of availableOptions)
		availableOptionsIDs.push(option.id);

	// Reset active choices.
	core.view.chrCustActiveChoices.splice(0, core.view.chrCustActiveChoices.length);

	const parsedChoices = [];
	for (const customizationEntry of Object.values(parsed.customizations)) {
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
			exporter.addURITexture(chrModelTextureTarget, chrMaterial.getURI());

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

async function updateModelSelection() {
	const state = core.view;
	const selected = state.chrCustModelSelection[0];
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

	clearMaterials();
	
	// For each available option we select the first choice ONLY if the option is a 'default' option.
	// TODO: What do we do if the user doesn't want to select any choice anymore? Are "none" choices guaranteed for these options?
	for (const option of availableOptions) {
		const choices = optionToChoices.get(option.id);
		if (defaultOptions.includes(option.id))
			state.chrCustActiveChoices.push({ optionID: option.id, choiceID: choices[0].id });
	}

	
}

function clearMaterials() {
	for (const chrMaterial of chrMaterials.values())
		chrMaterial.dispose();

	chrMaterials.clear();
}

async function updateCustomizationType() {
	const state = core.view;
	const selection = state.chrCustOptionSelection;

	if (selection.length === 0)
		return;

	const selected = selection[0];

	const availableChoices = optionToChoices.get(selected.id);
	if (availableChoices === undefined)
		return;

	// Empty the arrays.
	state.chrCustChoices.splice(0, state.chrCustChoices.length);
	state.chrCustChoiceSelection.splice(0, state.chrCustChoiceSelection.length);

	// Add the new options.
	state.chrCustChoices.push(...availableChoices);
}

async function updateCustomizationChoice() {
	const state = core.view;
	const selection = state.chrCustChoiceSelection;
	if (selection.length === 0)
		return;

	const selected = selection[0];
	console.log('Choice selection for option ID ' + state.chrCustOptionSelection[0].id + ', label ' + state.chrCustOptionSelection[0].label + ' changed to choice ID ' + selected.id + ', label ' + selected.label);
	if (state.chrCustActiveChoices.find((choice) => choice.optionID === state.chrCustOptionSelection[0].id) === undefined) {
		state.chrCustActiveChoices.push({ optionID: state.chrCustOptionSelection[0].id, choiceID: selected.id });
	} else {
		const index = state.chrCustActiveChoices.findIndex((choice) => choice.optionID === state.chrCustOptionSelection[0].id);
		state.chrCustActiveChoices[index].choiceID = selected.id;
	}
}

core.events.once('screen-tab-characters', async () => {
	const state = core.view;

	// Initialize a loading screen.
	const progress = core.createProgress(17);
	core.view.setScreen('loading');
	core.view.isBusy++;

	await progress.step('Retrieving realmlist...');
	await realmlist.load();

	core.view.chrImportRegions = Object.keys(core.view.realmList);
	core.view.chrImportSelectedRegion = core.view.chrImportRegions[0];

	await progress.step('Loading texture mapping...');
	const tfdDB = new WDCReader('DBFilesClient/TextureFileData.db2');
	await tfdDB.parse();
	const tfdMap = new Map();
	for (const tfdRow of tfdDB.getAllRows().values()) {
		// Skip specular (1) and emissive (2)
		if (tfdRow.UsageType != 0)
			continue;
		tfdMap.set(tfdRow.MaterialResourcesID, tfdRow.FileDataID);
	}

	await progress.step('Loading character models..');
	const chrModelDB = new WDCReader('DBFilesClient/ChrModel.db2');
	await chrModelDB.parse();

	await progress.step('Loading character customization choices...');
	chrCustChoiceDB = new WDCReader('DBFilesClient/ChrCustomizationChoice.db2');
	await chrCustChoiceDB.parse();

	// TODO: We already have these loaded through DBCreatures cache. Get from there instead.
	await progress.step('Loading creature display info...');
	const creatureDisplayInfoDB = new WDCReader('DBFilesClient/CreatureDisplayInfo.db2');
	await creatureDisplayInfoDB.parse();

	await progress.step('Loading creature model data...');
	const creatureModelDataDB = new WDCReader('DBFilesClient/CreatureModelData.db2');
	await creatureModelDataDB.parse();

	// TODO: There is so many DB2 loading below relying on fields existing, we should probably check for them first and handle missing ones gracefully.
	await progress.step('Loading character customization materials...');
	const chrCustMatDB = new WDCReader('DBFilesClient/ChrCustomizationMaterial.db2');
	await chrCustMatDB.parse();

	await progress.step('Loading character customization elements...');
	chrCustElementDB = new WDCReader('DBFilesClient/ChrCustomizationElement.db2');
	await chrCustElementDB.parse();

	for (const chrCustomizationElementRow of chrCustElementDB.getAllRows().values()) {
		if (chrCustomizationElementRow.ChrCustomizationGeosetID != 0)
			choiceToGeoset.set(chrCustomizationElementRow.ChrCustomizationChoiceID, chrCustomizationElementRow.ChrCustomizationGeosetID);

		if (chrCustomizationElementRow.ChrCustomizationSkinnedModelID != 0) {
			choiceToSkinnedModel.set(chrCustomizationElementRow.ChrCustomizationChoiceID, chrCustomizationElementRow.ChrCustomizationSkinnedModelID);
			unsupportedChoices.push(chrCustomizationElementRow.ChrCustomizationChoiceID);
		}

		if (chrCustomizationElementRow.ChrCustomizationBoneSetID != 0)
			unsupportedChoices.push(chrCustomizationElementRow.ChrCustomizationChoiceID);

		if (chrCustomizationElementRow.ChrCustomizationCondModelID != 0)
			unsupportedChoices.push(chrCustomizationElementRow.ChrCustomizationChoiceID);

		if (chrCustomizationElementRow.ChrCustomizationDisplayInfoID != 0)
			unsupportedChoices.push(chrCustomizationElementRow.ChrCustomizationChoiceID);

		if (chrCustomizationElementRow.ChrCustomizationMaterialID != 0) {
			if (choiceToChrCustMaterialID.has(chrCustomizationElementRow.ChrCustomizationChoiceID))
				choiceToChrCustMaterialID.get(chrCustomizationElementRow.ChrCustomizationChoiceID).push({ ChrCustomizationMaterialID: chrCustomizationElementRow.ChrCustomizationMaterialID, RelatedChrCustomizationChoiceID: chrCustomizationElementRow.RelatedChrCustomizationChoiceID });
			else
				choiceToChrCustMaterialID.set(chrCustomizationElementRow.ChrCustomizationChoiceID, [{ ChrCustomizationMaterialID: chrCustomizationElementRow.ChrCustomizationMaterialID, RelatedChrCustomizationChoiceID: chrCustomizationElementRow.RelatedChrCustomizationChoiceID }]);

			const matRow = chrCustMatDB.getRow(chrCustomizationElementRow.ChrCustomizationMaterialID);
			chrCustMatMap.set(matRow.ID, {ChrModelTextureTargetID: matRow.ChrModelTextureTargetID, FileDataID: tfdMap.get(matRow.MaterialResourcesID)});
		}
	}

	await progress.step('Loading character customization options...');
	chrCustOptDB = new WDCReader('DBFilesClient/ChrCustomizationOption.db2');
	await chrCustOptDB.parse();

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

			let optionName = '';
			if (chrCustomizationOptionRow.Name_lang != '')
				optionName = chrCustomizationOptionRow.Name_lang;
			else
				optionName = 'Option ' + chrCustomizationOptionRow.OrderIndex;

			optionsByChrModel.get(chrCustomizationOptionRow.ChrModelID).push({ id: chrCustomizationOptionID, label: optionName });

			for (const [chrCustomizationChoiceID, chrCustomizationChoiceRow] of chrCustChoiceDB.getAllRows()) {
				if (chrCustomizationChoiceRow.ChrCustomizationOptionID != chrCustomizationOptionID)
					continue;

				// Generate name because Blizz hasn't gotten around to setting it for everything yet.
				let name = '';
				if (chrCustomizationChoiceRow.Name_lang != '')
					name = chrCustomizationChoiceRow.Name_lang;
				else
					name = 'Choice ' + chrCustomizationChoiceRow.OrderIndex;

				if (unsupportedChoices.includes(chrCustomizationChoiceID))
					name += '*';

				choiceList.push({ id: chrCustomizationChoiceID, label: name });
			}

			optionToChoices.set(chrCustomizationOptionID, choiceList);

			// If option flags does not have 0x20 ("EXCLUDE_FROM_INITIAL_RANDOMIZATION") we can assume it's a default option.
			if (!(chrCustomizationOptionRow.Flags & 0x20))
				defaultOptions.push(chrCustomizationOptionID);
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

	for (const chrRaceXChrModelRow of chrRaceXChrModelDB.getAllRows().values()) {
		if (!chrRaceXChrModelMap.has(chrRaceXChrModelRow.ChrRacesID))
			chrRaceXChrModelMap.set(chrRaceXChrModelRow.ChrRacesID, new Map());

		chrRaceXChrModelMap.get(chrRaceXChrModelRow.ChrRacesID).set(chrRaceXChrModelRow.Sex, chrRaceXChrModelRow.ChrModelID);
	}

	await progress.step('Loading character model materials..');
	const chrModelMatDB = new WDCReader('DBFilesClient/ChrModelMaterial.db2');
	await chrModelMatDB.parse();

	for (const chrModelMaterialRow of chrModelMatDB.getAllRows().values())
		chrModelMaterialMap.set(chrModelMaterialRow.CharComponentTextureLayoutsID + "-" + chrModelMaterialRow.TextureType, chrModelMaterialRow);

	// load charComponentTextureSection
	await progress.step('Loading character component texture sections...');
	const charComponentTextureSectionDB = new WDCReader('DBFilesClient/CharComponentTextureSections.db2');
	await charComponentTextureSectionDB.parse();
	for (const charComponentTextureSectionRow of charComponentTextureSectionDB.getAllRows().values()) {
		if (!charComponentTextureSectionMap.has(charComponentTextureSectionRow.CharComponentTextureLayoutID))
			charComponentTextureSectionMap.set(charComponentTextureSectionRow.CharComponentTextureLayoutID, []);

		charComponentTextureSectionMap.get(charComponentTextureSectionRow.CharComponentTextureLayoutID).push(charComponentTextureSectionRow);
	}

	await progress.step('Loading character model texture layers...');
	const chrModelTextureLayerDB = new WDCReader('DBFilesClient/ChrModelTextureLayer.db2');
	await chrModelTextureLayerDB.parse();
	for (const chrModelTextureLayerRow of chrModelTextureLayerDB.getAllRows().values())
		chrModelTextureLayerMap.set(chrModelTextureLayerRow.CharComponentTextureLayoutsID + "-" + chrModelTextureLayerRow.ChrModelTextureTargetID[0], chrModelTextureLayerRow);

	await progress.step('Loading character customization geosets...');
	chrCustGeosetDB = new WDCReader('DBFilesClient/ChrCustomizationGeoset.db2');
	await chrCustGeosetDB.parse();

	for (const [chrCustomizationGeosetID, chrCustomizationGeosetRow] of chrCustGeosetDB.getAllRows()) {
		const geoset = chrCustomizationGeosetRow.GeosetType.toString().padStart(2, '0') + chrCustomizationGeosetRow.GeosetID.toString().padStart(2, '0');
		geosetMap.set(chrCustomizationGeosetID, Number(geoset));
	}

	await progress.step('Loading character customization skinned models...');

	const chrCustSkinnedModelDB = new WDCReader('DBFilesClient/ChrCustomizationSkinnedModel.db2');
	await chrCustSkinnedModelDB.parse();
	for (const [chrCustomizationSkinnedModelID, chrCustomizationSkinnedModelRow] of chrCustSkinnedModelDB.getAllRows())
		chrCustSkinnedModelMap.set(chrCustomizationSkinnedModelID, chrCustomizationSkinnedModelRow);

	await progress.step('Loading character shaders...');
	await CharMaterialRenderer.init();

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

	updateChrRaceList();

	core.view.chrModelViewerContext = Object.seal({ camera, scene, controls: null });

	// Show the characters screen.
	state.loadPct = -1;
	core.view.isBusy--;
	core.view.setScreen('tab-characters');
});

core.registerLoadFunc(async () => {
	// If NPC race toggle changes, refresh model list.
	core.view.$watch('config.chrCustShowNPCRaces', () => updateChrRaceList());

	core.view.$watch('config.chrIncludeBaseClothing', () => uploadRenderOverrideTextures());

	core.events.on('click-export-character', () => exportCharModel());
	core.events.on('click-import-character', () => importCharacter());

	// User has changed the "Race" selection, ie "Human", "Orc", etc.
	core.view.$watch('chrCustRaceSelection', () => updateChrModelList());

	// User has changed the "Body Type" selection, ie "Type 1", "Type 2", etc.
	core.view.$watch('chrCustModelSelection', () => updateModelSelection(), { deep: true });

	// User has changed the "Customization" selection, ie "Hair Color", "Skin Color", etc.
	core.view.$watch('chrCustOptionSelection', () => updateCustomizationType(), { deep: true });

	// User has changed the "Customization Options" selection, ie "Choice 0", "Choice 1", etc.
	core.view.$watch('chrCustChoiceSelection', () => updateCustomizationChoice(), { deep: true });

	core.view.$watch('chrCustActiveChoices', async () => {
		if (core.view.isBusy)
			return;

		await updateActiveCustomization();
	}, { deep: true });

	// Expose loadImportString for debugging purposes.
	window.loadImportString = loadImportString;
});