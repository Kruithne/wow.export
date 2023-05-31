/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import State from '../state';
import Events from '../events';
import WDCReader from '../db/WDCReader';
import Log from '../log';
import * as THREE from 'three';
import util from 'node:util';

import ChrCustomizationOption from '../db/types/ChrCustomizationOption';
import ChrModel from '../db/types/ChrModel';

import M2Renderer, { DisplayInfo } from '../3D/renderers/M2Renderer';
import { isMemberExpressionBrowser } from '../../../bin/win-x64-debug/src/app';
import { config } from 'node:process';
import { stat } from 'node:fs';
import { load } from '../config';
import stateContainer from '../state';
import GeosetEntry from '../3D/GeosetEntry';
import { popScopeId } from 'vue';

type ChrCustomizationListEntry = {
	id: number,
	label: string
};

type ChrRaceEntry = {
	id: number,
	name: string,
	isNPCRace: boolean
}

type ChrCustomizationChoice = {
	optionID: number,
	choiceID: number
}

let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let grid: THREE.GridHelper;

const activeSkins = new Map<string, DisplayInfo>();
const renderGroup = new THREE.Group();

let isFirstModel = true;
let activeRenderer: M2Renderer | undefined;
let activeModel: number | undefined;

// TODO: Need to make these accessible while in the character tab. Not sure how scope works here.
const chrModelIDToFileDataID = new Map<number, number>();
const chrModelIDToTextureLayoutID = new Map<number, number>();
const optionsByChrModel = new Map<number, Array<{ id: number, label: string }>>();
const optionToChoices = new Map<number, Array<ChrCustomizationListEntry>>();
const chrRaceMap = new Map<number, ChrRaceEntry>();
const chrRaceXChrModelMap = new Map<number, Map<number, number>>();
const choiceToGeoset = new Map<number, number>();
const geosetMap = new Map<number, number>();

Events.once('screen-tab-characters', async () => {
	const state = State.state;

	// Initialize a loading screen.
	const progress = state.createProgress(5);
	state.setScreen('loading');
	state.isBusy++;

	await progress.step('Loading character models..');
	const chrModelDB = new WDCReader('DBFilesClient/ChrModel.db2');
	await chrModelDB.parse();

	await progress.step('Loading character customization choices...');
	const chrCustChoiceDB = new WDCReader('DBFilesClient/ChrCustomizationChoice.db2');
	await chrCustChoiceDB.parse();

	await progress.step('Loading character customization options...');
	const chrCustOptDB = new WDCReader('DBFilesClient/ChrCustomizationOption.db2');
	await chrCustOptDB.parse();

	// TODO: We already have these loaded through DBCreatures cache. Get from there instead.
	await progress.step('Loading creature display info...');
	const creatureDisplayInfoDB = new WDCReader('DBFilesClient/CreatureDisplayInfo.db2');
	await creatureDisplayInfoDB.parse();

	await progress.step('Loading creature model data...');
	const creatureModelDataDB = new WDCReader('DBFilesClient/CreatureModelData.db2');
	await creatureModelDataDB.parse();

	for (const [chrModelID, chrModelRow] of chrModelDB.getAllRows() as Map<number, ChrModel>) {
		const displayRow = creatureDisplayInfoDB.getRow(chrModelRow.DisplayID);
		if (displayRow === null) {
			Log.write(`No display info for chrModelID ${chrModelID}, DisplayID ${chrModelRow.DisplayID} not found, skipping.`);
			continue;
		}

		const modelRow = creatureModelDataDB.getRow(displayRow.ModelID as number);
		if (modelRow === null) {
			Log.write(`No model data found for CreatureModelDataID ${displayRow.ModelID}, skipping.`);
			continue;
		}

		chrModelIDToFileDataID.set(chrModelID, modelRow.FileDataID as number);
		chrModelIDToTextureLayoutID.set(chrModelID, chrModelRow.CharComponentTextureLayoutID);

		for (const [chrCustomizationOptionID, chrCustomizationOptionRow] of chrCustOptDB.getAllRows() as Map<number, ChrCustomizationOption>) {
			if (chrCustomizationOptionRow.ChrModelID != chrModelID)
				continue;

			const choiceList = new Array<{ id: number, label: string }>();

			if (!optionsByChrModel.has(chrCustomizationOptionRow.ChrModelID))
				optionsByChrModel.set(chrCustomizationOptionRow.ChrModelID, []);

			optionsByChrModel.get(chrCustomizationOptionRow.ChrModelID).push({ id: chrCustomizationOptionID, label: chrCustomizationOptionRow.Name_lang });

			for (const [chrCustomizationChoiceID, chrCustomizationChoiceRow] of chrCustChoiceDB.getAllRows()) {
				if (chrCustomizationChoiceRow.ChrCustomizationOptionID != chrCustomizationOptionID)
					continue;

				// Generate name because Blizz hasn't gotten around to setting it for everything yet.
				let name = '';
				if (chrCustomizationChoiceRow.Name_lang != '')
					name = chrCustomizationChoiceRow.Name_lang as string;
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
		const flags = chrRaceRow.Flags as number;
		chrRaceMap.set(chrRaceID, { id: chrRaceID, name: chrRaceRow.Name_lang as string, isNPCRace: (flags & 1) == 1 });
	}

	await progress.step('Loading character race models..');
	const chrRaceXChrModelDB = new WDCReader('DBFilesClient/ChrRaceXChrModel.db2');
	await chrRaceXChrModelDB.parse();

	for (const [chrRaceXChrModelID, chrRaceXChrModelRow] of chrRaceXChrModelDB.getAllRows()) {
		if (!chrRaceXChrModelMap.has(chrRaceXChrModelRow.ChrRacesID as number))
			chrRaceXChrModelMap.set(chrRaceXChrModelRow.ChrRacesID as number, new Map<number, number>());

		chrRaceXChrModelMap.get(chrRaceXChrModelRow.ChrRacesID as number).set(chrRaceXChrModelRow.Sex as number, chrRaceXChrModelRow.ChrModelID as number);
	}

	updateChrModelList();

	// await progress.step('Loading character model materials..');
	// const chrModelMatDB = new WDCReader('DBFilesClient/ChrModelMaterial.db2');
	// await chrModelMatDB.parse();

	// await progress.step('Loading character customization table...');
	// const chrCustDB = new WDCReader('DBFilesClient/ChrCustomization.db2');
	// await chrCustDB.parse();

	await progress.step('Loading character customization elements...');
	const chrCustElementDB = new WDCReader('DBFilesClient/ChrCustomizationElement.db2');
	await chrCustElementDB.parse();

	for (const [chrCustomizationElementID, chrCustomizationElementRow] of chrCustElementDB.getAllRows()) {
		if (chrCustomizationElementRow.ChrCustomizationGeosetID != 0)
			choiceToGeoset.set(chrCustomizationElementRow.ChrCustomizationChoiceID as number, chrCustomizationElementRow.ChrCustomizationGeosetID as number);

		// if (chrCustomizationElementRow.ChrCustomizationMaterialID != 0) {
		// 	if (choiceToChrCustMaterialID.has(chrCustomizationElementRow.ChrCustomizationChoiceID))
		// 		choiceToChrCustMaterialID.get(chrCustomizationElementRow.ChrCustomizationChoiceID).push(chrCustomizationElementRow);
		// 	else
		// 		choiceToChrCustMaterialID.set(chrCustomizationElementRow.ChrCustomizationChoiceID, [chrCustomizationElementRow]);

		// 	const matRow = chrCustomizationMaterial.getRow(chrCustomizationElementRow.ChrCustomizationMaterialID);
		// 	chrCustMatMap.set(matRow.ID, {ChrModelTextureTargetID: matRow.ChrModelTextureTargetID, MaterialResourcesID: matRow.MaterialResourcesID});
		// }
	}

	await progress.step('Loading character customization materials...');
	const chrCustGeosetDB = new WDCReader('DBFilesClient/ChrCustomizationGeoset.db2');
	await chrCustGeosetDB.parse();

	for (const [chrCustomizationGeosetID, chrCustomizationGeosetRow] of chrCustGeosetDB.getAllRows()) {
		const geoset = chrCustomizationGeosetRow.GeosetType.toString().padStart(2, '0') + chrCustomizationGeosetRow.GeosetID.toString().padStart(2, '0');
		geosetMap.set(chrCustomizationGeosetID, Number(geoset));
	}

	// await progress.step('Loading character customization materials...');
	// const chrCustMatDB = new WDCReader('DBFilesClient/ChrCustomizationMaterial.db2');
	// await chrCustMatDB.parse();

	// Initialize model viewer.
	camera = new THREE.PerspectiveCamera(70, undefined, 0.01, 2000);

	scene = new THREE.Scene();
	const light = new THREE.HemisphereLight(0xffffff, 0x080820, 1);
	scene.add(light);
	scene.add(renderGroup);

	grid = new THREE.GridHelper(100, 100, 0x57afe2, 0x808080);

	if (State.state.config.modelViewerShowGrid)
		scene.add(grid);

	// WoW models are by default facing the wrong way; rotate everything.
	renderGroup.rotateOnAxis(new THREE.Vector3(0, 1, 0), -90 * (Math.PI / 180));

	State.state.chrModelViewerContext = Object.seal({ camera, scene, controls: null });

	// Show the characters screen.
	state.loadPct = -1;
	state.isBusy--;
	state.setScreen('tab-characters');
});

Events.once('casc-ready', async () => {
	const state = State.state;

	// If NPC race toggle changes, refresh model list.
	state.$watch('config.chrCustShowNPCRaces', () => {
		updateChrModelList();
	});

	state.$watch('chrCustImportString', () => {
		loadImportString(state.chrCustImportString);
	});

	// When the selected model skin is changed, update our model.
	state.$watch('chrCustModelSelection', async (selection: Array<ChrCustomizationListEntry>) => {
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

		const fileDataID = chrModelIDToFileDataID.get(selected.id);

		// Check if the first file in the selection is "new".
		if (!state.isBusy && fileDataID && activeModel !== fileDataID)
			previewModel(fileDataID);
	}, { deep: true });

	state.$watch('chrCustOptionSelection', async (selection: Array<ChrCustomizationListEntry>) => {
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

		const selectedChoice = state.chrCustActiveChoices.find((choice: ChrCustomizationChoice) => choice.optionID === selected.id);

		if (selectedChoice !== undefined)
			state.chrCustChoiceSelection.push(...availableChoices.filter((x => x.id === selectedChoice.choiceID)));
		else
			state.chrCustChoiceSelection.push(...availableChoices.slice(0, 1));

	}, { deep: true });

	state.$watch('chrCustChoiceSelection', async (selection: Array<ChrCustomizationListEntry>) => {
		const selected = selection[0];
		console.log('Choice selection for option ID ' + state.chrCustOptionSelection[0].id + ', label ' + state.chrCustOptionSelection[0].label + ' changed to choice ID ' + selected.id + ', label ' + selected.label);
		if (state.chrCustActiveChoices.find((choice: ChrCustomizationChoice) => choice.optionID === state.chrCustOptionSelection[0].id) === undefined) {
			state.chrCustActiveChoices.push({ optionID: state.chrCustOptionSelection[0].id, choiceID: selected.id });
		} else {
			const index = state.chrCustActiveChoices.findIndex((choice: ChrCustomizationChoice) => choice.optionID === state.chrCustOptionSelection[0].id);
			state.chrCustActiveChoices[index].choiceID = selected.id;
		}
	}, { deep: true });

	state.$watch('chrCustActiveChoices', async (selection: Array<ChrCustomizationChoice>) => {
		console.log('Active choices changed');
		for (const activeChoice of selection) {
			// Update all geosets for this option.
			const availableChoices = optionToChoices.get(activeChoice.optionID);

			for (const availableChoice of availableChoices) {
				const geosetID = choiceToGeoset.get(availableChoice.id);
				const geoset = geosetMap.get(geosetID);

				if (geoset !== undefined) {
					for (const availableGeoset of state.modelViewerGeosets as Array<GeosetEntry>) {
						if (availableGeoset.id === geoset) {
							const shouldBeEnabled = availableChoice.id === activeChoice.choiceID;
							console.log('Setting geoset ' + geoset + ' to ' + shouldBeEnabled);
							availableGeoset.checked = shouldBeEnabled;
						}
					}
				}
			}
		}
	}, { deep: true });
});

async function updateChrModelList(): Promise<void> {
	const characterModelList = Array<ChrCustomizationListEntry>();

	// Keep a list of listed models, some races are duplicated because of multi-factions.
	const listedModels = Array<number>();

	// Build character model list.
	for (const [chrRaceID, chrRaceInfo] of chrRaceMap) {
		if (!chrRaceXChrModelMap.has(chrRaceID))
			continue;

		const chrModels = chrRaceXChrModelMap.get(chrRaceID);
		for (const [chrSex, chrModelID] of chrModels) {
			if (!State.state.config.chrCustShowNPCRaces && chrRaceInfo.isNPCRace || listedModels.includes(chrModelID))
				continue;

			listedModels.push(chrModelID);
			characterModelList.push({id: chrModelID, label: chrRaceInfo.name + ' body type ' + chrSex});
		}
	}

	// Empty the arrays.
	State.state.chrCustModels.splice(0, State.state.chrCustModels.length);
	State.state.chrCustModelSelection.splice(0, State.state.chrCustModelSelection.length);

	// Add the new skins.
	State.state.chrCustModels.push(...characterModelList);
	State.state.chrCustModelSelection.push(...characterModelList.slice(0, 1));
}

async function previewModel(fileDataID: number): Promise<void> {
	State.state.isBusy++;
	State.state.setToast('progress', 'Loading model, please wait...', null, -1, false);
	Log.write('Previewing model %s', fileDataID);

	// Empty the arrays.
	State.state.modelViewerSkins.splice(0, State.state.modelViewerSkins.length);
	State.state.modelViewerSkinsSelection.splice(0, State.state.modelViewerSkinsSelection.length);

	try {
		// Dispose the currently active renderer.
		if (activeRenderer) {
			activeRenderer.dispose();
			activeRenderer = undefined;
			activeModel = undefined;
		}

		// Clear the active skin map.
		activeSkins.clear();

		const file = await State.state.casc.getFile(fileDataID);

		activeRenderer = new M2Renderer(file, renderGroup, true);

		await activeRenderer.load();

		updateCameraBounding();

		activeModel = fileDataID;

		// Renderer did not provide any 3D data.
		if (renderGroup.children.length === 0)
			State.state.setToast('info', util.format('The model %s doesn\'t have any 3D data associated with it.', fileDataID), null, 4000);
		else
			State.state.hideToast();
	} catch (e) {
		// Error reading/parsing model.
		State.state.setToast('error', 'Unable to preview model ' + fileDataID, { 'View Log': () => Log.openRuntimeLog() }, -1);
		Log.write('Failed to open CASC file: %s', e.message);
	}

	State.state.isBusy--;
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

	if (isFirstModel || State.state.modelViewerAutoAdjust) {
		camera.position.set(center.x, center.y, cameraZ);
		isFirstModel = false;
	}

	const minZ = boundingBox.min.z;
	const cameraToFarEdge = (minZ < 0) ? -minZ + cameraZ : cameraZ - minZ;

	camera.updateProjectionMatrix();

	const controls = State.state.modelViewerContext.controls;
	if (controls) {
		controls.target = center;
		controls.maxDistance = cameraToFarEdge * 2;
	}
}

async function loadImportString(importString: string): Promise<void> {
	State.state.isBusy++;
	State.state.setToast('progress', 'Importing, please wait..', null, -1, false);

	if (importString.length === 0) {

		// Reset active choices.
		State.state.chrCustActiveChoices.splice(0, State.state.chrCustActiveChoices.length);
		State.state.hideToast();
		State.state.isBusy--;
		return;
	}

	const parsed = JSON.parse(importString);

	const selectedChrModelID = State.state.chrCustModelSelection[0].id;

	// Get available option IDs
	const availableOptions = optionsByChrModel.get(selectedChrModelID);
	const availableOptionsIDs = Array<number>();
	for (const option of availableOptions)
		availableOptionsIDs.push(option.id as number);

	// Reset active choices.
	State.state.chrCustActiveChoices.splice(0, State.state.chrCustActiveChoices.length);

	const parsedChoices = Array<ChrCustomizationChoice>();
	for (const [key, customizationEntry] of Object.entries(parsed.customizations)) {
		if (!availableOptionsIDs.includes(customizationEntry.option.id as number))
			continue;

		parsedChoices.push({optionID: customizationEntry.option.id as number, choiceID: customizationEntry.choice.id as number});
	}
	State.state.chrCustActiveChoices.push(...parsedChoices);
	State.state.hideToast();
	State.state.isBusy--;
}