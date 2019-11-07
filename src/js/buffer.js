const util = require('util');
const crypto = require('crypto');

const INT_8 = Symbol('int8');
const INT_16 = Symbol('int16');
const INT_32 = Symbol('int32');
const FLOAT = Symbol('float');
const INT_40 = Symbol('int40');

const ENDIAN_LITTLE = Symbol('LE');
const ENDIAN_BIG = Symbol('BE');

const INT_SIGNED = Symbol('signed');
const INT_UNSIGNED = Symbol('unsigned');

const TYPE_SIZE = {
    [INT_8]: 1,
    [INT_16]: 2,
    [INT_32]: 4,
    [INT_40]: 5
};

const BUF_READ_FUNC = {
    [INT_SIGNED]: {
        [ENDIAN_LITTLE]: Buffer.prototype.readIntLE,
        [ENDIAN_BIG]: Buffer.prototype.readIntBE
    },
    [INT_UNSIGNED]: {
        [ENDIAN_LITTLE]: Buffer.prototype.readUIntLE,
        [ENDIAN_BIG]: Buffer.prototype.readUIntBE
    }
};

const BUF_WRITE_FUNC = {
    [INT_SIGNED]: {
        [ENDIAN_LITTLE]: Buffer.prototype.writeIntLE,
        [ENDIAN_BIG]: Buffer.prototype.writeIntBE
    },
    [INT_UNSIGNED]: {
        [ENDIAN_LITTLE]: Buffer.prototype.writeUIntLE,
        [ENDIAN_BIG]: Buffer.prototype.writeUIntBE
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
     * Shift the position of the buffer relative to its current position.
     * Positive numbers seek forward, negative seek backwards.
     * @param {number} ofs 
     */
    move(ofs) {
        const pos = this.offset + ofs;
        if (pos < 0 || pos >= this.byteLength)
            throw new Error(util.format('move() offset out of bounds %d -> %d ! %d', ofs, pos, this.byteLength));

        this._ofs = pos;
    }

    /**
     * Read one or more signed 8-bit integers.
     * @param {number} count
     * @param {Symbol} endian
     * @returns {number|number[]}
     */
    readInt8(count = 1, endian) {
        return this._readInt(INT_8, INT_SIGNED, count, endian);
    }

    /**
     * Read one or more unsigned 8-bit integers.
     * @param {number} count
     * @param {Symbol} endian
     * @returns {number|number[]}
     */
    readUInt8(count = 1, endian) {
        return this._readInt(INT_8, INT_UNSIGNED, count, endian);
    }

    /**
     * Read one or more signed 16-bit integers.
     * @param {number} count
     * @param {Symbol} endian
     * @returns {number|number[]}
     */
    readInt16(count = 1, endian) {
        return this._readInt(INT_16, INT_SIGNED, count, endian);
    }

    /**
     * Read one or more unsigned 16-bit integers.
     * @param {number} count
     * @param {Symbol} endian
     * @returns {number|number[]}
     */
    readUInt16(count = 1, endian) {
        return this._readInt(INT_16, INT_UNSIGNED, count, endian);
    }

    /**
     * Read one or more signed 32-bit integers.
     * @param {number} count
     * @param {Symbol} endian
     * @returns {number|number[]}
     */
    readInt32(count = 1, endian) {
        return this._readInt(INT_32, INT_SIGNED, count, endian);
    }

    /**
     * Read one or more unsigned 32-bit integers.
     * @param {number} count
     * @param {Symbol} endian
     * @returns {number|number[]}
     */
    readUInt32(count = 1, endian) {
        return this._readInt(INT_32, INT_UNSIGNED, count, endian);
    }

    /**
     * Read one or more 40-bit integers.
     * @param {number} count 
     * @param {Symbol} endian 
     * @returns {number|number[]}
     */
    readInt40(count = 1, endian) {
        return this._readInt(INT_40, INT_SIGNED, count, endian);
    }

    /**
     * Read a string from the buffer.
     * @param {number} length Number of bytes to read.
     * @param {string} encoding 'hex', 'ascii', 'utf8', etc.
     */
    readString(length, encoding = 'utf8') {
        // Ensure we don't go out-of-bounds reading the string.
        this._checkBounds(length);

        const str = this._buf.toString(encoding, this._ofs, this._ofs + length);
        this._ofs += length;
        return str;
    }

    /**
     * Read a buffer from this buffer.
     * @param {number} length 
     */
    readBuffer(length) {
        if (length === undefined) // Default to consuming all remaining bytes.
            length = this.remainingBytes;

        // Ensure we have enough data left to fulfill this.
        this._checkBounds(length);

        const buf = BufferWrapper.allocUnsafe(length);
        this.raw.copy(buf.raw, 0, this._ofs, this._ofs + length);
        this._ofs += length;

        return buf;
    }

    /**
     * Write one or more signed 8-bit integers.
     * @param {number|number[]} value 
     * @param {Symbol} endian 
     */
    writeInt8(value, endian) {
        this._writeInt(INT_8, INT_SIGNED, value, endian);
    }

    /**
     * Write one or more unsigned 8-bit integers.
     * @param {number|number[]} value 
     * @param {Symbol} endian 
     */
    writeUInt8(value, endian) {
        this._writeInt(INT_8, INT_UNSIGNED, value, endian);
    }

    /**
     * Write one or more signed 16-bit integers.
     * @param {number|number[]} value 
     * @param {Symbol} endian 
     */
    writeInt16(value, endian) {
        this._writeInt(INT_16, INT_SIGNED, value, endian);
    }

    /**
     * Write one or more unsigned 16-bit integers.
     * @param {number|number[]} value 
     * @param {Symbol} endian 
     */
    writeUInt16(value, endian) {
        this._writeInt(INT_16, INT_UNSIGNED, value, endian);
    }

    /**
     * Write one or more signed 32-bit integers.
     * @param {number|number[]} value 
     * @param {Symbol} endian 
     */
    writeInt32(value, endian) {
        this._writeInt(INT_32, INT_SIGNED, value, endian);
    }

    /**
     * Write one or more unsigned 32-bit integers.
     * @param {number|number[]} value 
     * @param {Symbol} endian 
     */
    writeUInt32(value, endian) {
        this._writeInt(INT_32, INT_UNSIGNED, value, endian);
    }

    /**
     * Write the contents of a buffer to this buffer.
     * @param {Buffer|BufferWrapper} buf 
     */
    writeBuffer(buf) {
        let startIndex = 0;
        let copyLength = 0;

        // Unwrap the internal buffer if this is a wrapper.
        if (buf instanceof BufferWrapper) {
            startIndex = buf.offset;
            copyLength = buf.remainingBytes;
            buf = buf.raw;
        } else {
            copyLength = buf.byteLength;
        }

        // Ensure consuming this buffer won't overflow us.
        this._checkBounds(buf.byteLength);

        buf.copy(this._buf, this._ofs, startIndex, startIndex + copyLength);
        this._ofs += copyLength;
    }

    /**
     * Calculate a hash of given bytes.
     * @param {number} length Amount of bytes to process.
     * @param {string} hash Hashing method, defaults to 'md5'.
     * @param {string} encoding Output encoding, defaults to 'hex'.
     */
    calculateHash(length, hash = 'md5', encoding = 'hex') {
        return crypto.createHash(hash).update(this.readBuffer(length).raw).digest(encoding);
    }

    /**
     * Check a given length does not exceed current capacity.
     * @param {number} length 
     */
    _checkBounds(length) {
        if (this.remainingBytes < length)
            throw new Error(util.format('Buffer operation out-of-bounds: %d > %d', length, this.remainingBytes));
    }

    /**
     * Read one or more integers from the buffer.
     * @param {Symbol} type 
     * @param {Symbol} signed
     * @param {number} count
     * @param {Symbol} endian
     */
    _readInt(type, signed, count, endian) {
        if (count > 1) {
            const size = TYPE_SIZE[type];
            this._checkBounds(size * count);

            const out = new Array(count);
            const func = BUF_READ_FUNC[signed][endian || this._end];
            for (let i = 0; i < count; i++) {
                out[i] = func.call(this._buf, this._ofs, size);
                this._ofs += size;
            }

            return out;
        } else {
            const size = TYPE_SIZE[type];
            this._checkBounds(size);

            const value = BUF_READ_FUNC[signed][endian || this._end].call(this._buf, this._ofs, size);
            this._ofs += size;
            return value;
        }
    }

    /**
     * Write one or more integers to this buffer.
     * @param {Symbol} type 
     * @param {Symbol} signed
     * @param {number|Array} value 
     * @param {Symbol} endian 
     */
    _writeInt(type, signed, value, endian) {
        if (Array.isArray(value)) {
            const size = TYPE_SIZE[type];
            this._checkBounds(size * value.length);

            const func = BUF_WRITE_FUNC[signed][endian || this._end];
            for (const val of value) {
                func.call(this._buf, val, this._ofs, size);
                this._ofs += size;
            }
        } else {
            const size = TYPE_SIZE[type];
            this._checkBounds(size);

            BUF_WRITE_FUNC[signed][endian || this._end].call(this._buf, value, this._ofs);
            this._ofs += size;
        }
    }
}

module.exports = BufferWrapper;