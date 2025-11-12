/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>, Marlamin <marlamin@marlamin.com>
	License: MIT
 */
const core = require('../core');
const log = require('../log');
const util = require('util');
const generics = require('../generics');
const CharMaterialRenderer = require('../3D/renderers/CharMaterialRenderer');
const M2Renderer = require('../3D/renderers/M2Renderer');
const M2Exporter = require('../3D/exporters/M2Exporter');
const CameraBounding = require('../3D/camera/CameraBounding');
const WDCReader = require('../db/WDCReader');
const ExportHelper = require('../casc/export-helper');
const listfile = require('../casc/listfile');
const realmlist = require('../casc/realmlist');
const DBCreatures = require('../db/caches/DBCreatures');

let camera;
let scene;
let grid;

const activeSkins = new Map();
const renderGroup = new THREE.Group();

let activeRenderer;
let activeModel;
let isModelLoading = false;

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
	if (!activeRenderer)
		return;

	for (const [chrModelTextureTarget, chrMaterial] of chrMaterials) {
		await chrMaterial.update();
		const pixels = chrMaterial.getRawPixels();
		await activeRenderer.overrideTextureTypeWithPixels(
			chrModelTextureTarget,
			chrMaterial.glCanvas.width,
			chrMaterial.glCanvas.height,
			pixels
		);
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
				for (const availableGeoset of core.view.chrCustGeosets) {
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
		skinnedModelRenderer.geosetKey = 'chrCustGeosets';
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
	const listedModelIDs = [];
	const listedRaceIDs = [];

	core.view.chrCustRacesPlayable = [];
	core.view.chrCustRacesNPC = [];

	for (const [chrRaceID, chrRaceInfo] of chrRaceMap) {
		if (!chrRaceXChrModelMap.has(chrRaceID))
			continue;

		const chrModels = chrRaceXChrModelMap.get(chrRaceID);
		for (const chrModelID of chrModels.values()) {
			if (listedModelIDs.includes(chrModelID))
				continue;

			listedModelIDs.push(chrModelID);

			if (listedRaceIDs.includes(chrRaceID))
				continue;

			listedRaceIDs.push(chrRaceID);

			const newRace = { id: chrRaceInfo.id, label: chrRaceInfo.name };

			if (chrRaceInfo.isNPCRace)
				core.view.chrCustRacesNPC.push(newRace);
			else
				core.view.chrCustRacesPlayable.push(newRace);

			if (core.view.chrCustRaceSelection.length > 0 && newRace.id == core.view.chrCustRaceSelection[0].id)
				core.view.chrCustRaceSelection = [newRace];
		}
	}

	core.view.chrCustRacesPlayable.sort((a, b) => a.label.localeCompare(b.label));
	core.view.chrCustRacesNPC.sort((a, b) => a.label.localeCompare(b.label));

	core.view.chrCustRaces = [...core.view.chrCustRacesPlayable, ...core.view.chrCustRacesNPC];

	if (core.view.chrCustRaceSelection.length == 0 || !listedRaceIDs.includes(core.view.chrCustRaceSelection[0].id))
		core.view.chrCustRaceSelection = [core.view.chrCustRacesPlayable[0]];
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

	if (core.view.chrImportChrModelID != 0) {
		// If we have an imported character model, we'll try to select it.
		selectionIndex = listedModelIDs.indexOf(core.view.chrImportChrModelID);
		core.view.chrImportChrModelID = 0;
	} else {
		// If we haven't selected a model, we'll try to select the body type at the same index.
		// If the old selection is no longer valid, or the index is out of range, just set it to the first one.
		if (core.view.chrCustModels.length < selectionIndex || selectionIndex < 0)
			selectionIndex = 0;
	}


	// We've found the model index we want to load, so let's select it:
	core.view.chrCustModelSelection = [core.view.chrCustModels[selectionIndex]];
}

async function previewModel(fileDataID) {
	core.view.isBusy++;
	isModelLoading = true;
	core.view.chrModelLoading = true;
	log.write('Previewing model %s', fileDataID);

	// Empty the arrays.
	core.view.modelViewerSkins.splice(0, core.view.modelViewerSkins.length);
	core.view.modelViewerSkinsSelection.splice(0, core.view.modelViewerSkinsSelection.length);

	// reset animation selection
	core.view.chrModelViewerAnims = [];
	core.view.chrModelViewerAnimSelection = null;

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
		activeRenderer.geosetKey = 'chrCustGeosets';

		await activeRenderer.load();
		//textureShaderMap = activeRenderer.shaderMap;
		applyCameraDebugSettings();

		activeModel = fileDataID;

		// populate animation list
		const animList = [];
		const anim_source = activeRenderer.skelLoader || activeRenderer.m2;

		for (let i = 0; i < anim_source.animations.length; i++) {
			const animation = anim_source.animations[i];
			animList.push({
				id: `${Math.floor(animation.id)}.${animation.variationIndex}`,
				animationId: animation.id,
				m2Index: i,
				label: require('../3D/AnimMapper').get_anim_name(animation.id) + " (" + Math.floor(animation.id) + "." + animation.variationIndex + ")"
			});
		}

		const finalAnimList = [
			{ id: 'none', label: 'None', m2Index: -1 },
			...animList
		];

		core.view.chrModelViewerAnims = finalAnimList;
		core.view.chrModelViewerAnimSelection = 'none';

		// Renderer did not provide any 3D data.
		if (renderGroup.children.length === 0)
			core.setToast('info', util.format('The model %s doesn\'t have any 3D data associated with it.', fileDataID), null, 4000);

		await updateActiveCustomization();
	} catch (e) {
		// Error reading/parsing model.
		core.setToast('error', 'Unable to preview model ' + fileDataID, { 'View log': () => log.openRuntimelog() }, -1);
		log.write('Failed to open CASC file: %s', e.message);
	}

	isModelLoading = false;
	core.view.chrModelLoading = false;
	core.view.isBusy--;
}


function applyCameraDebugSettings() {
	CameraBounding.fitCharacterInView(renderGroup, camera, core.view.chrModelViewerContext.controls, {
		viewHeightPercentage: 0.6,
		verticalOffsetFactor: 0
	});
}

async function importCharacter() {
	core.view.isBusy++;
	core.setToast('progress', 'Importing, please wait..', null, -1, false);

	const character_name = core.view.chrImportChrName; // string
	const selected_realm = core.view.chrImportSelectedRealm; // { label, value }
	const selected_region = core.view.chrImportSelectedRegion; // eu

	if (selected_realm === null) {
		core.setToast('error', 'Please enter a valid realm.', null, 3000);
		core.view.isBusy--;
		return;
	}

	const character_label = util.format('%s (%s-%s)', character_name, selected_region, selected_realm.label);
	const url = util.format(core.view.config.armoryURL, selected_region, selected_realm.value, encodeURIComponent(character_name.toLowerCase()));
	log.write('Retrieving character data for %s from %s', character_label, url);

	const res = await generics.get(url);
	if (res.ok) {
		try {
			loadImportJSON(await res.json());
			core.view.hideToast();
		} catch (e) {
			log.write('Failed to parse character data: %s', e.message);
			core.setToast('error', 'Failed to import character ' + character_label, null, -1);
		}
	} else {
		log.write('Failed to retrieve character data: %d %s', res.status, res.statusText);

		if (res.status == 404)
			core.setToast('error', 'Could not find character ' + character_label, null, -1);
		else
			core.setToast('error', 'Failed to import character ' + character_label, null, -1);
	}

	core.view.isBusy--;
}

async function loadImportString(importString) {
	loadImportJSON(JSON.parse(importString));
}

async function loadImportJSON(json) {
	//const selectedChrModelID = core.view.chrCustModelSelection[0].id;
	let playerRaceID = json.playable_race.id;

	// If the player is a Pandaren with a faction, we need to use the neutral Pandaren race.
	if (playerRaceID == 25 || playerRaceID == 26)
		playerRaceID = 24;

	// If the player is a Dracthyr (Horde), use Dracthyr (Alliance)
	if (playerRaceID == 70)
		playerRaceID = 52;

	// If the player is a Worgen or Dracthyr and the user wants to load the Visage model, remap.
	if (playerRaceID == 22 && core.view.chrImportLoadVisage)
		playerRaceID = 23;

	if (playerRaceID == 52 && core.view.chrImportLoadVisage)
		playerRaceID = 75;

	core.view.chrCustRaceSelection = [core.view.chrCustRaces.find(e => e.id === playerRaceID)];

	const playerGender = json.gender.type;
	let genderIndex = 0;
	if (playerGender == "MALE") {
		genderIndex = 0;
	} else if (playerGender == "FEMALE") {
		genderIndex = 1;
	} else {
		log.write('Failed to import character, encountered unknown player gender: %s', playerGender);
		core.setToast('error', 'Failed to import character, encountered unknown player gender: ' + playerGender, null, -1);
	}

	core.view.chrCustModelSelection = [core.view.chrCustModels[genderIndex]];

	// Get correct ChrModel ID
	const chrModelID = chrRaceXChrModelMap.get(playerRaceID).get(genderIndex);
	core.view.chrImportChrModelID = chrModelID;

	// Get available option IDs
	const availableOptions = optionsByChrModel.get(chrModelID);
	const availableOptionsIDs = [];
	for (const option of availableOptions)
		availableOptionsIDs.push(option.id);

	// Reset last imported choices.
	core.view.chrImportChoices.splice(0, core.view.chrImportChoices.length);

	const parsedChoices = [];
	for (const customizationEntry of Object.values(json.customizations)) {
		if (!availableOptionsIDs.includes(customizationEntry.option.id))
			continue;

		parsedChoices.push({optionID: customizationEntry.option.id, choiceID: customizationEntry.choice.id});
	}

	core.view.chrImportChoices.push(...parsedChoices);
}

const exportCharModel = async () => {
	const exportPaths = core.openLastExportStream();

	const casc = core.view.casc;
	const helper = new ExportHelper(1, 'model');
	helper.start();

	// Abort if the export has been cancelled.
	if (helper.isCancelled())
		return;
	
	const fileDataID = activeModel;
	const fileName = listfile.getByID(fileDataID);
	
	try {
		const data = await casc.getFile(fileDataID);
		const exportPath = ExportHelper.replaceExtension(ExportHelper.getExportPath(fileName), ".gltf");
		const exporter = new M2Exporter(data, [], fileDataID);

		for (const [chrModelTextureTarget, chrMaterial] of chrMaterials)
			exporter.addURITexture(chrModelTextureTarget, chrMaterial.getURI());

		// Respect geoset masking for selected model.
		exporter.setGeosetMask(core.view.chrCustGeosets);

		const format = core.view.config.exportCharacterFormat.toLowerCase();
		await exporter.exportAsGLTF(exportPath, helper, format);
		await exportPaths?.writeLine('M2_' + core.view.config.exportCharacterFormat + ':' + exportPath);

		// Abort if the export has been cancelled.
		if (helper.isCancelled())
			return;

		helper.mark(fileName, true);
	} catch (e) {
		helper.mark(fileName, false, e.message, e.stack);
	}


	helper.finish();

	// Write export information.
	exportPaths?.close();
};

async function updateModelSelection() {
	const state = core.view;
	const selected = state.chrCustModelSelection[0];
	if (selected === undefined)
		return;

	console.log('Selection changed to ID ' + selected.id + ', label ' + selected.label);

	const availableOptions = optionsByChrModel.get(selected.id);
	if (availableOptions === undefined) {
		console.log('No options available for this model.');
		return;
	}

	// empty the arrays
	state.chrCustOptions.splice(0, state.chrCustOptions.length);
	state.chrCustOptionSelection.splice(0, state.chrCustOptionSelection.length);

	// reset active choices
	state.chrCustActiveChoices.splice(0, state.chrCustActiveChoices.length);

	if (state.chrImportChoices.length > 0)
		state.chrCustActiveChoices.push(...state.chrImportChoices);

	// add the new options
	state.chrCustOptions.push(...availableOptions);
	state.chrCustOptionSelection.push(...availableOptions.slice(0, 1));

	console.log("Set currentCharComponentTextureLayoutID to " + currentCharComponentTextureLayoutID);
	currentCharComponentTextureLayoutID = chrModelIDToTextureLayoutID.get(selected.id);

	const fileDataID = chrModelIDToFileDataID.get(selected.id);

	// check if the first file in the selection is new
	if (!core.view.isBusy && fileDataID && activeModel !== fileDataID)
		previewModel(fileDataID);

	clearMaterials();

	if (state.chrImportChoices.length == 0) {
		// for each available option we select the first choice only if the option is a 'default' option
		for (const option of availableOptions) {
			const choices = optionToChoices.get(option.id);
			if (defaultOptions.includes(option.id))
				state.chrCustActiveChoices.push({ optionID: option.id, choiceID: choices[0].id });
		}
	} else {
		state.chrImportChoices.splice(0, state.chrImportChoices.length);
	}

	// expose optionToChoices to view for template access
	state.optionToChoices = optionToChoices;
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

	core.view.chrCustUnsupportedWarning = false;

	for (const choice of availableChoices) {
		if (unsupportedChoices.includes(choice.id))
			core.view.chrCustUnsupportedWarning = true;
	}

	// empty the arrays
	state.chrCustChoices.splice(0, state.chrCustChoices.length);
	state.chrCustChoiceSelection.splice(0, state.chrCustChoiceSelection.length);

	// add the new options
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

function updateChoiceForOption(optionID, choiceID) {
	const state = core.view;
	const existingChoice = state.chrCustActiveChoices.find((choice) => choice.optionID === optionID);

	if (existingChoice) {
		existingChoice.choiceID = choiceID;
	} else {
		state.chrCustActiveChoices.push({ optionID: optionID, choiceID: choiceID });
	}
}

core.events.once('screen-tab-characters', async () => {
	const state = core.view;

	// Initialize a loading screen.
	const progress = core.createProgress(16);
	state.setScreen('loading');
	state.isBusy++;

	await progress.step('Retrieving realmlist...');
	await realmlist.load();

	core.view.$watch('chrImportSelectedRegion', () => {
		const realmList = state.realmList[state.chrImportSelectedRegion].map(realm => ({ label: realm.name, value: realm.slug }));
		state.chrImportRealms = realmList;

		if (state.chrImportSelectedRealm !== null && !realmList.find(realm => realm.value === state.chrImportSelectedRealm.value))
			state.chrImportSelectedRealm = null;
	});

	state.chrImportRegions = Object.keys(state.realmList);
	state.chrImportSelectedRegion = state.chrImportRegions[0];

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

	await progress.step('Loading creature data...');
	await DBCreatures.initializeCreatureData();

	await progress.step('Loading character customization choices...');
	chrCustChoiceDB = new WDCReader('DBFilesClient/ChrCustomizationChoice.db2');
	await chrCustChoiceDB.parse();

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

	// pre-index options by model id and choices by option id
	const options_by_model = new Map();
	const choices_by_option = new Map();
	const unsupported_choices_set = new Set(unsupportedChoices);

	for (const [chrCustomizationOptionID, chrCustomizationOptionRow] of chrCustOptDB.getAllRows()) {
		const model_id = chrCustomizationOptionRow.ChrModelID;
		if (!options_by_model.has(model_id))
			options_by_model.set(model_id, []);

		options_by_model.get(model_id).push([chrCustomizationOptionID, chrCustomizationOptionRow]);
	}

	for (const [chrCustomizationChoiceID, chrCustomizationChoiceRow] of chrCustChoiceDB.getAllRows()) {
		const option_id = chrCustomizationChoiceRow.ChrCustomizationOptionID;
		if (!choices_by_option.has(option_id))
			choices_by_option.set(option_id, []);
		
		choices_by_option.get(option_id).push([chrCustomizationChoiceID, chrCustomizationChoiceRow]);
	}

	for (const [chrModelID, chrModelRow] of chrModelDB.getAllRows()) {
		const fileDataID = DBCreatures.getFileDataIDByDisplayID(chrModelRow.DisplayID);

		chrModelIDToFileDataID.set(chrModelID, fileDataID);
		chrModelIDToTextureLayoutID.set(chrModelID, chrModelRow.CharComponentTextureLayoutID);

		const model_options = options_by_model.get(chrModelID);
		if (!model_options)
			continue;

		for (const [chrCustomizationOptionID, chrCustomizationOptionRow] of model_options) {
			const choiceList = [];

			if (!optionsByChrModel.has(chrCustomizationOptionRow.ChrModelID))
				optionsByChrModel.set(chrCustomizationOptionRow.ChrModelID, []);

			let optionName = '';
			if (chrCustomizationOptionRow.Name_lang != '')
				optionName = chrCustomizationOptionRow.Name_lang;
			else
				optionName = 'Option ' + chrCustomizationOptionRow.OrderIndex;

			optionsByChrModel.get(chrCustomizationOptionRow.ChrModelID).push({ id: chrCustomizationOptionID, label: optionName });

			const option_choices = choices_by_option.get(chrCustomizationOptionID);
			if (option_choices) {
				for (const [chrCustomizationChoiceID, chrCustomizationChoiceRow] of option_choices) {
					let name = '';
					if (chrCustomizationChoiceRow.Name_lang != '')
						name = chrCustomizationChoiceRow.Name_lang;
					else
						name = 'Choice ' + chrCustomizationChoiceRow.OrderIndex;

					const [swatch_color_0, swatch_color_1] = chrCustomizationChoiceRow.SwatchColor || [0, 0];
					choiceList.push({
						id: chrCustomizationChoiceID,
						label: name,
						swatch_color_0,
						swatch_color_1
					});
				}
			}

			const is_color_swatch = choiceList.some(c => c.swatch_color_0 !== 0 || c.swatch_color_1 !== 0);
			optionToChoices.set(chrCustomizationOptionID, choiceList);
			if (is_color_swatch)
				optionsByChrModel.get(chrCustomizationOptionRow.ChrModelID)[optionsByChrModel.get(chrCustomizationOptionRow.ChrModelID).length - 1].is_color_swatch = true;

			if (!(chrCustomizationOptionRow.Flags & 0x20))
				defaultOptions.push(chrCustomizationOptionID);
		}
	}

	await progress.step('Loading character races..');
	const chrRacesDB = new WDCReader('DBFilesClient/ChrRaces.db2');
	await chrRacesDB.parse();

	for (const [chrRaceID, chrRaceRow] of chrRacesDB.getAllRows()) {
		const flags = chrRaceRow.Flags;
		chrRaceMap.set(chrRaceID, { id: chrRaceID, name: chrRaceRow.Name_lang, isNPCRace: ((flags & 1) == 1 && chrRaceID != 23 && chrRaceID != 75) });
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
	const light = new THREE.HemisphereLight(0xffffff, 0x080820, 3);
	scene.add(light);
	scene.add(renderGroup);

	grid = new THREE.GridHelper(100, 100, 0x57afe2, 0x808080);

	if (state.config.modelViewerShowGrid)
		scene.add(grid);

	// WoW models are by default facing the wrong way; rotate everything.
	renderGroup.rotateOnAxis(new THREE.Vector3(0, 1, 0), -90 * (Math.PI / 180));

	updateChrRaceList();

	state.chrModelViewerContext = Object.seal({ camera, scene, controls: null, renderGroup, useCharacterControls: true });

	// Show the characters screen.
	state.loadPct = -1;
	state.isBusy--;
	state.setScreen('tab-characters');
});

core.registerLoadFunc(async () => {
	core.view.$watch('config.chrIncludeBaseClothing', () => uploadRenderOverrideTextures());

	core.events.on('click-export-character', () => exportCharModel());
	core.events.on('click-import-character', () => importCharacter());

	// user has changed the race selection
	core.view.$watch('chrCustRaceSelection', () => updateChrModelList());

	// user has changed the body type selection
	core.view.$watch('chrCustModelSelection', () => updateModelSelection(), { deep: true });

	// user has changed the customization selection
	core.view.$watch('chrCustOptionSelection', () => updateCustomizationType(), { deep: true });

	// user has changed the customization options selection
	core.view.$watch('chrCustChoiceSelection', () => updateCustomizationChoice(), { deep: true });

	core.view.$watch('chrCustActiveChoices', async () => {
		if (core.view.isBusy)
			return;

		await updateActiveCustomization();
	}, { deep: true });

	core.view.$watch('chrModelViewerAnimSelection', async selectedAnimationId => {
		if (!activeRenderer || !activeRenderer.playAnimation || core.view.chrModelViewerAnims.length === 0)
			return;

		if (selectedAnimationId !== null && selectedAnimationId !== undefined) {
			if (selectedAnimationId === 'none') {
				activeRenderer?.stopAnimation?.();

				if (core.view.modelViewerAutoAdjust)
					requestAnimationFrame(() => CameraBounding.fitCharacterInView(renderGroup, camera, core.view.chrModelViewerContext.controls, {
						viewHeightPercentage: 0.6,
						verticalOffsetFactor: 0
					}));
				return;
			}

			const animInfo = core.view.chrModelViewerAnims.find(anim => anim.id == selectedAnimationId);
			if (animInfo && animInfo.m2Index !== undefined && animInfo.m2Index >= 0) {
				log.write(`Playing animation ${selectedAnimationId} at M2 index ${animInfo.m2Index}`);
				await activeRenderer.playAnimation(animInfo.m2Index);

				if (core.view.modelViewerAutoAdjust)
					requestAnimationFrame(() => CameraBounding.fitCharacterInView(renderGroup, camera, core.view.chrModelViewerContext.controls, {
						viewHeightPercentage: 0.6,
						verticalOffsetFactor: 0
					}));
			}
		}
	});

	// expose updateChoiceForOption for template access
	core.view.updateChoiceForOption = updateChoiceForOption;

	// color utility functions for template
	core.view.intToCssColor = (value) => {
		if (value === 0)
			return 'transparent';

		const unsigned = value >>> 0;
		const hex = unsigned.toString(16).padStart(8, '0').toUpperCase();

		const r = parseInt(hex.substring(2, 4), 16);
		const g = parseInt(hex.substring(4, 6), 16);
		const b = parseInt(hex.substring(6, 8), 16);

		return `rgb(${r}, ${g}, ${b})`;
	};

	core.view.getSelectedChoice = (optionID) => {
		const activeChoice = core.view.chrCustActiveChoices.find(c => c.optionID === optionID);
		if (!activeChoice)
			return null;

		const choices = optionToChoices.get(optionID);
		if (!choices)
			return null;

		return choices.find(c => c.id === activeChoice.choiceID);
	};

	core.view.toggleColorPicker = (optionID) => {
		if (core.view.colorPickerOpenFor === optionID)
			core.view.colorPickerOpenFor = null;
		else
			core.view.colorPickerOpenFor = optionID;
	};

	core.view.selectColorChoice = (optionID, choiceID) => {
		updateChoiceForOption(optionID, choiceID);
		core.view.colorPickerOpenFor = null;
	};

	// expose loadImportString for debugging
	window.loadImportString = loadImportString;

	// export shader reset for debugging
	window.reloadShaders = async () => {
		await CharMaterialRenderer.init();

		for (const material of chrMaterials.values())
			await material.compileShaders();

		await uploadRenderOverrideTextures();
	}
});

module.exports = {
	getActiveRenderer: () => activeRenderer
};