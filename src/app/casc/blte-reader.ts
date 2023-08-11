/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import util from 'node:util';
import zlib from 'node:zlib';

import BufferWrapper from '../buffer';
import TactKeys from './tact-keys';
import Salsa20 from './salsa20';

type BLTEBlock = {
	CompSize: number,
	DecompSize: number,
	Hash: string,
}

const BLTE_MAGIC = 0x45544c42;
const ENC_TYPE_SALSA20 = 0x53;
const EMPTY_HASH = '00000000000000000000000000000000';

export class EncryptionError extends Error {
	key: string;
	constructor(key: string) {
		super('[BLTE] Missing decryption key ' + key);
		this.key = key;

		// Maintain stack trace (V8).
		Error.captureStackTrace?.(this, EncryptionError);
	}
}

export class BLTEIntegrityError extends Error {
	constructor(expected: string, actual: string) {
		super(util.format('[BLTE] Invalid block data hash. Expected %s, got %s!', expected, actual));

		// Maintain stack trace (V8).
		Error.captureStackTrace?.(this, BLTEIntegrityError);
	}
}

export default class BLTEReader extends BufferWrapper {
	blte: BufferWrapper;
	blockIndex: number;
	blockWriteIndex: number;
	partialDecrypt: boolean;
	blocks: Array<BLTEBlock>;

	/**
	 * Check if the given data is a BLTE file.
	 * @param data
	 */
	static check(data: BufferWrapper): boolean {
		if (data.length < 4)
			return false;

		const magic = data.readUInt32();
		data.seek(0);

		return magic === BLTE_MAGIC;
	}
	/**
	 * Construct a new BLTEReader instance.
	 * @param buf
	 * @param hash
	 * @param partialDecrypt
	 */
	constructor(buf: BufferWrapper, hash: string, partialDecrypt = false) {
		super(Buffer.alloc(0)); // NIT: This was null, just setting it to new empty buffer now. Is this OK?

		this.blte = buf;
		this.blockIndex = 0;
		this.blockWriteIndex = 0;
		this.partialDecrypt = partialDecrypt;

		const size = buf.length;
		if (size < 8)
			throw new Error('[BLTE] Not enough data (< 8)');

		const magic = buf.readUInt32();
		if (magic !== BLTE_MAGIC)
			throw new Error('[BLTE] Invalid magic: ' + magic);

		const headerSize = buf.readInt32BE() as number;
		const origPos = buf.offset;

		buf.seek(0);

		const hashCheck = headerSize > 0 ? buf.readBufferWrapper(headerSize).toHash() : buf.toHash('md5');
		if (hashCheck !== hash)
			throw new Error(util.format('[BLTE] Invalid MD5 hash, expected %s got %s', hash, hashCheck));

		buf.seek(origPos);
		let numBlocks = 1;

		if (headerSize > 0) {
			if (size < 12)
				throw new Error('[BLTE] Not enough data (< 12)');

			const fc = buf.readUInt8Array(4);
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
			const block = {
				CompSize: 0,
				DecompSize: 0,
				Hash: EMPTY_HASH,
			};

			if (headerSize !== 0) {
				block.CompSize = buf.readInt32BE();
				block.DecompSize = buf.readInt32BE();
				block.Hash = buf.readString(16, 'hex');
			} else {
				block.CompSize = size - 8;
				block.DecompSize = size - 9;
			}

			allocSize += block.DecompSize;
			this.blocks[i] = block;
		}

		this.buffer = Buffer.alloc(allocSize);
		this.processAllBlocks(); // NIT: We no longer have bounds checking, so we just read all blocks for now. This means things like encoding decoding will take longer than necessary, but shouldn't affect a lot outside of that.
	}

	/**
	 * Process all BLTE blocks in the reader.
	 */
	processAllBlocks(): void {
		while (this.blockIndex < this.blocks.length)
			this._processBlock();
	}

	/**
	 * Process the next BLTE block.
	 */
	_processBlock(): boolean | void {
		// No more blocks to process.
		if (this.blockIndex === this.blocks.length)
			return false;

		const oldPos = this.offset;
		this.seek(this.blockWriteIndex);

		const block = this.blocks[this.blockIndex];
		const bltePos = this.blte.offset;

		if (block.Hash !== EMPTY_HASH) {
			const blockData = this.blte.readBufferWrapper(block.CompSize);
			const blockHash = blockData.toHash('md5');

			// Reset after reading the hash.
			this.blte.seek(bltePos);

			if (blockHash !== block.Hash)
				throw new BLTEIntegrityError(block.Hash, blockHash);
		}

		this._handleBlock(this.blte, bltePos + block.CompSize, this.blockIndex);
		this.blte.seek(bltePos + block.CompSize);

		this.blockIndex++;
		this.blockWriteIndex = this.offset;

		this.seek(oldPos);
	}

	/**
	 * Handle a BLTE block.
	 * @param block
	 * @param blockEnd
	 * @param index
	 */
	_handleBlock(block: BufferWrapper, blockEnd: number, index: number): void {
		const flag = block.readUInt8();
		switch (flag) {
			case 0x45: // Encrypted
				try {
					const decrypted = this._decryptBlock(block, blockEnd, index);
					this._handleBlock(decrypted, decrypted.length, index);
				} catch (e) {
					if (e instanceof EncryptionError) {
						// Partial decryption allows us to leave zeroed data.
						if (this.partialDecrypt)
							this.offset += this.blocks[index].DecompSize;
						else
							throw e;
					}
				}

				break;

			case 0x46: // Frame (Recursive)
				throw new Error('[BLTE] No frame decoder implemented!');

			case 0x4E: // Frame (Normal)
				this._writeBufferBLTE(block, blockEnd);
				break;

			case 0x5A: // Compressed
				this._decompressBlock(block, blockEnd, index);
				break;

			default:
				throw new Error('Unknown block: ' + flag);
		}
	}

	/**
	 * Decompress BLTE block.
	 * @param data
	 * @param blockEnd
	 * @param index
	 */
	_decompressBlock(data: BufferWrapper, blockEnd: number, index: number): void {
		const decomp = new BufferWrapper(zlib.inflateSync(data.readBuffer(blockEnd - data.offset)));
		const expectedSize = this.blocks[index].DecompSize;

		// Reallocate buffer to compensate.
		if (decomp.length !== expectedSize) {
			const newCapacity = this.length + (decomp.length - expectedSize);
			const newBuffer = Buffer.allocUnsafe(newCapacity);

			this.buffer.copy(newBuffer, 0, 0, Math.min(this.length, newCapacity));
			this.buffer = newBuffer;
		}

		this._writeBufferBLTE(decomp, decomp.length);
	}

	/**
	 * Decrypt BLTE block.
	 * @param data
	 * @param blockEnd
	 * @param index
	 */
	_decryptBlock(data: BufferWrapper, blockEnd: number, index: number): BufferWrapper {
		const keyNameSize = data.readUInt8();
		if (keyNameSize === 0 || keyNameSize !== 8)
			throw new Error('[BLTE] Unexpected keyNameSize: ' + keyNameSize);

		const keyNameBytes = new Array(keyNameSize);
		for (let i = 0; i < keyNameSize; i++)
			keyNameBytes[i] = data.readString(1, 'hex');

		const keyName = keyNameBytes.reverse().join('');
		const ivSize = data.readUInt8();

		if (ivSize !== 4)
			throw new Error('[BLTE] Unexpected ivSize: ' + ivSize);

		const ivShort = data.readUInt8Array(ivSize);
		if (data.remainingBytes === 0)
			throw new Error('[BLTE] Unexpected end of data before encryption flag.');

		const encryptType = data.readUInt8();
		if (encryptType !== ENC_TYPE_SALSA20)
			throw new Error('[BLTE] Unexpected encryption type: ' + encryptType);

		for (let shift = 0, i = 0; i < 4; shift += 8, i++)
			ivShort[i] ^= (index >> shift) & 0xFF;

		const key = TactKeys.getKey(keyName);
		if (typeof key !== 'string')
			throw new EncryptionError(keyName);

		const nonce: Array<number> = [];
		for (let i = 0; i < 8; i++)
			nonce[i] = (i < ivShort.length ? ivShort[i] : 0x0);

		const instance = new Salsa20(nonce, key);
		return instance.process(data.readBufferWrapper(blockEnd - data.offset));
	}

	/**
	 * Write the contents of a buffer to this instance.
	 * Skips bound checking for BLTE internal writing.
	 * @param buf
	 * @param blockEnd
	 */
	_writeBufferBLTE(buf: BufferWrapper, blockEnd: number): void {
		buf.toBuffer().copy(this.buffer, this.offset, buf.offset, blockEnd);
		this.offset += blockEnd - buf.offset;
	}

	/**
	 * Check a given length does not exceed current capacity.
	 * @param length
	 */
	_checkBounds(length: number): void {
		// Ensure all blocks required for this read are available.
		const pos = this.offset + length;
		while (pos > this.blockWriteIndex) {
			if (this._processBlock() === false)
				return;
		}
	}

	/**
	 * Write the contents of this buffer to a file.
	 * Directory path will be created if needed.
	 * @param file
	 */
	async writeToFile(file: string): Promise<void> {
		this.processAllBlocks();
		await super.writeToFile(file);
	}

	/**
	 * Assign a data URL for this buffer.
	 * @returns Data URL
	 */
	getDataURL(): string {
		if (!this.dataURL) {
			this.processAllBlocks();
			return super.getDataURL();
		}

		return this.dataURL;
	}
}