const util = require('util');
const BufferWrapper = require('../buffer');
const Salsa20 = require('./salsa20');

const BLTE_MAGIC = 0x45544c42;
const ENC_TYPE_SALSA20 = 0x53;
const ENC_TYPE_ARC4 = 0x41;
const EMPTY_HASH = '00000000000000000000000000000000';
const KEY_RING = {};

class BLTEReader extends BufferWrapper {
    /**
     * Construct a new BLTEReader instance.
     * @param {BufferWrapper} buf 
     * @param {string} hash 
     */
    constructor(buf, hash) {
        super(null);

        this._blte = buf;
        this.blockIndex = 0;
        this.blockWriteIndex = 0;

        const size = buf.byteLength;
        if (size < 8)
            throw new Error('[BLTE] Not enough data (< 8)');

        const magic = buf.readUInt32LE();
        if (magic !== BLTE_MAGIC)
            throw new Error('[BLTE] Invalid magic: ' + magic);

        const headerSize = buf.readInt32BE();
        const origPos = buf.offset;

        buf.seek(0);

        let hashCheck = headerSize > 0 ? buf.readBuffer(headerSize).calculateHash() : buf.calculateHash();
        if (hashCheck !== hash)
            throw new Error(util.format('[BLTE] Invalid MD5 hash, expected %s got %s', hash, hashCheck));

        buf.seek(origPos);
        let numBlocks = 1;

        if (headerSize > 0) {
            if (size < 12)
                throw new Error('[BLTE] Not enough data (< 12)');

            const fc = buf.readUInt8(4);
            numBlocks = fc[1] << 16 | fc[2] << 8 | fc[3] << 0;

            if (fc[0] !== 0x0F || numBlocks === 0)
                throw new Error('[BLTE] Invalid table format.');

            const frameHeaderSize = 24 * numBlocks + 12;
            if (headerSize !== frameHeaderSize)
                throw new Error('[BLTE] Invalid header size.');

            if (size < frameHeaderSize)
                throw new Error('[BLTE] Not enough data (frameHeader).');
        }

        this.blocks = new Array(numBlocks);
        let allocSize = 0;

        for (let i = 0; i < numBlocks; i++) {
            const block = {};
            if (headerSize !== 0) {
                block.CompSize = buf.readInt32BE();
                block.DecompSize = buf.readInt32BE();
                block.Hash = buf.readHexString(16);
            } else {
                block.CompSize = size - 8;
                block.DecompSize = size - 9;
                block.Hash = EMPTY_HASH;
            }

            allocSize += block.DecompSize;
            this.blocks[i] = block;
        }

        this._buf = Buffer.alloc(allocSize);
    }

    /**
     * Process all BLTE blocks in the reader.
     */
    processAllBlocks() {
        while (this.blockIndex < this.blocks.length)
            this._processBlock();
    }

    /**
     * Process the next BLTE block.
     */
    _processBlock() {
        // No more blocks to process.
        if (this.blockIndex === this.blocks.length)
            return false;

        const oldPos = this.offset;
        this.seek(this.blockWriteIndex);

        const block = this.blocks[this.blockIndex];
        block.Data = this._blte.readBuffer(block.CompSize);

        if (!block.Hash === EMPTY_HASH) {
            const blockHash = block.Data.calculateHash();
            block.Data.seek(0);

            if (blockHash !== block.Hash)
                throw new Error(util.format('[BLTE] Invalid block data hash. Expected %s, got %s!', block.Hash, blockHash));
        }

        this._handleBlock(block.Data, this.blockIndex);
        this.blockIndex++;
        this.blockWriteIndex = this.offset;

        this.seek(oldPos);
    }

    /**
     * Handle a BLTE block.
     * @param {BufferWrapper} data
     * @param {number} index 
     */
    _handleBlock(data, index) {
        const flag = data.readUInt8();
        switch (flag) {
            case 0x45: // Encrypted
                const decrypted = this._decryptBlock(data, index);
                this._handleBlock(decrypted, index);
                break;
            
            case 0x46: // Frame (Recursive)
                throw new Error('[BLTE] No frame decoder implemented!');

            case 0x4E: // Frame (Normal)
                this._writeBufferBLTE(data);
                break;

            case 0x5A: // Compressed
                this._decompressBlock(data, index);
                break;
        }
    }

    /**
     * Decompress BLTE block.
     * @param {BufferWrapper} data 
     * @param {number} index 
     */
    _decompressBlock(data, index) {
        const decomp = data.readBuffer(null, true, true);
        const expectedSize = this.blocks[index].DecompSize;

        // Reallocate buffer to compensate.
        if (decomp.byteLength > expectedSize)
            this.setCapacity(this.byteLength + (decomp.byteLength - expectedSize));

        this._writeBufferBLTE(decomp);
    }

    /**
     * Decrypt BLTE block.
     * @param {BufferWrapper} data 
     * @param {number} index 
     */
    _decryptBlock(data, index) {
        const keyNameSize = data.readUInt8();
        if (keyNameSize === 0 || keyNameSize !== 8)
            throw new Error('[BLTE] Unexpected keyNameSize: ' + keyNameSize);

        const keyNameBytes = data.readHexString(keyNameSize);
        const ivSize = data.readUInt8();

        if (ivSize !== 4)
            throw new Error('[BLTE] Unexpected ivSize: ' + ivSize);

        const ivShort = data.readUInt8(ivSize);
        if (data.remainingBytes === 0)
            throw new Error('[BLTE] Unexpected end of data before encryption flag.');

        const encryptType = data.readUInt8();
        if (encryptType !== ENC_TYPE_SALSA20 && encryptType !== ENC_TYPE_ARC4)
            throw new Error('[BLTE] Unexpected encryption type: ' + encryptType);

        for (let shift = 0, i = 0; i < 4; shift += 8, i++)
            ivShort[i] ^= (index >> shift) & 0xFF;

        const key = KEY_RING[keyNameBytes];
        if (key === undefined)
            throw new Error('[BLTE] Unknown decryption key: ' + keyNameBytes);

        // ToDo: Support Arc4 decryption.
        if (encryptType === ENC_TYPE_ARC4)
            throw new Error('[BLTE] Arc4 decryption not implemented.');

        const nonce = [];
        for (let i = 0; i < 8; i++)
            nonce[i] = (i < ivShort.length ? ivShort[i] : 0x0);

        const instance = new Salsa20(nonce, key);
        return instance.process(data.readBuffer());
    }

    /**
     * Write the contents of a buffer to this instance.
     * Skips bound checking for BLTE internal writing.
     * @param {BufferWrapper} buf 
     */
    _writeBufferBLTE(buf) {
        const remain = buf.remainingBytes;
        buf.raw.copy(this._buf, this._ofs, buf.offset, buf.byteLength);
        this._ofs += remain;
    }

    /**
     * Check a given length does not exceed current capacity.
     * @param {number} length 
     */
    _checkBounds(length) {
        // Check that this read won't go out-of-bounds anyway.
        super._checkBounds(length);

        // Ensure all blocks required for this read are available.
        const pos = this.offset + length;
        while (pos > this.blockWriteIndex)
            this._processBlock();
    }

    /**
     * Register keys for BLTE decryption.
     * @param {object} keys 
     */
    static registerKeys(keys) {
        for (const [keyName, key] of Object.entries(keys)) {
            // Ensure keyName is 8-bytes.
            if (keyName.length !== 16)
                throw new Error('[BLTE] Decryption key names are expected to be 8 bytes.');

            // Ensure key is 16-bytes.
            if (key.length !== 32)
                throw new Error('[BLTE] Decryption keys are expected to be 16-bytes.');

            KEY_RING[keyName.toLowerCase()] = key.toLowerCase();
        }
    }
}

module.exports = BLTEReader;