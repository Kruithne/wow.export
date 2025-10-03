/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../core');
const log = require('../log');
const util = require('util');
const path = require('path');
const listfile = require('../casc/listfile');
const BLPFile = require('../casc/blp');
const BufferWrapper = require('../buffer');
const ExportHelper = require('../casc/export-helper');
const EncryptionError = require('../casc/blte-reader').EncryptionError;
const JSONWriter = require('../3D/writers/JSONWriter');
const WDCReader = require('../db/WDCReader');
const textureExporter = require('./texture-exporter');

const textureAtlasEntries = new Map(); // atlasID => { width: number, height: number, regions: [] }
const textureAtlasRegions = new Map(); // regionID => { name: string, width: number, height: number, top: number, left: number }
const textureAtlasMap = new Map(); // fileDataID => atlasID

let hasLoadedAtlasTable = false;
let hasLoadedUnknownTextures = false;

let selectedFileDataID = 0;

/**
 * Preview a texture by the given fileDataID.
 * @param {number} fileDataID 
 * @param {string} [texture]
 */
const previewTextureByID = async (fileDataID, texture = null) => {
	texture = texture ?? listfile.getByID(fileDataID) ?? listfile.formatUnknownFile(fileDataID);

	core.view.isBusy++;
	core.setToast('progress', util.format('Loading %s, please wait...', texture), null, -1, false);
	log.write('Previewing texture file %s', texture);

	try {
		const view = core.view;
		const file = await core.view.casc.getFile(fileDataID);

		const blp = new BLPFile(file);

		view.texturePreviewURL = blp.getDataURL(view.config.exportChannelMask);
		view.texturePreviewWidth = blp.width;
		view.texturePreviewHeight = blp.height;

		let info = '';

		switch (blp.encoding) {
			case 1:
				info = 'Palette';
				break;
			case 2:
				info = 'Compressed ' + (blp.alphaDepth > 1 ? (blp.alphaEncoding === 7 ? 'DXT5' : 'DXT3') : 'DXT1');
				break;
			case 3:
				info = 'ARGB';
				break;
			default:
				info = 'Unsupported [' + blp.encoding + ']';
		}

		view.texturePreviewInfo = util.format('%s %d x %d (%s)', path.basename(texture), blp.width, blp.height, info);
		selectedFileDataID = fileDataID;

		updateTextureAtlasOverlay();

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

/**
 * Load texture atlas regions from data tables.
 * This function should only be called as part of the main texture tab loading screen.
 * @param {object} progress - Progress object for reporting steps
 */
const loadTextureAtlasData = async (progress) => {
	if (!hasLoadedAtlasTable && core.view.config.showTextureAtlas) {
		// load UiTextureAtlas which maps fileDataID to an atlas ID
		await progress.step('Loading texture atlases...');
		const uiTextureAtlasTable = new WDCReader('DBFilesClient/UiTextureAtlas.db2');
		await uiTextureAtlasTable.parse();

		// load UiTextureAtlasMember which contains individual atlas regions
		await progress.step('Loading texture atlas regions...');
		const uiTextureAtlasMemberTable = new WDCReader('DBFilesClient/UiTextureAtlasMember.db2');
		await uiTextureAtlasMemberTable.parse();

		await progress.step('Parsing texture atlases...');

		for (const [id, row] of uiTextureAtlasTable.getAllRows()) {
			textureAtlasMap.set(row.FileDataID, id);
			textureAtlasEntries.set(id, {
				width: row.AtlasWidth,
				height: row.AtlasHeight,
				regions: []
			});
		}

		let loadedRegions = 0;
		for (const [id, row] of uiTextureAtlasMemberTable.getAllRows()) {
			const entry = textureAtlasEntries.get(row.UiTextureAtlasID);
			if (!entry) {
				debugger;
				continue;
			}

			entry.regions.push(id);
			textureAtlasRegions.set(id, {
				name: row.CommittedName,
				width: row.Width,
				height: row.Height,
				left: row.CommittedLeft,
				top: row.CommittedTop
			});

			loadedRegions++;
		}

		log.write('Loaded %d texture atlases with %d regions', textureAtlasEntries.size, loadedRegions);
		hasLoadedAtlasTable = true;
	}
};

/**
 * Load texture atlas data after a settings change.
 */
const reloadTextureAtlasData = async () => {
	if (!hasLoadedAtlasTable && core.view.config.showTextureAtlas && !core.view.isBusy) {
		const progress = core.createProgress(3);
		core.view.setScreen('loading');
		core.view.isBusy++;
		
		try {
			await loadTextureAtlasData(progress);
			core.view.isBusy--;
			core.view.setScreen('tab-textures');
		} catch (error) {
			core.view.isBusy--;
			core.view.setScreen('tab-textures');
			log.write('Failed to load texture atlas data: %o', error);
			core.setToast('error', 'Failed to load texture atlas data. Check the log for details.');
		}
	}
};

const updateTextureAtlasOverlayScaling = () => {
	const overlay = document.getElementById('atlas-overlay');
	if (!overlay) return;

	const container = overlay.parentElement;

	const texture_width = core.view.textureAtlasOverlayWidth;
	const texture_height = core.view.textureAtlasOverlayHeight;

	const container_width = container.clientWidth;
	const render_width = Math.min(texture_width, container_width);

	const final_height = texture_height * (render_width / texture_width);
	
	overlay.style.width = render_width + 'px';
	overlay.style.height = final_height + 'px';
}

const attachOverlayListener = () => {
	const atlasOverlay = document.getElementById('atlas-overlay');
	if (!atlasOverlay || !atlasOverlay.parentElement)
		return;

	const observer = new ResizeObserver(updateTextureAtlasOverlayScaling);
	observer.observe(atlasOverlay.parentElement);

	const overlay = document.getElementById('atlas-overlay');
	if (overlay) {
		overlay.addEventListener('mousemove', (e) => {
			const region = e.target.closest('.atlas-region');
			if (region) {
				const rect = region.getBoundingClientRect();
				const x = e.clientX - rect.left;
				const y = e.clientY - rect.top;

				const isBottom = y > (rect.height / 2);
				const isRight = x > (rect.width / 2);

				region.classList.remove('tooltip-top-left', 'tooltip-top-right', 'tooltip-bottom-left', 'tooltip-bottom-right');

				if (isBottom && isRight)
					region.classList.add('tooltip-bottom-right');
				else if (isBottom && !isRight)
					region.classList.add('tooltip-bottom-left');
				else if (!isBottom && isRight)
					region.classList.add('tooltip-top-right');
				else
					region.classList.add('tooltip-top-left');
			}
		});
	}
};

/**
 * Update rendering of texture atlas overlays.
 */
const updateTextureAtlasOverlay = () => {
	const atlasID = textureAtlasMap.get(selectedFileDataID);
	const entry = textureAtlasEntries.get(atlasID);
	const renderRegions = [];

	if (entry) {
		core.view.textureAtlasOverlayWidth = entry.width;
		core.view.textureAtlasOverlayHeight = entry.height;

		for (const id of entry.regions) {
			const region = textureAtlasRegions.get(id);
			renderRegions.push({
				id,
				name: region.name,
				width: ((region.width / entry.width) * 100) + '%',
				height: ((region.height / entry.height) * 100) + '%',
				top: ((region.top / entry.height) * 100) + '%',
				left: ((region.left / entry.width) * 100) + '%',
			});
		}

		updateTextureAtlasOverlayScaling();
	}

	core.view.textureAtlasOverlayRegions = renderRegions;
};


const exportTextureAtlasRegions = async (fileDataID) => {
	const atlasID = textureAtlasMap.get(fileDataID);
	const atlas = textureAtlasEntries.get(atlasID);

	const fileName = listfile.getByID(fileDataID);
	const exportDir = ExportHelper.replaceExtension(fileName);

	const helper = new ExportHelper(atlas.regions.length, 'texture');
	helper.start();
	
	let exportFileName = fileName;

	try {
		const data = await core.view.casc.getFile(fileDataID);
		const blp = new BLPFile(data);
		
		const canvas = blp.toCanvas();
		const ctx = canvas.getContext('2d');
		
		for (const regionID of atlas.regions) {
			if (helper.isCancelled())
				return;
			
			const region = textureAtlasRegions.get(regionID);

			exportFileName = path.join(exportDir, region.name);
			const exportPath = ExportHelper.getExportPath(exportFileName + '.png');
	
			const crop = ctx.getImageData(region.left, region.top, region.width, region.height);
	
			const saveCanvas = document.createElement('canvas');
			saveCanvas.width = region.width;
			saveCanvas.height = region.height;
	
			const saveCtx = saveCanvas.getContext('2d');
			saveCtx.putImageData(crop, 0, 0);
	
			const buf = await BufferWrapper.fromCanvas(saveCanvas, 'image/png');
			await buf.writeToFile(exportPath);
	
			helper.mark(exportFileName, true);
		}
	} catch (e) {
		helper.mark(exportFileName, false, e.message, e.stack);
	}

	helper.finish();
};


// Register a drop handler for BLP files.
core.registerDropHandler({
	ext: ['.blp'],
	prompt: count => util.format('Export %d textures as %s', count, core.view.config.exportTextureFormat),
	process: files => textureExporter.exportFiles(files, true)
});

core.registerLoadFunc(async () => {
	// Track changes to exportTextureAlpha. If it changes, re-render the
	// currently displayed texture to ensure we match desired alpha.
	core.view.$watch('config.exportTextureAlpha', () => {
		if (!core.view.isBusy && selectedFileDataID > 0)
			previewTextureByID(selectedFileDataID);
	});

	// Track selection changes on the texture listbox and preview first texture.
	core.view.$watch('selectionTextures', async selection => {
		// Check if the first file in the selection is "new".
		const first = listfile.stripFileEntry(selection[0]);
		if (first && !core.view.isBusy) {
			const fileDataID = listfile.getByFilename(first);
			if (selectedFileDataID !== fileDataID)
				previewTextureByID(fileDataID);
		}
	});

	// Track when the user clicks to export selected textures.
	core.events.on('click-export-texture', async () => {
		const userSelection = core.view.selectionTextures;
		if (userSelection.length > 0) {
			// In most scenarios, we have a user selection to export.
			await textureExporter.exportFiles(userSelection);
		} else if (selectedFileDataID > 0) {
			// Less common, but we might have a direct preview that isn't selected.
			await textureExporter.exportFiles([selectedFileDataID]); 
		} else {
			// Nothing to be exported, show the user an error.
			core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
		}
	});

	// Track when the user changes the colour channel mask.
	core.view.$watch('config.exportChannelMask', () => {
		if (!core.view.isBusy && selectedFileDataID > 0)
			previewTextureByID(selectedFileDataID);
	});

	// Track when the "Textures" tab is opened.
	core.events.on('screen-tab-textures', async () => {
		const needsUnknownTextures = core.view.config.enableUnknownFiles && !hasLoadedUnknownTextures;
		const needsAtlasData = !hasLoadedAtlasTable && core.view.config.showTextureAtlas;
		
		if ((needsUnknownTextures || needsAtlasData) && !core.view.isBusy) {
			let stepCount = 0;
			if (needsUnknownTextures)
				stepCount += 2; // texture file data + unknown textures

			if (needsAtlasData)
				stepCount += 3; // atlas + regions + parsing
			
			const progress = core.createProgress(stepCount);
			core.view.setScreen('loading');
			core.view.isBusy++;
			
			try {
				if (needsUnknownTextures) {
					await progress.step('Loading texture file data...');
					await progress.step('Loading unknown textures...');
					await listfile.loadUnknownTextures();
					hasLoadedUnknownTextures = true;
				}
				
				if (needsAtlasData)
					await loadTextureAtlasData(progress);
				
				core.view.isBusy--;
				core.view.setScreen('tab-textures');
				
			} catch (error) {
				core.view.isBusy--;
				core.view.setScreen('tab-textures');
				log.write('Failed to initialize textures tab: %o', error);
				core.setToast('error', 'Failed to load texture data. Check the log for details.');
			}
		}
		
		attachOverlayListener();
	});

	// Track when the user clicks to export a texture atlas region.
	core.events.on('click-export-texture-atlas-region', () => {
		exportTextureAtlasRegions(selectedFileDataID);
	});

	// Track when user toggles the "Show Atlas Regions" checkbox.
	core.view.$watch('config.showTextureAtlas', async () => {
		await reloadTextureAtlasData();
		updateTextureAtlasOverlay();
	});
});

module.exports = { previewTextureByID, exportTextureAtlasRegions };