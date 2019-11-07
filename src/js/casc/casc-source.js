const BufferWrapper = require('../buffer');
const BLTEReader = require('./blte-reader');

const EMPTY_HASH = '00000000000000000000000000000000';
const ENC_CHUNK_SIZE = 4096;
const ENC_MAGIC = 0x4E45;

class CASC {
    /**
     * Parse entries from an archive index.
     * @param {BufferWrapper} data 
     * @returns {object[]}
     */
    parseIndexFile(data) {
        // Skip to the end of the archive to find the count.
        data.seek(-12);
        const count = data.readInt32();

        if (count * 24 > data.byteLength)
            throw new Error('Unable to parse archive, unexpected size: ' + data.byteLength);

        data.seek(0); // Reset position.
        const entries = new Array(count);

        for (let i = 0; i < count; i++) {
            let hash = data.readString(16, 'hex');

            // Skip zero hashes.
            if (hash === EMPTY_HASH)
                hash = data.readString(16, 'hex');

            entries[i] = {
                hash,
                size: data.readInt32(1, BufferWrapper.ENDIAN_BIG),
                offset: data.readInt32(1, BufferWrapper.ENDIAN_BIG)
            };
        }

        return entries;
    }
    
    /**
     * Parse entries from an encoding file.
     * @param {BufferWrapper} data 
     * @param {string} hash 
     * @returns {object}
     */
    async parseEncodingFile(data, hash) {
        const entries = {};
        const encoding = new BLTEReader(data, hash);

        const magic = encoding.readUInt16();
        if (magic !== ENC_MAGIC)
            throw new Error('Invalid encoding magic: ' + magic);

        encoding.setEndian(BufferWrapper.ENDIAN_BIG);

        const version = encoding.readUInt8();
        const hashSizeCKey = encoding.readUInt8();
        const hashSizeEKey = encoding.readUInt8();
        const cKeyPageSize = encoding.readInt16() * 1024;
        const eKeyPageSize = encoding.readInt16() * 1024;
        const cKeyPageCount = encoding.readInt32();
        const eKeyPageCount = encoding.readInt32();
        const unk11 = encoding.readUInt8(); // 0
        const specBlockSize = encoding.readInt32();

        encoding.move(specBlockSize);
        encoding.move(cKeyPageCount * (hashSizeCKey + 16));

        const pagesStart = encoding.offset;
        for (let i = 0; i < cKeyPageCount; i++) {
            const pageStart = pagesStart + (cKeyPageSize * i);
            encoding.seek(pageStart);

            while (encoding.offset < (pageStart + pagesStart)) {
                const keysCount = encoding.readUInt8();
                if (keysCount === 0)
                    break;

                const size = encoding.readInt40();
                const cKey = encoding.readString(hashSizeCKey, 'hex');
                const entry = { size };
                for (let k = 0; k < keysCount; k++) {
                    const eKey = encoding.readString(hashSizeEKey, 'hex');
                    if (k === 0)
                        entry.key = eKey;
                }

                entries[cKey] = entry;
            }
        }

        return entries;
    }
}

module.exports = CASC;