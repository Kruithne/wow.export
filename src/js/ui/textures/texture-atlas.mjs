import { inject, ref } from 'vue';

const path = require('path');
const log = require('/js/log');
const WDCReader = require('/js/db/WDCReader');
const listfile = require('/js/casc/listfile');
const ExportHelper = require('/js/casc/export-helper');
const BLPFile = require('/js/casc/blp');
const BufferWrapper = require('/js/buffer');

let state = null;

export default function () {
	if (state != null)
		return state;

	const core = inject('core');
	const app = inject('app');

	const textureAtlasEntries = new Map(); // atlasID => { width: number, height: number, regions: [] }
	const textureAtlasRegions = new Map(); // regionID => { name: string, width: number, height: number, top: number, left: number }
	const textureAtlasMap = new Map(); // fileDataID => atlasID
	const overlayWidth = ref(0); // Width of the texture atlas overlay.
	const overlayHeight = ref(0); // Height of the texture atlas overlay.
	const overlayRegions = ref([]); // Texture atlas render regions.

	let isLoaded = false;

	const load = async() => {
		if (isLoaded) 
			return;

		// show a loading screen
		const progress = core.createProgress(3);
		app.setScreen('loading');
		app.isBusy++;

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
			if (!entry)
				continue;


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

		// hide the loading screen
		app.loadPct = -1;
		app.isBusy--;
		app.setScreen('tab-textures');

		isLoaded = true;
	};

	/**
	 * Update rendering of texture atlas overlays.
	 */
	const updateOverlay = (selectedFileDataID) => {
		const atlasID = textureAtlasMap.get(selectedFileDataID);
		const entry = textureAtlasEntries.get(atlasID);
		const renderRegions = [];

		if (entry) {
			overlayWidth.value = entry.width;
			overlayHeight.value = entry.height;

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
		}

		overlayRegions.value = renderRegions;

		return !!entry;
	};

	const exportRegions = async (fileDataID) => {
		const atlasID = textureAtlasMap.get(fileDataID);
		const atlas = textureAtlasEntries.get(atlasID);

		const fileName = listfile.getByID(fileDataID);
		const exportDir = ExportHelper.replaceExtension(fileName);

		const helper = new ExportHelper(atlas.regions.length, 'texture');
		helper.start();

		let exportFileName = fileName;

		try {
			const data = await app.casc.getFile(fileDataID);
			const blp = new BLPFile(data);

			const canvas = blp.toCanvas();
			const ctx = canvas.getContext('2d');

			for (const regionID of atlas.regions) {
				if (helper.isCancelled())
					return;

				const region = overlayRegions.value.get(regionID);

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

	state = {
		overlayWidth,
		overlayHeight,
		overlayRegions,
		load,
		updateOverlay,
		exportRegions,
	};

	return state;
}

