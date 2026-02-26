import util from 'node:util';
import BufferWrapper from '../lib/buffer.js';
import Salsa20 from './salsa20.js';
import * as tactKeys from './tact-keys.js';

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

class BLTEStreamReader {
	constructor(hash, metadata, blockFetcher, partialDecrypt = false) {
		this.hash = hash;
		this.metadata = metadata;
		this.blockFetcher = blockFetcher;
		this.partialDecrypt = partialDecrypt;
		this.blockCache = new Map();
		this.maxCacheSize = 10;
	}

	async getBlock(blockIndex) {
		if (this.blockCache.has(blockIndex))
			return this.blockCache.get(blockIndex);

		const blockMeta = this.metadata.blocks[blockIndex];
		const rawBlock = await this.blockFetcher(blockIndex);

		if (blockMeta.Hash !== EMPTY_HASH) {
			const blockHash = rawBlock.calculateHash();
			if (blockHash !== blockMeta.Hash)
				throw new BLTEIntegrityError(blockMeta.Hash, blockHash);
		}

		const decoded = await this._decodeBlock(rawBlock, blockIndex);

		this.blockCache.set(blockIndex, decoded);
		if (this.blockCache.size > this.maxCacheSize) {
			const firstKey = this.blockCache.keys().next().value;
			this.blockCache.delete(firstKey);
		}

		return decoded;
	}

	async _decodeBlock(blockData, index) {
		const flag = blockData.readUInt8();

		switch (flag) {
			case 0x45: // encrypted
				try {
					const decrypted = this._decryptBlock(blockData, index);
					return await this._decodeBlock(decrypted, index);
				} catch (e) {
					if (e instanceof EncryptionError) {
						if (this.partialDecrypt) {
							const size = this.metadata.blocks[index].DecompSize;
							return BufferWrapper.alloc(size, true);
						}
						throw e;
					}
					throw e;
				}

			case 0x4e: // normal (uncompressed)
				return blockData.readBuffer(blockData.remainingBytes);

			case 0x5a: // compressed
				return blockData.readBuffer(blockData.remainingBytes, true, true);

			case 0x46: // frame (recursive)
				throw new Error('[BLTE] No frame decoder implemented!');

			default:
				throw new Error('Unknown BLTE block type: ' + flag);
		}
	}

	_decryptBlock(data, index) {
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
		return instance.process(data.readBuffer(data.remainingBytes));
	}

	createReadableStream() {
		let currentBlock = 0;
		const totalBlocks = this.metadata.blocks.length;
		const self = this;

		return new ReadableStream({
			async pull(controller) {
				if (currentBlock >= totalBlocks) {
					controller.close();
					return;
				}

				try {
					const decodedBlock = await self.getBlock(currentBlock);
					controller.enqueue(new Uint8Array(decodedBlock.raw));
					currentBlock++;
				} catch (e) {
					controller.error(e);
				}
			},

			cancel() {
				self.blockCache.clear();
			}
		});
	}

	async *streamBlocks() {
		for (let i = 0; i < this.metadata.blocks.length; i++)
			yield await this.getBlock(i);
	}

	getTotalSize() {
		return this.metadata.totalSize;
	}

	getBlockCount() {
		return this.metadata.blocks.length;
	}

	clearCache() {
		this.blockCache.clear();
	}
}

export default BLTEStreamReader;
