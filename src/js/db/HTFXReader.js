const fsp = require('fs').promises;
const BufferWrapper = require('../buffer');
const log = require('../log');

/**
 * Reader for DBCache.bin (hotfix) files
 * @class HTFXReader
 */
class HTFXReader {
    /**
     * Construct a new HTFXReader instance.
     * @param {string} fileName
     */
    constructor(dbdManifest) {
        this.fileName = this.locateDBCache();
        this.tableHashMap = new Map();
        dbdManifest.forEach(item => this.tableHashMap.set(item.tableHash, item.tableName));
    }

    /**
     * Locate DBCache.bin for this product.
     */
    locateDBCache(){
        // TODO: Make work
        return "C:\\World of Warcraft\\_retail_\\Cache\\ADB\\enUS\\DBCache.bin";
    }

    /**
     * Parse the hotfix file.
     * @param {object} [data]
     */
    async parse(data) {
        if(!data)
            data = new BufferWrapper(await fsp.readFile(this.fileName));

        data.readUInt32LE(); // XFTH magic
        const version = data.readUInt32LE();

        if (version < 8 || version > 9)
            throw new Error('Unsupported DBCache.bin version: ' + version);

        // TODO: Verify if build is the same as currently loaded build (DBCache might be outdated)
        const build = data.readUInt32LE();
        
        data.readUInt32LE(8); // Verification hash (32 bytes)

        // Hotfix entries for the rest of the file
        while (data.remainingBytes){
            const entryMagic = data.readUInt32LE(); // XFTH 
            const regionID = data.readInt32LE();
            const pushID = data.readInt32LE();
            const uniqueID = data.readUInt32LE();

            const tableHash = data.readUInt32LE().toString(16).toUpperCase().padStart(8, '0');
           
            const recordID = data.readUInt32LE();
            const dataSize = data.readUInt32LE();
            const status = data.readUInt8();
            data.readUInt8(3); // Unused
            let recordData;

            if(dataSize)
                recordData = data.readUInt8(dataSize);

            if (!this.tableHashMap.has(tableHash))
                log.write("Found hotfix for UNKNOWN TABLE %s, ID %s, PushID %s, Status %s", tableHash, recordID, pushID, status);
        }
            
    }
}

module.exports = HTFXReader;