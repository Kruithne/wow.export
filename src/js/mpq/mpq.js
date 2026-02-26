/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/
import { pkware_dcl_explode } from './pkware.js';
import { huffman_decomp } from './huffman.js';
import { bzip2_decompress } from './bzip2.js';

const MPQ_FILE_IMPLODE = 0x00000100;
const MPQ_FILE_COMPRESS = 0x00000200;
const MPQ_FILE_ENCRYPTED = 0x00010000;
const MPQ_FILE_FIX_KEY = 0x00020000;
const MPQ_FILE_SINGLE_UNIT = 0x01000000;
const MPQ_FILE_DELETE_MARKER = 0x02000000;
const MPQ_FILE_SECTOR_CRC = 0x04000000;
const MPQ_FILE_EXISTS = 0x80000000;

const HASH_ENTRY_EMPTY = 0xFFFFFFFF;
const HASH_ENTRY_DELETED = 0xFFFFFFFE;

const HashType = {
	TABLE_OFFSET: 0,
	HASH_A: 1,
	HASH_B: 2,
	TABLE: 3,
};

class MPQArchive {
	constructor(filePath) {
		this.filePath = filePath;
		this.fd = fs.openSync(filePath, 'r');
		this.encryptionTable = this.buildEncryptionTable();
		this.header = this.readHeader();
		this.hashTable = this.readHashTable();
		this.blockTable = this.readBlockTable();
		this.files = [];

		try {
			const listfile_buffer = this.extractFile('(listfile)');
			if (listfile_buffer) {
				const decoder = new TextDecoder('utf-8');
				const listfile_text = decoder.decode(listfile_buffer);

				this.files = listfile_text.trim().split(/[\r\n]+/).filter(f => f.length > 0);
			}
		} catch (e) {
			// no listfile
		}
	}

	close() {
		if (this.fd !== null) {
			fs.closeSync(this.fd);
			this.fd = null;
		}
	}

	readBytes(offset, length) {
		const buffer = Buffer.allocUnsafe(length);
		fs.readSync(this.fd, buffer, 0, length, offset);
		return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	}

	buildEncryptionTable() {
		const table = new Uint32Array(0x500);
		let seed = 0x00100001;

		for (let i = 0; i < 0x100; i++) {
			let index = i;
			for (let j = 0; j < 5; j++) {
				seed = (seed * 125 + 3) % 0x2aaaab;
				const temp1 = (seed & 0xffff) << 0x10;

				seed = (seed * 125 + 3) % 0x2aaaab;
				const temp2 = seed & 0xffff;

				table[index] = (temp1 | temp2) >>> 0;
				index += 0x100;
			}
		}

		return table;
	}

	readHeader() {
		let offset = 0;

		const possible_offsets = [0, 0x200, 0x400, 0x600, 0x800, 0xa00, 0xc00, 0xe00];
		let found_offset = -1;

		for (const test_offset of possible_offsets) {
			const data = this.readBytes(test_offset, 4);

			const magic = String.fromCharCode(
				data[0],
				data[1],
				data[2],
				data[3]
			);

			if (magic === 'MPQ\x1a' || magic === 'MPQ\x1b') {
				found_offset = test_offset;
				offset = test_offset;
				break;
			}
		}

		if (found_offset === -1)
			throw new Error('invalid MPQ archive: MPQ signature not found');

		const data = this.readBytes(offset, 4);
		const magic = String.fromCharCode(
			data[0],
			data[1],
			data[2],
			data[3]
		);

		let header;

		if (magic === 'MPQ\x1b') {
			const user_data_header = this.readUserDataHeader(offset);
			offset = user_data_header.mpqHeaderOffset;
			header = this.readMPQHeader(offset);
			header.userDataHeader = user_data_header;
		} else if (magic === 'MPQ\x1a') {
			header = this.readMPQHeader(offset);
		} else {
			throw new Error('invalid MPQ archive: invalid magic signature');
		}

		return header;
	}

	readUserDataHeader(offset) {
		const data = this.readBytes(offset, 16);
		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

		const magic = String.fromCharCode(
			data[0],
			data[1],
			data[2],
			data[3]
		);

		const user_data_size = view.getUint32(4, true);
		const mpq_header_offset = view.getUint32(8, true);
		const user_data_header_size = view.getUint32(12, true);

		const content = this.readBytes(offset + 16, user_data_header_size);

		return {
			magic,
			userDataSize: user_data_size,
			mpqHeaderOffset: mpq_header_offset,
			userDataHeaderSize: user_data_header_size,
			content,
		};
	}

	readMPQHeader(offset) {
		const data = this.readBytes(offset, 44);
		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

		const magic = String.fromCharCode(
			data[0],
			data[1],
			data[2],
			data[3]
		);

		const header_size = view.getUint32(4, true);
		const archived_size = view.getUint32(8, true);
		const format_version = view.getUint16(12, true);
		const sector_size_shift = view.getUint16(14, true);
		const hash_table_offset = view.getUint32(16, true);
		const block_table_offset = view.getUint32(20, true);
		const hash_table_entries = view.getUint32(24, true);
		const block_table_entries = view.getUint32(28, true);

		const header = {
			magic,
			headerSize: header_size,
			archivedSize: archived_size,
			formatVersion: format_version,
			sectorSizeShift: sector_size_shift,
			hashTableOffset: hash_table_offset,
			blockTableOffset: block_table_offset,
			hashTableEntries: hash_table_entries,
			blockTableEntries: block_table_entries,
			offset,
		};

		if (format_version === 1) {
			const ext_block_table_low = view.getUint32(32, true);
			const ext_block_table_high = view.getUint32(36, true);

			header.extendedBlockTableOffset = (BigInt(ext_block_table_high) << 32n) | BigInt(ext_block_table_low);
			header.hashTableOffsetHigh = view.getInt16(40, true);
			header.blockTableOffsetHigh = view.getInt16(42, true);
		}

		return header;
	}

	hash(str, hashType) {
		let seed1 = 0x7fed7fed >>> 0;
		let seed2 = 0xeeeeeeee >>> 0;

		str = str.toUpperCase();

		for (let i = 0; i < str.length; i++) {
			const ch = str.charCodeAt(i);
			const value = this.encryptionTable[(hashType << 8) + ch];
			seed1 = (value ^ (seed1 + seed2)) >>> 0;
			seed2 = (ch + seed1 + seed2 + (seed2 << 5) + 3) >>> 0;
		}

		return seed1;
	}

	decrypt(data, key) {
		let seed1 = key >>> 0;
		let seed2 = 0xeeeeeeee >>> 0;

		const result = new Uint8Array(data.length);
		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		const result_view = new DataView(result.buffer);

		for (let i = 0; i < Math.floor(data.length / 4); i++) {
			const temp = (seed2 + this.encryptionTable[0x400 + (seed1 & 0xff)]) >>> 0;
			seed2 = temp;

			const value = view.getUint32(i * 4, true);
			const decrypted = (value ^ (seed1 + seed2)) >>> 0;

			seed1 = ((((~seed1) << 21) + 0x11111111) | (seed1 >>> 11)) >>> 0;
			seed2 = (decrypted + seed2 + (seed2 << 5) + 3) >>> 0;

			result_view.setUint32(i * 4, decrypted, true);
		}

		return result;
	}

	detectFileSeed(data, expected) {
		if (data.length < 8)
			return 0;

		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		const encrypted0 = view.getUint32(0, true);
		const encrypted1 = view.getUint32(4, true);

		const seed_sum = (encrypted0 ^ expected) >>> 0;
		const temp = (seed_sum - 0xEEEEEEEE) >>> 0;

		for (let low_byte = 0; low_byte < 256; low_byte++) {
			const seed1 = (temp - this.encryptionTable[0x400 + low_byte]) >>> 0;

			const seed2_0 = (0xEEEEEEEE + this.encryptionTable[0x400 + (seed1 & 0xFF)]) >>> 0;
			const decrypted0 = (encrypted0 ^ (seed1 + seed2_0)) >>> 0;

			if (decrypted0 !== expected)
				continue;

			const next_seed1 = ((((~seed1) << 21) + 0x11111111) | (seed1 >>> 11)) >>> 0;
			const seed2_1 = (decrypted0 + seed2_0 + (seed2_0 << 5) + 3 + this.encryptionTable[0x400 + (next_seed1 & 0xFF)]) >>> 0;
			const decrypted1 = (encrypted1 ^ (next_seed1 + seed2_1)) >>> 0;

			if ((decrypted1 & 0xFFFF0000) === 0)
				return seed1;
		}

		return 0;
	}

	readHashTable() {
		const table_offset = this.header.hashTableOffset + this.header.offset;
		const table_size = this.header.hashTableEntries * 16;
		const key = this.hash('(hash table)', HashType.TABLE);

		let table_data = this.readBytes(table_offset, table_size);
		const decrypted = this.decrypt(table_data, key);
		table_data = new Uint8Array(decrypted);

		const entries = [];
		const table_view = new DataView(table_data.buffer, table_data.byteOffset, table_data.byteLength);

		for (let i = 0; i < this.header.hashTableEntries; i++) {
			const offset = i * 16;
			entries.push({
				hashA: table_view.getUint32(offset, true),
				hashB: table_view.getUint32(offset + 4, true),
				locale: table_view.getUint16(offset + 8, true),
				platform: table_view.getUint16(offset + 10, true),
				blockTableIndex: table_view.getUint32(offset + 12, true),
			});
		}

		return entries;
	}

	readBlockTable() {
		const table_offset = this.header.blockTableOffset + this.header.offset;
		const table_size = this.header.blockTableEntries * 16;
		const key = this.hash('(block table)', HashType.TABLE);

		let table_data = this.readBytes(table_offset, table_size);
		const decrypted = this.decrypt(table_data, key);
		table_data = new Uint8Array(decrypted);

		const entries = [];
		const table_view = new DataView(table_data.buffer, table_data.byteOffset, table_data.byteLength);

		for (let i = 0; i < this.header.blockTableEntries; i++) {
			const offset = i * 16;
			entries.push({
				offset: table_view.getUint32(offset, true),
				archivedSize: table_view.getUint32(offset + 4, true),
				size: table_view.getUint32(offset + 8, true),
				flags: table_view.getUint32(offset + 12, true),
			});
		}

		return entries;
	}

	getHashTableEntry(filename) {
		const hash_table_index = this.hash(filename, HashType.TABLE_OFFSET) & (this.header.hashTableEntries - 1);
		const hash_a = this.hash(filename, HashType.HASH_A);
		const hash_b = this.hash(filename, HashType.HASH_B);

		for (let i = hash_table_index; i < this.hashTable.length; i++) {
			const entry = this.hashTable[i];
			if (entry.hashA === hash_a && entry.hashB === hash_b) {
				if (entry.blockTableIndex === 0xFFFFFFFF || entry.blockTableIndex === 0xFFFFFFFE)
					return null; // empty or deleted
				return entry;
			}

			if (entry.hashA === 0xFFFFFFFF && entry.hashB === 0xFFFFFFFF)
				break; // file doesn't exist
		}

		return null;
	}

	decompress(data, expected_size) {
		// 0x01: Huffman
		// 0x02: Zlib
		// 0x08: PKWare
		// 0x10: Bzip2
		// 0x40: ADPCM Mono
		// 0x80: ADPCM Stereo

		if (data.length === 0)
			return data;

		let compression_flags = data[0];
		let result = data.slice(1);

		if (compression_flags === 0)
			return result;

		// order: Bzip2 (0x10) -> PKWare (0x08) -> Zlib (0x02) -> Huffman (0x01)
		if (compression_flags & 0x10) {
			result = new Uint8Array(bzip2_decompress(result));
			compression_flags &= ~0x10;

			if (compression_flags === 0)
				return result;
		}

		if (compression_flags & 0x08) {
			if (!expected_size)
				throw new Error('PKWare decompression requires expectedSize parameter');

			result = new Uint8Array(pkware_dcl_explode(result, expected_size));
			compression_flags &= ~0x08;

			if (compression_flags === 0)
				return result;
		}

		if (compression_flags & 0x02) {
			result = new Uint8Array(this.inflateData(result));
			compression_flags &= ~0x02;

			if (compression_flags === 0)
				return result;
		}

		if (compression_flags & 0x01) {
			result = new Uint8Array(huffman_decomp(result));
			compression_flags &= ~0x01;

			if (compression_flags === 0)
				return result;
		}

		if (compression_flags & 0x80)
			throw new Error('ADPCM Stereo compression (0x80) not yet supported');

		if (compression_flags & 0x40)
			throw new Error('ADPCM Mono compression (0x40) not yet supported');

		if (compression_flags !== 0)
			throw new Error(`unhandled compression flags remaining: 0x${compression_flags.toString(16)}`);

		return result;
	}

	inflateData(data) {
		try {
			const result = inflateSync(Buffer.from(data));
			return new Uint8Array(result);
		} catch (e) {
			console.error('decompression error:', e);
			throw e;
		}
	}

	extractFile(filename) {
		const hash_entry = this.getHashTableEntry(filename);
		if (!hash_entry)
			return null;

		const block_entry = this.blockTable[hash_entry.blockTableIndex];

		if (!(block_entry.flags & MPQ_FILE_EXISTS))
			return null;

		if (block_entry.archivedSize === 0)
			return new ArrayBuffer(0);

		const file_offset = block_entry.offset + this.header.offset;
		let file_data = this.readBytes(file_offset, block_entry.archivedSize);

		let encryption_seed = 0;
		let is_encrypted = false;

		if (block_entry.flags & MPQ_FILE_ENCRYPTED) {
			is_encrypted = true;
			const path_separator_index = filename.lastIndexOf('\\');
			const file_name_only = path_separator_index >= 0 ? filename.substring(path_separator_index + 1) : filename;
			encryption_seed = this.hash(file_name_only, HashType.TABLE);

			if (block_entry.flags & MPQ_FILE_FIX_KEY)
				encryption_seed = ((encryption_seed + block_entry.offset) ^ block_entry.size) >>> 0;
		}

		// check if file is actually stored as single unit even without flag
		// this happens when archivedSize == size and no compression
		const is_single_unit = (block_entry.flags & MPQ_FILE_SINGLE_UNIT) ||
		                       (block_entry.archivedSize === block_entry.size && !(block_entry.flags & MPQ_FILE_COMPRESS));

		if (is_single_unit) {
			if (is_encrypted)
				file_data = new Uint8Array(this.decrypt(file_data, encryption_seed));

			if (block_entry.flags & MPQ_FILE_COMPRESS) {
				if (block_entry.size > block_entry.archivedSize)
					file_data = new Uint8Array(this.decompress(file_data, block_entry.size));
			}
		} else {
			const sector_size = 512 << this.header.sectorSizeShift;
			let sectors = Math.ceil(block_entry.size / sector_size);

			const has_crc = !!(block_entry.flags & MPQ_FILE_SECTOR_CRC);
			if (has_crc)
				sectors++;

			let positions = [];
			const pos_view = new DataView(file_data.buffer, file_data.byteOffset, file_data.byteLength);

			for (let i = 0; i <= sectors; i++)
				positions.push(pos_view.getUint32(i * 4, true));

			const expected_first_pos = (sectors + 1) * 4;
			const is_position_table_encrypted = positions[0] !== expected_first_pos;

			if (is_position_table_encrypted) {
				const position_table_data = file_data.slice(0, (sectors + 1) * 4);

				if (encryption_seed === 0) {
					encryption_seed = this.detectFileSeed(position_table_data, expected_first_pos);
					if (encryption_seed === 0) {
						// plaintext attack failed, compute from filename
						const path_separator_index = filename.lastIndexOf('\\');
						const file_name_only = path_separator_index >= 0 ? filename.substring(path_separator_index + 1) : filename;
						encryption_seed = this.hash(file_name_only, HashType.TABLE);

						if (block_entry.flags & MPQ_FILE_FIX_KEY)
							encryption_seed = ((encryption_seed + block_entry.offset) ^ block_entry.size) >>> 0;
					}
					is_encrypted = true;
				} else {
					const detected_seed = this.detectFileSeed(position_table_data, expected_first_pos);
					if (detected_seed !== 0)
						encryption_seed = detected_seed;
				}

				const encrypted_positions = new Uint8Array((sectors + 1) * 4);
				for (let i = 0; i <= sectors; i++) {
					const view = new DataView(encrypted_positions.buffer);
					view.setUint32(i * 4, positions[i], true);
				}

				const decrypted_positions = this.decrypt(encrypted_positions, encryption_seed);
				const decrypted_view = new DataView(decrypted_positions.buffer);

				positions = [];
				for (let i = 0; i <= sectors; i++)
					positions.push(decrypted_view.getUint32(i * 4, true));

				encryption_seed = (encryption_seed + 1) >>> 0;
			}

			const result = [];
			let sector_bytes_left = block_entry.size;
			const num_sectors = positions.length - (has_crc ? 2 : 1);

			for (let i = 0; i < num_sectors; i++) {
				let sector = file_data.slice(positions[i], positions[i + 1]);

				if (is_encrypted && block_entry.size > 3) {
					const sector_seed = (encryption_seed + i) >>> 0;
					sector = new Uint8Array(this.decrypt(sector, sector_seed));
				}

				if (block_entry.flags & MPQ_FILE_COMPRESS) {
					const expected_sector_size = Math.min(sector_size, sector_bytes_left);
					if (sector.length !== expected_sector_size) {
						sector = new Uint8Array(this.decompress(sector, expected_sector_size));
					}
				}

				sector_bytes_left -= sector.length;
				result.push(sector);
			}

			const total_length = result.reduce((sum, arr) => sum + arr.length, 0);
			const combined = new Uint8Array(total_length);
			let offset = 0;

			for (const arr of result) {
				combined.set(arr, offset);
				offset += arr.length;
			}
			file_data = combined;
		}

		return file_data.buffer.slice(file_data.byteOffset, file_data.byteOffset + file_data.byteLength);
	}

	getInfo() {
		return {
			formatVersion: this.header.formatVersion,
			archiveSize: this.header.archivedSize,
			fileCount: this.files.length,
			hashTableEntries: this.header.hashTableEntries,
			blockTableEntries: this.header.blockTableEntries,
		};
	}

	getValidHashEntries() {
		return this.hashTable.filter(entry => {
			return entry.blockTableIndex !== HASH_ENTRY_EMPTY &&
			entry.blockTableIndex !== HASH_ENTRY_DELETED &&
			entry.blockTableIndex < this.blockTable.length &&
			entry.hashA !== HASH_ENTRY_EMPTY &&
			entry.hashB !== HASH_ENTRY_EMPTY;
		});
	}

	getValidBlockEntries() {
		return this.blockTable
		.map((entry, index) => ({index, entry}))
		.filter(({entry}) => (entry.flags & MPQ_FILE_EXISTS) !== 0);
	}

	extractFileByBlockIndex(blockIndex) {
		if (blockIndex >= this.blockTable.length)
			return null;

		const block_entry = this.blockTable[blockIndex];

		if (!(block_entry.flags & MPQ_FILE_EXISTS))
			return null;

		if (block_entry.archivedSize === 0)
			return new ArrayBuffer(0);

		const file_offset = block_entry.offset + this.header.offset;
		let file_data = this.readBytes(file_offset, block_entry.archivedSize);

		if (block_entry.flags & MPQ_FILE_ENCRYPTED)
			return null; // todo: MPQ_FILE_FIX_KEY?

		if (block_entry.flags & MPQ_FILE_SINGLE_UNIT) {
			if (block_entry.flags & MPQ_FILE_COMPRESS) {
				if (block_entry.size > block_entry.archivedSize)
					file_data = new Uint8Array(this.decompress(file_data, block_entry.size));
			}
		} else {
			const sector_size = 512 << this.header.sectorSizeShift;
			let sectors = Math.ceil(block_entry.size / sector_size);

			const has_crc = !!(block_entry.flags & MPQ_FILE_SECTOR_CRC);
			if (has_crc)
				sectors++;

			const positions = [];
			const pos_view = new DataView(file_data.buffer, file_data.byteOffset, file_data.byteLength);

			for (let i = 0; i <= sectors; i++)
				positions.push(pos_view.getUint32(i * 4, true));

			const result = [];
			let sector_bytes_left = block_entry.size;
			const num_sectors = positions.length - (has_crc ? 2 : 1);

			for (let i = 0; i < num_sectors; i++) {
				let sector = file_data.slice(positions[i], positions[i + 1]);

				if (block_entry.flags & MPQ_FILE_COMPRESS) {
					const expected_sector_size = Math.min(sector_size, sector_bytes_left);
					if (sector.length !== expected_sector_size) {
						sector = new Uint8Array(this.decompress(sector, expected_sector_size));
					}
				}

				sector_bytes_left -= sector.length;
				result.push(sector);
			}

			const total_length = result.reduce((sum, arr) => sum + arr.length, 0);
			const combined = new Uint8Array(total_length);
			let offset = 0;

			for (const arr of result) {
				combined.set(arr, offset);
				offset += arr.length;
			}
			file_data = combined;
		}

		return file_data.buffer.slice(file_data.byteOffset, file_data.byteOffset + file_data.byteLength);
	}
}

export { MPQArchive };
