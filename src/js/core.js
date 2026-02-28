import EventEmitter from './event-emitter.js';
import { redraw } from './generics.js';
import Locale from './casc/locale-flags.js';
import constants from './constants.js';
import * as platform from './platform.js';
import FileWriter from './file-writer.js';
import { exporter } from '../views/main/rpc.js';

let toast_timer = -1;

const events = new EventEmitter();
events.setMaxListeners(666);

const drop_handlers = [];
const scroll_positions = {};

const makeNewView = () => {
	return {
		installType: 0,
		isBusy: 0,
		isDev: typeof BUILD_RELEASE === 'undefined' || BUILD_RELEASE !== 'true',
		isLoading: false,
		loadingProgress: '',
		loadingTitle: '',
		loadPct: -1,
		toast: null,
		cdnRegions: [],
		selectedCDNRegion: null,
		lockCDNRegion: false,
		config: {},
		configEdit: {},
		constants: constants,
		availableLocalBuilds: null,
		availableRemoteBuilds: null,
		sourceSelectShowBuildSelect: false,
		casc: null,
		cacheSize: 0,
		userInputTactKey: '',
		userInputTactKeyName: '',
		userInputFilterTextures: '',
		userInputFilterSounds: '',
		userInputFilterVideos: '',
		userInputFilterText: '',
		userInputFilterFonts: '',
		userInputFilterModels: '',
		userInputFilterMaps: '',
		userInputFilterZones: '',
		userInputFilterItems: '',
		userInputFilterItemSets: '',
		userInputFilterDB2s: '',
		userInputFilterDataTable: '',
		userInputFilterRaw: '',
		userInputFilterLegacyModels: '',
		userInputFilterDecor: '',
		userInputFilterCreatures: '',
		activeModule: null,
		modNavButtons: [],
		modContextMenuOptions: [],
		userInputFilterInstall: '',
		modelQuickFilters: ['m2', 'm3', 'wmo'],
		legacyModelQuickFilters: ['m2', 'mdx', 'wmo'],
		audioQuickFilters: ['ogg', 'mp3', 'unk'],
		textQuickFilters: ['lua', 'xml', 'txt', 'sbt', 'wtf', 'htm', 'toc', 'xsd', 'srt'],
		selectionTextures: [],
		selectionModels: [],
		selectionSounds: [],
		selectionVideos: [],
		selectionText: [],
		selectionFonts: [],
		selectionMaps: [],
		selectionZones: [],
		selectionItems: [],
		selectionItemSets: [],
		selectionDB2s: [],
		selectionDataTable: [],
		selectionRaw: [],
		selectionInstall: [],
		selectionLegacyModels: [],
		selectionDecor: [],
		selectionCreatures: [],
		installStringsView: false,
		installStrings: [],
		installStringsFileName: '',
		selectionInstallStrings: [],
		userInputFilterInstallStrings: '',
		listfileTextures: [],
		listfileSounds: [],
		listfileVideos: [],
		listfileText: [],
		listfileFonts: [],
		listfileModels: [],
		listfileItems: [],
		listfileItemSets: [],
		itemViewerTypeMask: [],
		itemViewerQualityMask: [],
		listfileRaw: [],
		listfileInstall: [],
		listfileLegacyModels: [],
		listfileDecor: [],
		listfileCreatures: [],
		decorCategoryMask: [],
		decorCategoryGroups: [],
		dbdManifest: [],
		installTags: [],
		tableBrowserHeaders: [],
		tableBrowserRows: [],
		availableLocale: Locale,
		fileDropPrompt: null,
		whatsNewHTML: '',
		textViewerSelectedText: '',
		fontPreviewPlaceholder: '',
		fontPreviewText: '',
		fontPreviewFontFamily: '',
		soundPlayerSeek: 0,
		soundPlayerState: false,
		soundPlayerTitle: 'No File Selected',
		soundPlayerDuration: 0,
		videoPlayerState: false,
		modelViewerContext: null,
		modelViewerActiveType: 'none',
		modelViewerGeosets: [],
		modelViewerSkins: [],
		modelViewerSkinsSelection: [],
		modelViewerAnims: [],
		modelViewerAnimSelection: null,
		modelViewerAnimPaused: false,
		modelViewerAnimFrame: 0,
		modelViewerAnimFrameCount: 0,
		modelViewerWMOGroups: [],
		modelViewerWMOSets: [],
		modelViewerAutoAdjust: true,
		legacyModelViewerContext: null,
		legacyModelViewerActiveType: 'none',
		legacyModelViewerAnims: [],
		legacyModelViewerAnimSelection: null,
		legacyModelViewerAnimPaused: false,
		legacyModelViewerAnimFrame: 0,
		legacyModelViewerAnimFrameCount: 0,
		legacyModelViewerAutoAdjust: true,
		creatureViewerContext: null,
		creatureViewerActiveType: 'none',
		creatureViewerGeosets: [],
		creatureViewerSkins: [],
		creatureViewerSkinsSelection: [],
		creatureViewerWMOGroups: [],
		creatureViewerWMOSets: [],
		creatureViewerAutoAdjust: true,
		creatureViewerAnims: [],
		creatureViewerAnimSelection: null,
		creatureViewerAnimPaused: false,
		creatureViewerAnimFrame: 0,
		creatureViewerAnimFrameCount: 0,
		creatureViewerEquipment: [],
		creatureViewerUVLayers: [],
		creatureTexturePreviewURL: '',
		creatureTexturePreviewUVOverlay: '',
		creatureTexturePreviewWidth: 256,
		creatureTexturePreviewHeight: 256,
		creatureTexturePreviewName: '',
		decorViewerContext: null,
		decorViewerActiveType: 'none',
		decorViewerGeosets: [],
		decorViewerWMOGroups: [],
		decorViewerWMOSets: [],
		decorViewerAutoAdjust: true,
		decorViewerAnims: [],
		decorViewerAnimSelection: null,
		decorViewerAnimPaused: false,
		decorViewerAnimFrame: 0,
		decorViewerAnimFrameCount: 0,
		decorViewerUVLayers: [],
		decorTexturePreviewURL: '',
		decorTexturePreviewUVOverlay: '',
		decorTexturePreviewWidth: 256,
		decorTexturePreviewHeight: 256,
		decorTexturePreviewName: '',
		legacyModelViewerSkins: [],
		legacyModelViewerSkinsSelection: [],
		legacyModelTexturePreviewURL: '',
		modelViewerRotationSpeed: 0,
		textureRibbonStack: [],
		textureRibbonSlotCount: 0,
		textureRibbonPage: 0,
		textureAtlasOverlayRegions: [],
		textureAtlasOverlayWidth: 0,
		textureAtlasOverlayHeight: 0,
		modelTexturePreviewWidth: 256,
		modelTexturePreviewHeight: 256,
		modelTexturePreviewURL: '',
		modelTexturePreviewName: '',
		modelTexturePreviewUVOverlay: '',
		modelViewerUVLayers: [],
		texturePreviewWidth: 256,
		texturePreviewHeight: 256,
		texturePreviewURL: '',
		texturePreviewInfo: '',
		overrideModelList: [],
		overrideModelName: '',
		overrideTextureList: [],
		overrideTextureName: '',
		mapViewerMaps: [],
		zoneViewerZones: [],
		zonePhases: [],
		zonePhaseSelection: null,
		selectedZoneExpansionFilter: -1,
		mapViewerHasWorldModel: false,
		mapViewerIsWMOMinimap: false,
		mapViewerTileLoader: null,
		mapViewerSelectedMap: null,
		mapViewerSelectedDir: null,
		mapViewerChunkMask: null,
		mapViewerGridSize: null,
		mapViewerSelection: [],
		selectedExpansionFilter: -1,
		chrModelViewerContext: null,
		chrModelViewerAnims: [],
		chrModelViewerAnimSelection: null,
		chrModelViewerAnimPaused: false,
		chrModelViewerAnimFrame: 0,
		chrModelViewerAnimFrameCount: 0,
		chrCustRaces: [],
		chrCustRaceSelection: [],
		chrCustModels: [],
		chrCustModelSelection: [],
		chrCustOptions: [],
		chrCustOptionSelection: [],
		chrCustChoices: [],
		chrCustChoiceSelection: [],
		chrCustActiveChoices: [],
		chrCustGeosets: [],
		chrCustTab: 'models',
		chrCustRightTab: 'geosets',
		chrModelLoading: false,
		chrShowGeosetControl: false,
		chrExportMenu: 'export',
		colorPickerOpenFor: null,
		colorPickerPosition: { x: 0, y: 0 },
		chrImportChrName: '',
		chrImportRegions: [],
		chrImportSelectedRegion: '',
		chrImportRealms: [],
		chrImportSelectedRealm: null,
		chrImportLoadVisage: false,
		chrImportClassicRealms: false,
		chrImportChrModelID: 0,
		chrImportTargetModelID: 0,
		chrImportChoices: [],
		chrImportWowheadURL: '',
		characterImportMode: 'none',
		chrEquippedItems: {},
		chrGuildTabardConfig: { background: 0, border_style: 0, border_color: 0, emblem_design: 0, emblem_color: 0 },
		chrEquipmentSlotContext: null,
		chrSavedCharactersScreen: false,
		chrSavedCharacters: [],
		chrSaveCharacterPrompt: false,
		chrSaveCharacterName: '',
		chrPendingThumbnail: null,
		realmList: {},
		exportCancelled: false,
		isXmas: (new Date().getMonth() === 11),
		chrCustBakedNPCTexture: null,
		regexTooltip: '.* - Matches anything\n(a|b) - Matches either a or b.\n[a-f] - Matches characters between a-f.\n[^a-d] - Matches characters that are not between a-d.\n\\s - Matches whitespace characters.\n\\d - Matches any digit.\na? - Matches zero or one of a.\na* - Matches zero or more of a.\na+ - Matches one or more of a.\na{3} - Matches exactly 3 of a.',
		contextMenus: {
			nodeTextureRibbon: null,
			nodeItem: null,
			nodeDataTable: null,
			nodeListbox: null,
			nodeMap: null,
			nodeZone: null,
			stateNavExtra: false,
			stateModelExport: false,
			stateCDNRegion: false,
		},
		menuButtonTextures: [
			{ label: 'Export as PNG', value: 'PNG' },
			{ label: 'Export as WebP', value: 'WEBP' },
			{ label: 'Export as BLP (Raw)', value: 'BLP' },
			{ label: 'Copy to Clipboard', value: 'CLIPBOARD' }
		],
		menuButtonMapExport: [
			{ label: 'Export OBJ', value: 'OBJ' },
			{ label: 'Export PNG', value: 'PNG' },
			{ label: 'Export Raw', value: 'RAW' },
			{ label: 'Export Heightmaps', value: 'HEIGHTMAPS' }
		],
		menuButtonTextureQuality: [
			{ label: 'Alpha Maps', value: -1 },
			{ label: 'None', value: 0 },
			{ label: 'Minimap (512)', value: 512 },
			{ label: 'Low (1k)', value: 1024 },
			{ label: 'Medium (4k)', value: 4096 },
			{ label: 'High (8k)', value: 8192 },
			{ label: 'Ultra (16k)', value: 16384 }
		],
		menuButtonHeightmapResolution: [
			{ label: '64x64', value: 64 },
			{ label: '128x128', value: 128 },
			{ label: '512x512', value: 512 },
			{ label: '1024x1024 (1k)', value: 1024 },
			{ label: '2048x2048 (2k)', value: 2048 },
			{ label: '4096x4096 (4k)', value: 4096 },
			{ label: 'Custom', value: -1 }
		],
		menuButtonHeightmapBitDepth: [
			{ label: '8-bit Depth', value: 8 },
			{ label: '16-bit Depth', value: 16 },
			{ label: '32-bit Depth', value: 32 }
		],
		menuButtonModels: [
			{ label: 'Export OBJ', value: 'OBJ' },
			{ label: 'Export STL', value: 'STL' },
			{ label: 'Export glTF', value: 'GLTF' },
			{ label: 'Export GLB', value: 'GLB' },
			{ label: 'Export M2 / WMO (Raw)', value: 'RAW' },
			{ label: 'Export PNG (3D Preview)', value: 'PNG' },
			{ label: 'Copy to Clipboard (3D Preview)', value: 'CLIPBOARD' },
		],
		menuButtonLegacyModels: [
			{ label: 'Export OBJ', value: 'OBJ' },
			{ label: 'Export STL', value: 'STL' },
			{ label: 'Export Raw', value: 'RAW' },
			{ label: 'Export PNG (3D Preview)', value: 'PNG' },
			{ label: 'Copy to Clipboard (3D Preview)', value: 'CLIPBOARD' },
		],
		menuButtonDecor: [
			{ label: 'Export OBJ', value: 'OBJ' },
			{ label: 'Export STL', value: 'STL' },
			{ label: 'Export glTF', value: 'GLTF' },
			{ label: 'Export GLB', value: 'GLB' },
			{ label: 'Export M2 / WMO (Raw)', value: 'RAW' },
			{ label: 'Export PNG (3D Preview)', value: 'PNG' },
			{ label: 'Copy to Clipboard (3D Preview)', value: 'CLIPBOARD' },
		],
		menuButtonCreatures: [
			{ label: 'Export OBJ', value: 'OBJ' },
			{ label: 'Export STL', value: 'STL' },
			{ label: 'Export glTF', value: 'GLTF' },
			{ label: 'Export GLB', value: 'GLB' },
			{ label: 'Export M2 / WMO (Raw)', value: 'RAW' },
			{ label: 'Export PNG (3D Preview)', value: 'PNG' },
			{ label: 'Copy to Clipboard (3D Preview)', value: 'CLIPBOARD' },
		],
		menuButtonCharacterExport: [
			{ label: 'Export glTF', value: 'GLTF' },
			{ label: 'Export GLB', value: 'GLB' },
			{ label: 'Export OBJ (Posed)', value: 'OBJ' },
			{ label: 'Export STL (Posed)', value: 'STL' },
			{ label: 'Export PNG (3D Preview)', value: 'PNG' },
			{ label: 'Copy to Clipboard (3D Preview)', value: 'CLIPBOARD' },
		],
		menuButtonVideos: [
			{ label: 'Export MP4 (Video + Audio)', value: 'MP4' },
			{ label: 'Export AVI (Video Only)', value: 'AVI' },
			{ label: 'Export MP3 (Audio Only)', value: 'MP3' },
			{ label: 'Export Subtitles', value: 'SUBTITLES' }
		],
		menuButtonData: [
			{ label: 'Export as CSV', value: 'CSV' },
			{ label: 'Export as SQL', value: 'SQL' },
			{ label: 'Export DB2 (Raw)', value: 'DB2' }
		],
		helpArticles: [],
		helpFilteredArticles: [],
		helpSelectedArticle: null,
		helpSearchQuery: ''
	};
};

let view = null;

const create_busy_lock = () => {
	core.view.isBusy++;
	return { [Symbol.dispose]: () => core.view.isBusy-- };
};

let loading_progress_segments = 1;
let loading_progress_value = 0;

const showLoadingScreen = (segments = 1, title = 'Loading, please wait...') => {
	loading_progress_segments = segments;
	loading_progress_value = 0;
	core.view.loadPct = 0;
	core.view.loadingTitle = title;

	if (!core.view.isLoading) {
		core.view.isLoading = true;
		core.view.isBusy++;
	}
};

const progressLoadingScreen = async (text) => {
	loading_progress_value++;
	core.view.loadPct = Math.min(loading_progress_value / loading_progress_segments, 1);

	if (text)
		core.view.loadingProgress = text;

	await redraw();
};

const hideLoadingScreen = () => {
	core.view.loadPct = -1;
	core.view.isLoading = false;
	core.view.isBusy--;
};

const hideToast = (user_cancel = false) => {
	if (toast_timer > -1) {
		clearTimeout(toast_timer);
		toast_timer = -1;
	}

	core.view.toast = null;

	if (user_cancel) {
		exporter.export_cancel();
		events.emit('toast-cancelled');
	}
};

const setToast = (toast_type, message, options = null, ttl = 10000, closable = true) => {
	core.view.toast = { type: toast_type, message, options, closable };
	clearTimeout(toast_timer);

	if (ttl > -1)
		toast_timer = setTimeout(hideToast, ttl);
};

const openExportDirectory = () => {
	platform.open_path(core.view.config.exportDirectory);
};

const registerDropHandler = (handler) => {
	handler.ext = handler.ext.map(e => e.toLowerCase());
	drop_handlers.push(handler);
};

const getDropHandler = (file) => {
	file = file.toLowerCase();

	for (const handler of drop_handlers) {
		for (const ext of handler.ext) {
			if (file.endsWith(ext))
				return handler;
		}
	}

	return null;
};

const saveScrollPosition = (key, scroll_rel, scroll_index) => {
	if (!key)
		return;

	scroll_positions[key] = {
		scrollRel: scroll_rel || 0,
		scrollIndex: scroll_index || 0,
		timestamp: Date.now()
	};
};

const getScrollPosition = (key) => {
	if (!key || !scroll_positions[key])
		return null;

	return scroll_positions[key];
};

const openLastExportStream = () => {
	return new FileWriter(constants.LAST_EXPORT);
};

const core = {
	events,
	view,
	makeNewView,
	create_busy_lock,
	showLoadingScreen,
	progressLoadingScreen,
	hideLoadingScreen,
	setToast,
	hideToast,
	openExportDirectory,
	openLastExportStream,
	registerDropHandler,
	getDropHandler,
	saveScrollPosition,
	getScrollPosition
};

export default core;
