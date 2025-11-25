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
const generics = require('../generics');
const CharMaterialRenderer = require('../3D/renderers/CharMaterialRenderer');
const M2Renderer = require('../3D/renderers/M2Renderer');
const M2Exporter = require('../3D/exporters/M2Exporter');
const CameraBounding = require('../3D/camera/CameraBounding');
const db2 = require('../casc/db2');
const ExportHelper = require('../casc/export-helper');
const listfile = require('../casc/listfile');
const realmlist = require('../casc/realmlist');
const DBCreatures = require('../db/caches/DBCreatures');
const { wmv_parse } = require('../wmv');
const { wowhead_parse } = require('../wowhead');

let camera;
let scene;
let grid;
let shadow_plane;

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

	// track which texture type has the baked npc texture applied
	let bakedNPCTextureType = null;

	// check for baked npc texture override
	if (core.view.chrCustBakedNPCTexture) {
		const blp = core.view.chrCustBakedNPCTexture;

		console.log('applying baked npc texture, currentCharComponentTextureLayoutID:', currentCharComponentTextureLayoutID);

		// find what texture types are available for this layout
		const availableTypes = [];
		for (const [key, value] of chrModelMaterialMap.entries()) {
			if (key.startsWith(currentCharComponentTextureLayoutID + '-')) {
				availableTypes.push({ key, type: value.TextureType, material: value });
			}
		}
		console.log('available texture types for layout:', availableTypes);

		// sort by texture type to ensure we get the base skin (typically the lowest type number)
		availableTypes.sort((a, b) => a.type - b.type);

		// use the first available texture type (should be the base skin)
		const chrModelMaterial = availableTypes.length > 0 ? availableTypes[0].material : null;
		const textureType = availableTypes.length > 0 ? availableTypes[0].type : 0;

		console.log('using texture type:', textureType, 'from available:', availableTypes.map(t => t.type));
		console.log('chrModelMaterial:', chrModelMaterial);

		if (chrModelMaterial) {
			let chrMaterial;

			if (!chrMaterials.has(textureType)) {
				chrMaterial = new CharMaterialRenderer(textureType, chrModelMaterial.Width, chrModelMaterial.Height);
				chrMaterials.set(textureType, chrMaterial);
				await chrMaterial.init();
				console.log('created new chrmaterial for type', textureType);
			} else {
				chrMaterial = chrMaterials.get(textureType);
				console.log('reusing existing chrmaterial for type', textureType);
			}

			console.log('calling settexturetarget with blp:', blp);

			// draw full-sized baked texture (0,0 to width,height)
			await chrMaterial.setTextureTarget(
				{ FileDataID: 0, ChrModelTextureTargetID: 0 },
				{ X: 0, Y: 0, Width: chrModelMaterial.Width, Height: chrModelMaterial.Height },
				chrModelMaterial,
				{ BlendMode: 0, TextureType: textureType, ChrModelTextureTargetID: [0, 0] },
				true,
				blp
			);

			console.log('settexturetarget complete, textureTargets count:', chrMaterial.textureTargets.length);

			// mark this texture type as having the baked npc texture
			bakedNPCTextureType = textureType;
		} else {
			console.log('ERROR: chrModelMaterial not found for layout', currentCharComponentTextureLayoutID);
		}
	}

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

				// skip if this texture type has a baked npc texture applied
				if (bakedNPCTextureType !== null && chrModelMaterial.TextureType === bakedNPCTextureType) {
					console.log('skipping customization texture for type', chrModelMaterial.TextureType, 'because baked npc texture is applied');
					continue;
				}

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
			{ id: 'none', label: 'No Animation', m2Index: -1 },
			...animList
		];

		core.view.chrModelViewerAnims = finalAnimList;

		// default to stand (0.0) if available, otherwise no animation
		const stand_anim = animList.find(anim => anim.id === '0.0');
		core.view.chrModelViewerAnimSelection = stand_anim ? '0.0' : 'none';

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
	core.view.characterImportMode = 'none';
	core.view.chrModelLoading = true;

	const character_name = core.view.chrImportChrName; // string
	const selected_realm = core.view.chrImportSelectedRealm; // { label, value }
	const selected_region = core.view.chrImportSelectedRegion; // eu

	if (selected_realm === null) {
		core.setToast('error', 'Please enter a valid realm.', null, 3000);
		core.view.chrModelLoading = false;
		core.view.isBusy--;
		return;
	}

	const character_label = util.format('%s (%s-%s)', character_name, selected_region, selected_realm.label);
	const url = util.format(core.view.config.armoryURL, encodeURIComponent(selected_region), encodeURIComponent(selected_realm.value), encodeURIComponent(character_name.toLowerCase()));
	log.write('Retrieving character data for %s from %s', character_label, url);

	const res = await generics.get(url);
	if (res.ok) {
		try {
			loadImportJSON(await res.json());
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

	core.view.chrModelLoading = false;
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

async function importWMVCharacter() {
	const file_input = document.createElement('input');
	file_input.setAttribute('type', 'file');
	file_input.setAttribute('accept', '.chr');
	file_input.setAttribute('nwworkingdir', core.view.config.lastWMVImportPath || '');

	file_input.addEventListener('change', async () => {
		if (file_input.files.length === 0)
			return;

		const file = file_input.files[0];
		const file_path = file.path;

		if (file_path) {
			const path = require('path');
			core.view.config.lastWMVImportPath = path.dirname(file_path);
		}

		core.view.isBusy++;
		core.view.chrModelLoading = true;

		try {
			const file_content = await file.text();
			const wmv_data = wmv_parse(file_content);

			if (wmv_data.legacy_values)
				loadWMVLegacy(wmv_data);
			else
				loadWMVModern(wmv_data);

		} catch (e) {
			log.write('failed to load .chr file: %s', e.message);
			core.setToast('error', `failed to load .chr file: ${e.message}`, null, -1);
		}

		core.view.chrModelLoading = false;
		core.view.isBusy--;
	});

	file_input.click();
}

function loadWMVModern(wmv_data) {
	const race_id = wmv_data.race;
	const gender_index = wmv_data.gender;

	const chr_model_id = chrRaceXChrModelMap.get(race_id).get(gender_index);
	core.view.chrImportChrModelID = chr_model_id;

	const available_options = optionsByChrModel.get(chr_model_id);
	const available_options_ids = [];
	for (const option of available_options)
		available_options_ids.push(option.id);

	core.view.chrImportChoices.splice(0, core.view.chrImportChoices.length);

	const parsed_choices = [];
	for (const customization of wmv_data.customizations) {
		if (!available_options_ids.includes(customization.option_id))
			continue;

		parsed_choices.push({ optionID: customization.option_id, choiceID: customization.choice_id });
	}

	core.view.chrImportChoices.push(...parsed_choices);
	core.view.chrCustRaceSelection = [core.view.chrCustRaces.find(e => e.id === race_id)];
}

function loadWMVLegacy(wmv_data) {
	const race_id = wmv_data.race;
	const gender_index = wmv_data.gender;

	const chr_model_id = chrRaceXChrModelMap.get(race_id).get(gender_index);
	core.view.chrImportChrModelID = chr_model_id;

	const available_options = optionsByChrModel.get(chr_model_id);

	core.view.chrImportChoices.splice(0, core.view.chrImportChoices.length);

	const parsed_choices = [];
	const legacy = wmv_data.legacy_values;

	const option_map = {
		'skin': legacy.skin_color,
		'face': legacy.face_type,
		'hair color': legacy.hair_color,
		'hair style': legacy.hair_style,
		'facial': legacy.facial_hair
	};

	for (const option of available_options) {
		const label_lower = option.label.toLowerCase();

		for (const [key, value] of Object.entries(option_map)) {
			if (label_lower.includes(key)) {
				const choices = optionToChoices.get(option.id);
				if (choices && choices[value]) {
					parsed_choices.push({ optionID: option.id, choiceID: choices[value].id });
					break;
				}
			}
		}
	}

	core.view.chrImportChoices.push(...parsed_choices);

	core.view.chrCustRaceSelection = [core.view.chrCustRaces.find(e => e.id === race_id)];
}

async function importWowheadCharacter() {
	core.view.isBusy++;
	core.view.characterImportMode = 'none';
	core.view.chrModelLoading = true;

	const wowhead_url = core.view.chrImportWowheadURL;

	if (!wowhead_url || !wowhead_url.includes('dressing-room')) {
		core.setToast('error', 'please enter a valid wowhead dressing room url', null, 3000);
		core.view.chrModelLoading = false;
		core.view.isBusy--;
		return;
	}

	try {
		const wowhead_data = wowhead_parse(wowhead_url);
		loadWowheadData(wowhead_data);
	} catch (e) {
		log.write('failed to parse wowhead url: %s', e.message);
		core.setToast('error', `failed to import wowhead character: ${e.message}`, null, -1);
	}

	core.view.chrModelLoading = false;
	core.view.isBusy--;
}

function loadWowheadData(wowhead_data) {
	const race_id = wowhead_data.race;
	const gender_index = wowhead_data.gender;

	const chr_model_id = chrRaceXChrModelMap.get(race_id).get(gender_index);
	core.view.chrImportChrModelID = chr_model_id;

	const available_options = optionsByChrModel.get(chr_model_id);

	core.view.chrImportChoices.splice(0, core.view.chrImportChoices.length);

	// wowhead customizations are choice ids, map them to option/choice pairs
	const parsed_choices = [];
	for (const choice_id of wowhead_data.customizations) {
		const choice_row = db2.ChrCustomizationChoice.getRow(choice_id);
		if (!choice_row)
			continue;

		const option_id = choice_row.ChrCustomizationOptionID;

		// verify option is available for this model
		if (!available_options.find(opt => opt.id === option_id))
			continue;

		parsed_choices.push({ optionID: option_id, choiceID: choice_id });
	}

	core.view.chrImportChoices.push(...parsed_choices);
	core.view.chrCustRaceSelection = [core.view.chrCustRaces.find(e => e.id === race_id)];
}

const exportCharModel = async () => {
	const exportPaths = core.openLastExportStream();
	const format = core.view.config.exportCharacterFormat;

	if (format === 'PNG' || format === 'CLIPBOARD') {
		if (activeModel) {
			core.setToast('progress', 'saving preview, hold on...', null, -1, false);

			const canvas = document.querySelector('.char-preview canvas');
			const buf = await BufferWrapper.fromCanvas(canvas, 'image/png');

			if (format === 'PNG') {
				const fileName = listfile.getByID(activeModel);
				const exportPath = ExportHelper.getExportPath(fileName);
				let outFile = ExportHelper.replaceExtension(exportPath, '.png');

				if (core.view.config.modelsExportPngIncrements)
					outFile = await ExportHelper.getIncrementalFilename(outFile);

				const outDir = path.dirname(outFile);

				await buf.writeToFile(outFile);
				await exportPaths?.writeLine('PNG:' + outFile);

				log.write('saved 3d preview screenshot to %s', outFile);
				core.setToast('success', util.format('successfully exported preview to %s', outFile), { 'view in explorer': () => nw.Shell.openItem(outDir) }, -1);
			} else if (format === 'CLIPBOARD') {
				const clipboard = nw.Clipboard.get();
				clipboard.set(buf.toBase64(), 'png', true);

				log.write('copied 3d preview to clipboard (character %s)', activeModel);
				core.setToast('success', '3D preview has been copied to the clipboard', null, -1, true);
			}
		} else {
			core.setToast('error', 'the selected export option only works for character previews. preview something first!', null, -1);
		}

		exportPaths?.close();
		return;
	}

	const casc = core.view.casc;
	const helper = new ExportHelper(1, 'model');
	helper.start();

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

		exporter.setGeosetMask(core.view.chrCustGeosets);

		const formatLower = format.toLowerCase();
		await exporter.exportAsGLTF(exportPath, helper, formatLower);
		await exportPaths?.writeLine('M2_' + format + ':' + exportPath);

		if (helper.isCancelled())
			return;

		helper.mark(fileName, true);
	} catch (e) {
		helper.mark(fileName, false, e.message, e.stack);
	}

	helper.finish();
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

function randomizeCustomization() {
	const state = core.view;
	const options = state.chrCustOptions;

	for (const option of options) {
		const choices = optionToChoices.get(option.id);
		if (choices && choices.length > 0) {
			const random_choice = choices[Math.floor(Math.random() * choices.length)];
			updateChoiceForOption(option.id, random_choice.id);
		}
	}
}

core.events.once('screen-tab-characters', async () => {
	const state = core.view;

	core.showLoadingScreen(13);

	await core.progressLoadingScreen('Retrieving realmlist...');
	await realmlist.load();

	core.view.$watch('chrImportSelectedRegion', () => {
		const realmList = state.realmList[state.chrImportSelectedRegion].map(realm => ({ label: realm.name, value: realm.slug }));
		state.chrImportRealms = realmList;

		if (state.chrImportSelectedRealm !== null) {
			const matching_realm = realmList.find(realm => realm.value === state.chrImportSelectedRealm.value);
			if (matching_realm)
				state.chrImportSelectedRealm = matching_realm;
			else
				state.chrImportSelectedRealm = null;
		}
	});

	state.chrImportRegions = Object.keys(state.realmList);
	state.chrImportSelectedRegion = state.chrImportRegions[0];

	await core.progressLoadingScreen('Loading texture mapping...');
	const tfdMap = new Map();
	for (const tfdRow of (await db2.TextureFileData.getAllRows()).values()) {
		// Skip specular (1) and emissive (2)
		if (tfdRow.UsageType != 0)
			continue;
		tfdMap.set(tfdRow.MaterialResourcesID, tfdRow.FileDataID);
	}

	await core.progressLoadingScreen('Loading creature data...');
	await DBCreatures.initializeCreatureData();

	await core.progressLoadingScreen('Loading character customization elements...');
	for (const chrCustomizationElementRow of (await db2.ChrCustomizationElement.getAllRows()).values()) {
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

			const matRow = await db2.ChrCustomizationMaterial.getRow(chrCustomizationElementRow.ChrCustomizationMaterialID);
			if (matRow !== null)
				chrCustMatMap.set(matRow.ID, {ChrModelTextureTargetID: matRow.ChrModelTextureTargetID, FileDataID: tfdMap.get(matRow.MaterialResourcesID)});
		}
	}

	await core.progressLoadingScreen('Loading character customization options...');

	// pre-index options by model id and choices by option id
	const options_by_model = new Map();
	const choices_by_option = new Map();
	const unsupported_choices_set = new Set(unsupportedChoices);

	for (const [chrCustomizationOptionID, chrCustomizationOptionRow] of await db2.ChrCustomizationOption.getAllRows()) {
		const model_id = chrCustomizationOptionRow.ChrModelID;
		if (!options_by_model.has(model_id))
			options_by_model.set(model_id, []);

		options_by_model.get(model_id).push([chrCustomizationOptionID, chrCustomizationOptionRow]);
	}

	for (const [chrCustomizationChoiceID, chrCustomizationChoiceRow] of await db2.ChrCustomizationChoice.getAllRows()) {
		const option_id = chrCustomizationChoiceRow.ChrCustomizationOptionID;
		if (!choices_by_option.has(option_id))
			choices_by_option.set(option_id, []);
		
		choices_by_option.get(option_id).push([chrCustomizationChoiceID, chrCustomizationChoiceRow]);
	}

	for (const [chrModelID, chrModelRow] of await db2.ChrModel.getAllRows()) {
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

	await core.progressLoadingScreen('Loading character races..');
	for (const [chrRaceID, chrRaceRow] of await db2.ChrRaces.getAllRows()) {
		const flags = chrRaceRow.Flags;
		chrRaceMap.set(chrRaceID, { id: chrRaceID, name: chrRaceRow.Name_lang, isNPCRace: ((flags & 1) == 1 && chrRaceID != 23 && chrRaceID != 75) });
	}

	await core.progressLoadingScreen('Loading character race models..');
	for (const chrRaceXChrModelRow of (await db2.ChrRaceXChrModel.getAllRows()).values()) {
		if (!chrRaceXChrModelMap.has(chrRaceXChrModelRow.ChrRacesID))
			chrRaceXChrModelMap.set(chrRaceXChrModelRow.ChrRacesID, new Map());

		chrRaceXChrModelMap.get(chrRaceXChrModelRow.ChrRacesID).set(chrRaceXChrModelRow.Sex, chrRaceXChrModelRow.ChrModelID);
	}

	await core.progressLoadingScreen('Loading character model materials..');
	for (const chrModelMaterialRow of (await db2.ChrModelMaterial.getAllRows()).values())
		chrModelMaterialMap.set(chrModelMaterialRow.CharComponentTextureLayoutsID + "-" + chrModelMaterialRow.TextureType, chrModelMaterialRow);

	// load charComponentTextureSection
	await core.progressLoadingScreen('Loading character component texture sections...');
	const charComponentTextureSectionDB = db2.CharComponentTextureSections;
	for (const charComponentTextureSectionRow of (await charComponentTextureSectionDB.getAllRows()).values()) {
		if (!charComponentTextureSectionMap.has(charComponentTextureSectionRow.CharComponentTextureLayoutID))
			charComponentTextureSectionMap.set(charComponentTextureSectionRow.CharComponentTextureLayoutID, []);

		charComponentTextureSectionMap.get(charComponentTextureSectionRow.CharComponentTextureLayoutID).push(charComponentTextureSectionRow);
	}

	await core.progressLoadingScreen('Loading character model texture layers...');
	const chrModelTextureLayerDB = db2.ChrModelTextureLayer;
	for (const chrModelTextureLayerRow of (await chrModelTextureLayerDB.getAllRows()).values())
		chrModelTextureLayerMap.set(chrModelTextureLayerRow.CharComponentTextureLayoutsID + "-" + chrModelTextureLayerRow.ChrModelTextureTargetID[0], chrModelTextureLayerRow);

	await core.progressLoadingScreen('Loading character customization geosets...');
	for (const [chrCustomizationGeosetID, chrCustomizationGeosetRow] of await db2.ChrCustomizationGeoset.getAllRows()) {
		const geoset = chrCustomizationGeosetRow.GeosetType.toString().padStart(2, '0') + chrCustomizationGeosetRow.GeosetID.toString().padStart(2, '0');
		geosetMap.set(chrCustomizationGeosetID, Number(geoset));
	}

	await core.progressLoadingScreen('Loading character customization skinned models...');

	const chrCustSkinnedModelDB = db2.ChrCustomizationSkinnedModel;
	for (const [chrCustomizationSkinnedModelID, chrCustomizationSkinnedModelRow] of await chrCustSkinnedModelDB.getAllRows())
		chrCustSkinnedModelMap.set(chrCustomizationSkinnedModelID, chrCustomizationSkinnedModelRow);

	await core.progressLoadingScreen('Loading character shaders...');
	await CharMaterialRenderer.init();

	// Initialize model viewer.
	camera = new THREE.PerspectiveCamera(70, undefined, 0.01, 2000);

	scene = new THREE.Scene();
	const light = new THREE.HemisphereLight(0xffffff, 0x080820, 3);
	scene.add(light);
	scene.add(renderGroup);

	const shadow_geometry = new THREE.PlaneGeometry(2, 2);
	const shadow_material = new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		uniforms: {
			shadow_radius: { value: 8.0 }
		},
		vertexShader: `
			varying vec2 v_uv;
			void main() {
				v_uv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: `
			uniform float shadow_radius;
			varying vec2 v_uv;
			void main() {
				vec2 center = vec2(0.5, 0.5);
				float dist = distance(v_uv, center) * 2.0;
				float alpha = smoothstep(1.0, 0.0, dist / (shadow_radius / 10.0));
				gl_FragColor = vec4(0.0, 0.0, 0.0, alpha * 0.6);
			}
		`
	});

	shadow_plane = new THREE.Mesh(shadow_geometry, shadow_material);
	shadow_plane.rotation.x = -Math.PI / 2;
	shadow_plane.position.set(0, 0, 0);

	if (state.config.chrRenderShadow && !state.chrModelLoading)
		scene.add(shadow_plane);

	grid = new THREE.GridHelper(100, 100, 0x57afe2, 0x808080);

	if (state.config.modelViewerShowGrid)
		scene.add(grid);

	// WoW models are by default facing the wrong way; rotate everything.
	renderGroup.rotateOnAxis(new THREE.Vector3(0, 1, 0), -90 * (Math.PI / 180));

	updateChrRaceList();

	state.chrModelViewerContext = Object.seal({ camera, scene, controls: null, renderGroup, useCharacterControls: true, getActiveRenderer: () => activeRenderer });

	core.hideLoadingScreen('tab-characters');
});

function update_render_shadow() {
	if (!shadow_plane || !scene)
		return;

	const should_show = core.view.config.chrRenderShadow && !core.view.chrModelLoading;

	if (should_show && !shadow_plane.parent)
		scene.add(shadow_plane);
	else if (!should_show && shadow_plane.parent)
		scene.remove(shadow_plane);
}

core.registerLoadFunc(async () => {
	core.view.$watch('config.chrIncludeBaseClothing', () => uploadRenderOverrideTextures());
	core.view.$watch('config.chrRenderShadow', () => update_render_shadow());
	core.view.$watch('chrModelLoading', () => update_render_shadow());

	core.events.on('click-export-character', () => exportCharModel());
	core.events.on('click-import-character', () => importCharacter());
	core.events.on('click-import-wmv', () => importWMVCharacter());
	core.events.on('click-import-wowhead', () => importWowheadCharacter());

	core.view.randomizeCustomization = randomizeCustomization;

	core.events.on('click-remove-baked-npc-texture', async () => {
		core.view.chrCustBakedNPCTexture = null;
		await updateActiveCustomization();
	});

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

	core.view.toggleColorPicker = (optionID, event) => {
		if (core.view.colorPickerOpenFor === optionID) {
			core.view.colorPickerOpenFor = null;
		} else {
			core.view.colorPickerPosition = { x: event.clientX, y: event.clientY };
			core.view.colorPickerOpenFor = optionID;
		}
	};

	core.view.selectColorChoice = (optionID, choiceID) => {
		updateChoiceForOption(optionID, choiceID);
		core.view.colorPickerOpenFor = null;
	};

	document.addEventListener('click', (event) => {
		if (core.view.colorPickerOpenFor !== null) {
			const popup = event.target.closest('.color-picker-popup');
			const label = event.target.closest('.customization-color-label');
			if (!popup && !label)
				core.view.colorPickerOpenFor = null;
		}

		if (core.view.characterImportMode !== 'none') {
			const import_panel = event.target.closest('#character-import-panel-floating');
			const bnet_button = event.target.closest('.character-bnet-button');
			const wowhead_button = event.target.closest('.character-wowhead-button');
			if (!import_panel && !bnet_button && !wowhead_button)
				core.view.characterImportMode = 'none';
		}
	});

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