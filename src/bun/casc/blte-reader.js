import util from 'node:util';
import BufferWrapper from '../lib/buffer.js';
import Salsa20 from './salsa20.js';
import * as tactKeys from './tact-keys.js';

const BLTE_MAGIC = 0x45544c42;
const ENC_TYPE_SALSA20 = 0x53;
const EMPTY_HASH = '00000000000000000000000000000000';

class EncryptionError extends Error {
	constructor(key, ...params) {
		super('[BLTE] Missing decryption key ' + key, ...params);
		this.key = key;

		Error.captureStackTrace?.(this, EncryptionError);
	}
}

class BLTEIntegrityError extends Error {
	constructor(expected, actual) {
		super(util.format('[BLTE] Invalid block data hash. Expected %s, got %s!', expected, actual));

		Error.captureStackTrace?.(this, BLTEIntegrityError);
	}
}

class BLTEReader extends BufferWrapper {
	static check(data) {
		if (data.byteLength < 4)
			return false;

		const magic = data.readUInt32LE();
		data.seek(0);

		return magic === BLTE_MAGIC;
	}

	static parseBLTEHeader(buf, hash, verifyHash = true, restoreOffset = true) {
		const size = buf.byteLength;
		if (size < 8)
			throw new Error('[BLTE] Not enough data (< 8)');

		const originalOffset = buf.offset;
		buf.seek(0);

		const magic = buf.readUInt32LE();
		if (magic !== BLTE_MAGIC)
			throw new Error('[BLTE] Invalid magic: ' + magic);

		const headerSize = buf.readInt32BE();
		const origPos = buf.offset;

		if (verifyHash) {
			buf.seek(0);
			const hashCheck = headerSize > 0 ? buf.readBuffer(headerSize).calculateHash() : buf.calculateHash();
			if (hashCheck !== hash)
				throw new Error(util.format('[BLTE] Invalid MD5 hash, expected %s got %s', hash, hashCheck));

			buf.seek(origPos);
		}

		let numBlocks = 1;
		let dataStart = 8;

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

			dataStart = headerSize;
		}

		const blocks = new Array(numBlocks);
		let fileOffset = 0;
		let totalDecompSize = 0;

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

			block.fileOffset = fileOffset;
			fileOffset += block.CompSize;
			totalDecompSize += block.DecompSize;
			blocks[i] = block;
		}

		if (restoreOffset)
			buf.seek(originalOffset);

		return { blocks, headerSize, dataStart, totalSize: totalDecompSize };
	}

	constructor(buf, hash, partialDecrypt = false) {
		super(null);

		this._blte = buf;
		this.blockIndex = 0;
		this.blockWriteIndex = 0;
		this.partialDecrypt = partialDecrypt;

		const metadata = BLTEReader.parseBLTEHeader(buf, hash, true, false);
		this.blocks = metadata.blocks;

		this._buf = Buffer.alloc(metadata.totalSize);
	}

	processAllBlocks() {
		while (this.blockIndex < this.blocks.length)
			this._processBlock();
	}

	_processBlock() {
		if (this.blockIndex === this.blocks.length)
			return false;

		const oldPos = this.offset;
		this.seek(this.blockWriteIndex);

		const block = this.blocks[this.blockIndex];
		const bltePos = this._blte.offset;

		if (block.Hash !== EMPTY_HASH) {
			const blockData = this._blte.readBuffer(block.CompSize);
			const blockHash = blockData.calculateHash();

			this._blte.seek(bltePos);

			if (blockHash !== block.Hash)
				throw new BLTEIntegrityError(block.Hash, blockHash);
		}

		this._handleBlock(this._blte, bltePos + block.CompSize, this.blockIndex);
		this._blte.seek(bltePos + block.CompSize);

		this.blockIndex++;
		this.blockWriteIndex = this.offset;

		this.seek(oldPos);
	}

	_handleBlock(block, blockEnd, index) {
		const flag = block.readUInt8();
		switch (flag) {
			case 0x45: // encrypted
				try {
					const decrypted = this._decryptBlock(block, blockEnd, index);
					this._handleBlock(decrypted, decrypted.byteLength, index);
				} catch (e) {
					if (e instanceof EncryptionError) {
						if (this.partialDecrypt)
							this._ofs += this.blocks[index].DecompSize;
						else
							throw e;
					}
				}

				break;

			case 0x46: // frame (recursive)
				throw new Error('[BLTE] No frame decoder implemented!');

			case 0x4E: // frame (normal)
				this._writeBufferBLTE(block, blockEnd);
				break;

			case 0x5A: // compressed
				this._decompressBlock(block, blockEnd, index);
				break;

			default:
				throw new Error('Unknown block: ' + flag);
		}
	}

	_decompressBlock(data, blockEnd, index) {
		const decomp = data.readBuffer(blockEnd - data.offset, true, true);
		const expectedSize = this.blocks[index].DecompSize;

		if (decomp.byteLength > expectedSize)
			this.setCapacity(this.byteLength + (decomp.byteLength - expectedSize));

		this._writeBufferBLTE(decomp, decomp.byteLength);
	}

	_decryptBlock(data, blockEnd, index) {
		const keyNameSize = data.readUInt8();
		if (keyNameSize === 0 || keyNameSize !== 8)
			throw new Error('[BLTE] Unexpected keyNameSize: ' + keyNameSize);

		const keyNameBytes = new Array(keyNameSize);
		for (let i = 0; i < keyNameSize; i++)
			keyNameBytes[i] = data.readHexString(1);

		const keyName = keyNameBytes.reverse().join('');
		const ivSize = data.readUInt8();

		if ((ivSize !== 4 && ivSize !== 8) || ivSize > 8)
			throw new Error('[BLTE] Unexpected ivSize: ' + ivSize);

		const ivShort = data.readUInt8(ivSize);
		if (data.remainingBytes === 0)
			throw new Error('[BLTE] Unexpected end of data before encryption flag.');

		const encryptType = data.readUInt8();
		if (encryptType !== ENC_TYPE_SALSA20)
			throw new Error('[BLTE] Unexpected encryption type: ' + encryptType);

		for (let shift = 0, i = 0; i < 4; shift += 8, i++)
			ivShort[i] = (ivShort[i] ^ ((index >> shift) & 0xFF)) & 0xFF;

		const key = tactKeys.getKey(keyName);
		if (typeof key !== 'string')
			throw new EncryptionError(keyName);

		const nonce = [];
		for (let i = 0; i < 8; i++)
			nonce[i] = (i < ivShort.length ? ivShort[i] : 0x0);

		const instance = new Salsa20(nonce, key);
		return instance.process(data.readBuffer(blockEnd - data.offset));
	}

	_writeBufferBLTE(buf, blockEnd) {
		buf.raw.copy(this._buf, this._ofs, buf.offset, blockEnd);
		this._ofs += blockEnd - buf.offset;
	}

	_checkBounds(length) {
		super._checkBounds(length);

		const pos = this.offset + length;
		while (pos > this.blockWriteIndex) {
			if (this._processBlock() === false)
				return;
		}
	}

	async writeToFile(file) {
		this.processAllBlocks();
		await super.writeToFile(file);
	}
}

export { BLTEReader, EncryptionError, BLTEIntegrityError };
