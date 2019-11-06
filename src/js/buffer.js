const util = require('util');

const INT_8 = Symbol('int8');
const UINT_8 = Symbol('uint8');
const INT_16 = Symbol('int16');
const UINT_16 = Symbol('uint16');
const INT_32 = Symbol('int32');
const UINT_32 = Symbol('uint32');
const FLOAT = Symbol('float');

const ENDIAN_LITTLE = Symbol('LE');
const ENDIAN_BIG = Symbol('BE');

const INT_SIZE = {
    [INT_8]: 1,
    [UINT_8]: 1,
    [INT_16]: 2,
    [UINT_16]: 2,
    [INT_32]: 4,
    [UINT_32]: 4,
    [FLOAT]: 4
};

const BUF_FUNC = {
    [ENDIAN_LITTLE]: {
        [INT_8]: Buffer.prototype.readInt8,
        [UINT_8]: Buffer.prototype.readUInt8,
        [INT_16]: Buffer.prototype.readInt16LE,
        [UINT_16]: Buffer.prototype.readUInt16LE,
        [INT_32]: Buffer.prototype.readInt32LE,
        [UINT_32]: Buffer.prototype.readUInt32LE,
        [FLOAT]: Buffer.prototype.readFloatLE
    },
    [ENDIAN_BIG]: {
        [INT_8]: Buffer.prototype.readInt8,
        [UINT_8]: Buffer.prototype.readUInt8,
        [INT_16]: Buffer.prototype.readInt16BE,
        [UINT_16]: Buffer.prototype.readUInt16BE,
        [INT_32]: Buffer.prototype.readInt32BE,
        [UINT_32]: Buffer.prototype.readUInt32BE,
        [FLOAT]: Buffer.prototype.readFloatBE
    }
};

/**
 * This class is a wrapper for the node Buffer class which provides a more streamlined
 * interface for reading/writing data. Only required features have been implemented.
 * @class BufferWrapper
 */
class BufferWrapper {
    static ENDIAN_BIG = ENDIAN_BIG;
    static ENDIAN_LITTLE = ENDIAN_LITTLE;

    /**
     * Alloc a buffer with the given length and return it wrapped.
     * The buffer is not zeroed before use and may contain secure data.
     * @param {number} length 
     * @returns {BufferWrapper}
     */
    static allocUnsafe(length) {
        return new BufferWrapper(Buffer.allocUnsafe(length));
    }

    /**
     * Construct a new BufferWrapper.
     * @param {Buffer} buf 
     */
    constructor(buf, endian = ENDIAN_LITTLE) {
        this._ofs = 0;
        this._buf = buf;
        this._end = endian;
    }

    /**
     * Get the full capacity of the buffer.
     * @returns {number}
     */
    get byteLength() {
        return this._buf.byteLength;
    }

    /**
     * Get the amount of remaining bytes until the end of the buffer.
     * @returns {number}
     */
    get remainingBytes() {
        return this.byteLength - this._ofs;
    }

    /**
     * Get the current offset within the buffer.
     * @returns {number}
     */
    get offset() {
        return this._ofs;
    }

    /**
     * Get the raw buffer wrapped by this instance.
     * @returns {Buffer}
     */
    get raw() {
        return this._buf;
    }

    /**
     * Set the default endian used by this buffer.
     * @param {Symbol} endian 
     */
    setEndian(endian) {
        this._end = endian;
    }

    /**
     * Set the absolute position of this buffer.
     * Negative values will set the position from the end of the buffer.
     * @param {number} ofs 
     */
    seek(ofs) {
        const pos = ofs < 0 ? this.byteLength + ofs : ofs;
        if (pos < 0 || pos >= this.byteLength)
            throw new Error(util.format('seek() offset out of bounds %d -> %d ! %d', ofs, pos, this.byteLength));

        this._ofs = pos;
    }

    /**
     * Read a signed 8-bit integer.
     * @param {Symbol} endian
     * @returns {number}
     */
    readInt8(endian) {
        return this._readInt(INT_8, endian);
    }

    /**
     * Read an unsigned 8-bit integer.
     * @param {Symbol} endian
     * @returns {number}
     */
    readUInt8(endian) {
        return this._readInt(UINT_8, endian);
    }

    /**
     * Read a signed 16-bit integer.
     * @param {Symbol} endian
     * @returns {number}
     */
    readInt16(endian) {
        return this._readInt(INT_16, endian);
    }

    /**
     * Read an unsigned 16-bit integer.
     * @param {Symbol} endian
     * @returns {number}
     */
    readUInt16(endian) {
        return this._readInt(UINT_16, endian);
    }

    /**
     * Read a signed 32-bit integer.
     * @param {Symbol} endian
     * @returns {number}
     */
    readInt32(endian) {
        return this._readInt(INT_32, endian);
    }

    /**
     * Read an unsigned 32-bit integer.
     * @param {Symbol} endian
     * @returns {number}
     */
    readUInt32(endian) {
        return this._readInt(UINT_32, endian);
    }

    /**
     * Read a 32-bit float.
     * @param {Symbol} endian
     * @returns {float}
     */
    readFloat(endian) {
        return this._readInt(FLOAT, endian);
    }

    /**
     * Read a string from the buffer.
     * @param {number} length Number of bytes to read.
     * @param {string} encoding 'hex', 'ascii', 'utf8', etc.
     */
    readString(length, encoding = 'utf8') {
        // Ensure we don't go out-of-bounds reading the string.
        if (this._ofs + length > this.byteLength)
            throw new Error(util.format('readString() out-of-bounds: %d > %d', this._ofs + length, this.byteLength));

        const str = this._buf.toString(encoding, this._ofs, length);
        this._ofs += length;
        return str;
    }

    /**
     * Write the contents of a buffer to this buffer.
     * @param {Buffer|BufferWrapper} buf 
     */
    writeBuffer(buf) {
        // Unwrap the internal buffer if this is a wrapper.
        if (buf instanceof BufferWrapper)
            buf = buf.raw;

        // Ensure consuming this buffer won't overflow us.
        if (buf.byteLength > this.remainingBytes)
            throw new Error(util.format('Unable to write buffer; capacity reached. %d > %d', buf.byteLength, this.remainingBytes));

        buf.copy(this._buf, this._ofs, 0, buf.byteLength);
        this._ofs += buf.byteLength;
    }

    /**
     * Read an integer from the buffer.
     * @param {Symbol} type 
     * @param {Symbol} endian
     */
    _readInt(type, endian) {
        const value = BUF_FUNC[endian || this._end][type].call(this._buf, this._ofs);
        this._ofs += INT_SIZE[type];
        return value;
    }
}

module.exports = BufferWrapper;