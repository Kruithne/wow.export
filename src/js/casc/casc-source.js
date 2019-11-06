const BufferWrapper = require('../buffer');

const EMPTY_HASH = '00000000000000000000000000000000';

class CASC {
    /**
     * Parse entries from an archive index.
     * @param {BufferWrapper} data 
     * @returns {Array}
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
            const hash = data.readString(16, 'hex');

            // Skip zero hashes.
            if (hash === EMPTY_HASH)
                hash = data.readString(16, 'hex');

            entries[i] = {
                hash,
                size: data.readInt32(BufferWrapper.ENDIAN_BIG),
                offset: data.readInt32(BufferWrapper.ENDIAN_BIG)
            };
        }

        return entries;
    }
}

module.exports = CASC;