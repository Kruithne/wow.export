global.BUILD_RELEASE = false;

const core = require('./src/js/core');
core.view.$watch = () => { };
const path = require('path');
const ExportHelper = require('./src/js/casc/export-helper');
const RCPServer = require('./src/js/rcp/rcp-server');
const WMOExporter = require('./src/js/3D/exporters/WMOExporter');
const ADTExporter = require('./src/js/3D/exporters/ADTExporter');
const Config = require("./src/js/config")
const WDCReader = require('./src/js/db/WDCReader');
const CASCRemote = require('./src/js/casc/casc-source-remote');
const util = require('util');
const WDTLoader = require('./src/js/3D/loaders/WDTLoader');
const listfile = require('./src/js/casc/listfile');
const constants = require('./src/js/constants');

const TILE_SIZE = constants.GAME.TILE_SIZE;
const MAP_OFFSET = constants.GAME.MAP_OFFSET;

core.createProgress = (segments) => {
    return {
        segWeight: 1 / segments,
        value: 0,
        step: async function (text) {
            this.value++;
        }
    }
};

const parseMapEntry = (entry) => {
    const match = entry.match(/\[(\d+)\]\31([^\31]+)\31\(([^)]+)\)/);
    if (!match)
        throw new Error('Unexpected map entry');

    return { id: parseInt(match[1]), name: match[2], dir: match[3] };
};

const loadMap = async (mapID, mapDir) => {
    const mapDirLower = mapDir.toLowerCase();

    selectedMapID = mapID;
    selectedMapDir = mapDirLower;

    selectedWDT = null;
    core.view.mapViewerHasWorldModel = false;

    // Attempt to load the WDT for this map for chunk masking.
    const wdtPath = util.format('world/maps/%s/%s.wdt', mapDirLower, mapDirLower);


    try {
        const data = await core.view.casc.getFileByName(wdtPath);
        const wdt = selectedWDT = new WDTLoader(data);
        wdt.load();

        // Enable the 'Export Global WMO' button if available.
        if (wdt.worldModelPlacement)
            core.view.mapViewerHasWorldModel = true;

        core.view.mapViewerChunkMask = wdt.tiles;
    } catch (e) {
        // Unable to load WDT, default to all chunks enabled.
        core.view.mapViewerChunkMask = null;
    }

    // Reset the tile selection.
    core.view.mapViewerSelection.splice(0);

    // While not used directly by the components, we update this reactive value
    // so that the components know a new map has been selected, and to request tiles.
    core.view.mapViewerSelectedMap = mapID;

    // Purposely provide the raw mapDir here as it's used by the external link module
    // and wow.tools requires a properly cased map name.
    core.view.mapViewerSelectedDir = mapDir;

    return core.view.mapViewerChunkMask;
};

gameObjectsDB2 = null;

const collectGameObjects = async (mapID, filter) => {
    // Load GameObjects.db2/GameObjectDisplayInfo.db2 on-demand.
    if (gameObjectsDB2 === null) {
        const objTable = new WDCReader('DBFilesClient/GameObjects.db2');
        await objTable.parse();

        const idTable = new WDCReader('DBFilesClient/GameObjectDisplayInfo.db2');
        await idTable.parse();

        // Index all of the rows by the map ID.
        gameObjectsDB2 = new Map();
        for (const row of objTable.getAllRows().values()) {
            // Look-up the fileDataID ahead of time.
            const fidRow = idTable.getRow(row.DisplayID);
            if (fidRow !== null) {
                row.FileDataID = fidRow.FileDataID;

                let map = gameObjectsDB2.get(row.OwnerID);
                if (map === undefined) {
                    map = new Set();
                    map.add(row);
                    gameObjectsDB2.set(row.OwnerID, map);
                } else {
                    map.add(row);
                }
            }
        }
    }

    const result = new Set();
    const mapObjects = gameObjectsDB2.get(mapID);

    if (mapObjects !== undefined) {
        for (const obj of mapObjects) {
            if (filter !== undefined && filter(obj))
                result.add(obj);
        }
    }

    return result;
};

const exportMap = async (map) => {
    const tiles = await loadMap(map.id, map.dir);

    console.log(`export map ${map.dir} ${map.id}`);

    core.view.config.

    if (tiles) {
        
        const wowTests = 'C:\\Users\\Hrust\\OneDrive\\Рабочий стол\\wowTests';
        const exportPath = path.join(wowTests, 'maps', map.dir.toLowerCase());

        const exportTiles = tiles.map((t, i) => { return { t, i } }).filter(t => t.t == 1).map(t => t.i);
        const helper = new ExportHelper(exportTiles.length, 'tile');
        helper.start();

        for (var i = 0; i < exportTiles.length; i++) {
            var adt = new ADTExporter(map.id, map.dir, exportTiles[i]);

            const startX = MAP_OFFSET - (adt.tileX * TILE_SIZE) - TILE_SIZE;
            const startY = MAP_OFFSET - (adt.tileY * TILE_SIZE) - TILE_SIZE;
            const endX = startX + TILE_SIZE;
            const endY = startY + TILE_SIZE;

            const gameObjects = await collectGameObjects(selectedMapID, obj => {
                const [posX, posY] = obj.Pos;
                return posX > startX && posX < endX && posY > startY && posY < endY;
            });

            await adt.export(exportPath, 0, gameObjects, helper);
        }
    }
}

(async () => {

    core.rcp = new RCPServer();
    core.rcp.load();

    const casc = new CASCRemote('eu');
    await casc.init();
    casc.locale = core.view.availableLocale.flags.enUS;
    var products = casc.getProductList();
    Config.load();
    Config.resetAllToDefault();


    var buildIndex = 0;
    await casc.load(buildIndex);

    //Читаем файлы карт
    const table = new WDCReader('DBFilesClient/Map.db2');
    await table.parse();

    const maps = [];
    for (const [id, entry] of table.getAllRows()) {
        const wdtPath = util.format('world/maps/%s/%s.wdt', entry.Directory, entry.Directory);
        if (listfile.getByFilename(wdtPath))
            maps.push(util.format('%d\x19[%d]\x19%s\x19(%s)', entry.ExpansionID, id, entry.MapName_lang, entry.Directory));
    }

    core.view.mapViewerMaps = maps;


    var mapEntries = maps.map(parseMapEntry);

    await exportMap(mapEntries[0]);


})();


