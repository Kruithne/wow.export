/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

// ref: https://en.wikipedia.org/wiki/Bzip2

const R_NUMS = [
	619, 720, 127, 481, 931, 816, 813, 233, 566, 247, 985, 724, 205, 454, 863, 491,
	741, 242, 949, 214, 733, 859, 335, 708, 621, 574, 73, 654, 730, 472, 419, 436,
	278, 496, 867, 210, 399, 680, 480, 51, 878, 465, 811, 169, 869, 675, 611, 697,
	867, 561, 862, 687, 507, 283, 482, 129, 807, 591, 733, 623, 150, 238, 59, 379,
	684, 877, 625, 169, 643, 105, 170, 607, 520, 932, 727, 476, 693, 425, 174, 647,
	73, 122, 335, 530, 442, 853, 695, 249, 445, 515, 909, 545, 703, 919, 874, 474,
	882, 500, 594, 612, 641, 801, 220, 162, 819, 984, 589, 513, 495, 799, 161, 604,
	958, 533, 221, 400, 386, 867, 600, 782, 382, 596, 414, 171, 516, 375, 682, 485,
	911, 276, 98, 553, 163, 354, 666, 933, 424, 341, 533, 870, 227, 730, 475, 186,
	263, 647, 537, 686, 600, 224, 469, 68, 770, 919, 190, 373, 294, 822, 808, 206,
	184, 943, 795, 384, 383, 461, 404, 758, 839, 887, 715, 67, 618, 276, 204, 918,
	873, 777, 604, 560, 951, 160, 578, 722, 79, 804, 96, 409, 713, 940, 652, 934,
	970, 447, 318, 353, 859, 672, 112, 785, 645, 863, 803, 350, 139, 93, 354, 99,
	820, 908, 609, 772, 154, 274, 580, 184, 79, 626, 630, 742, 653, 282, 762, 623,
	680, 81, 927, 626, 789, 125, 411, 521, 938, 300, 821, 78, 343, 175, 128, 250,
	170, 774, 972, 275, 999, 639, 495, 78, 352, 126, 857, 956, 358, 619, 580, 124,
	737, 594, 701, 612, 669, 112, 134, 694, 363, 992, 809, 743, 168, 974, 944, 375,
	748, 52, 600, 747, 642, 182, 862, 81, 344, 805, 988, 739, 511, 655, 814, 334,
	249, 515, 897, 955, 664, 981, 649, 113, 974, 459, 893, 228, 433, 837, 553, 268,
	926, 240, 102, 654, 459, 51, 686, 754, 806, 760, 493, 403, 415, 394, 687, 700,
	946, 670, 656, 610, 738, 392, 760, 799, 887, 653, 978, 321, 576, 617, 626, 502,
	894, 679, 243, 440, 680, 879, 194, 572, 640, 724, 926, 56, 204, 700, 707, 151,
	457, 449, 797, 195, 791, 558, 945, 679, 297, 59, 87, 824, 713, 663, 412, 693,
	342, 606, 134, 108, 571, 364, 631, 212, 174, 643, 304, 329, 343, 97, 430, 751,
	497, 314, 983, 374, 822, 928, 140, 206, 73, 263, 980, 736, 876, 478, 430, 305,
	170, 514, 364, 692, 829, 82, 855, 953, 676, 246, 369, 970, 294, 750, 807, 827,
	150, 790, 288, 923, 804, 378, 215, 828, 592, 281, 565, 555, 710, 82, 896, 831,
	547, 261, 524, 462, 293, 465, 502, 56, 661, 821, 976, 991, 658, 869, 905, 758,
	745, 193, 768, 550, 608, 933, 378, 286, 215, 979, 792, 961, 61, 688, 793, 644,
	986, 403, 106, 366, 905, 644, 372, 567, 466, 434, 645, 210, 389, 550, 919, 135,
	780, 773, 635, 389, 707, 100, 626, 958, 165, 504, 920, 176, 193, 713, 857, 265,
	203, 50, 668, 108, 645, 990, 626, 197, 510, 357, 358, 850, 858, 364, 936, 638
];

const BASE_BLOCK_SIZE = 100000;
const MAX_ALPHA_SIZE = 258;
const MAX_CODE_LEN = 23;
const RUNA = 0;
const RUNB = 1;
const N_GROUPS = 6;
const G_SIZE = 50;
const N_ITERS = 4;
const MAX_SELECTORS = 2 + Math.floor(900000 / G_SIZE);
const NUM_OVERSHOOT_BYTES = 20;

const CRC32_TABLE = [
	0x00000000, 0x04c11db7, 0x09823b6e, 0x0d4326d9, 0x130476dc, 0x17c56b6b, 0x1a864db2, 0x1e475005,
	0x2608edb8, 0x22c9f00f, 0x2f8ad6d6, 0x2b4bcb61, 0x350c9b64, 0x31cd86d3, 0x3c8ea00a, 0x384fbdbd,
	0x4c11db70, 0x48d0c6c7, 0x4593e01e, 0x4152fda9, 0x5f15adac, 0x5bd4b01b, 0x569796c2, 0x52568b75,
	0x6a1936c8, 0x6ed82b7f, 0x639b0da6, 0x675a1011, 0x791d4014, 0x7ddc5da3, 0x709f7b7a, 0x745e66cd,
	0x9823b6e0, 0x9ce2ab57, 0x91a18d8e, 0x95609039, 0x8b27c03c, 0x8fe6dd8b, 0x82a5fb52, 0x8664e6e5,
	0xbe2b5b58, 0xbaea46ef, 0xb7a96036, 0xb3687d81, 0xad2f2d84, 0xa9ee3033, 0xa4ad16ea, 0xa06c0b5d,
	0xd4326d90, 0xd0f37027, 0xddb056fe, 0xd9714b49, 0xc7361b4c, 0xc3f706fb, 0xceb42022, 0xca753d95,
	0xf23a8028, 0xf6fb9d9f, 0xfbb8bb46, 0xff79a6f1, 0xe13ef6f4, 0xe5ffeb43, 0xe8bccd9a, 0xec7dd02d,
	0x34867077, 0x30476dc0, 0x3d044b19, 0x39c556ae, 0x278206ab, 0x23431b1c, 0x2e003dc5, 0x2ac12072,
	0x128e9dcf, 0x164f8078, 0x1b0ca6a1, 0x1fcdbb16, 0x018aeb13, 0x054bf6a4, 0x0808d07d, 0x0cc9cdca,
	0x7897ab07, 0x7c56b6b0, 0x71159069, 0x75d48dde, 0x6b93dddb, 0x6f52c06c, 0x6211e6b5, 0x66d0fb02,
	0x5e9f46bf, 0x5a5e5b08, 0x571d7dd1, 0x53dc6066, 0x4d9b3063, 0x495a2dd4, 0x44190b0d, 0x40d816ba,
	0xaca5c697, 0xa864db20, 0xa527fdf9, 0xa1e6e04e, 0xbfa1b04b, 0xbb60adfc, 0xb6238b25, 0xb2e29692,
	0x8aad2b2f, 0x8e6c3698, 0x832f1041, 0x87ee0df6, 0x99a95df3, 0x9d684044, 0x902b669d, 0x94ea7b2a,
	0xe0b41de7, 0xe4750050, 0xe9362689, 0xedf73b3e, 0xf3b06b3b, 0xf771768c, 0xfa325055, 0xfef34de2,
	0xc6bcf05f, 0xc27dede8, 0xcf3ecb31, 0xcbffd686, 0xd5b88683, 0xd1799b34, 0xdc3abded, 0xd8fba05a,
	0x690ce0ee, 0x6dcdfd59, 0x608edb80, 0x644fc637, 0x7a089632, 0x7ec98b85, 0x738aad5c, 0x774bb0eb,
	0x4f040d56, 0x4bc510e1, 0x46863638, 0x42472b8f, 0x5c007b8a, 0x58c1663d, 0x558240e4, 0x51435d53,
	0x251d3b9e, 0x21dc2629, 0x2c9f00f0, 0x285e1d47, 0x36194d42, 0x32d850f5, 0x3f9b762c, 0x3b5a6b9b,
	0x0315d626, 0x07d4cb91, 0x0a97ed48, 0x0e56f0ff, 0x1011a0fa, 0x14d0bd4d, 0x19939b94, 0x1d528623,
	0xf12f560e, 0xf5ee4bb9, 0xf8ad6d60, 0xfc6c70d7, 0xe22b20d2, 0xe6ea3d65, 0xeba91bbc, 0xef68060b,
	0xd727bbb6, 0xd3e6a601, 0xdea580d8, 0xda649d6f, 0xc423cd6a, 0xc0e2d0dd, 0xcda1f604, 0xc960ebb3,
	0xbd3e8d7e, 0xb9ff90c9, 0xb4bcb610, 0xb07daba7, 0xae3afba2, 0xaafbe615, 0xa7b8c0cc, 0xa379dd7b,
	0x9b3660c6, 0x9ff77d71, 0x92b45ba8, 0x9675461f, 0x8832161a, 0x8cf30bad, 0x81b02d74, 0x857130c3,
	0x5d8a9099, 0x594b8d2e, 0x5408abf7, 0x50c9b640, 0x4e8ee645, 0x4a4ffbf2, 0x470cdd2b, 0x43cdc09c,
	0x7b827d21, 0x7f436096, 0x7200464f, 0x76c15bf8, 0x68860bfd, 0x6c47164a, 0x61043093, 0x65c52d24,
	0x119b4be9, 0x155a565e, 0x18197087, 0x1cd86d30, 0x029f3d35, 0x065e2082, 0x0b1d065b, 0x0fdc1bec,
	0x3793a651, 0x3352bbe6, 0x3e119d3f, 0x3ad08088, 0x2497d08d, 0x2056cd3a, 0x2d15ebe3, 0x29d4f654,
	0xc5a92679, 0xc1683bce, 0xcc2b1d17, 0xc8ea00a0, 0xd6ad50a5, 0xd26c4d12, 0xdf2f6bcb, 0xdbee767c,
	0xe3a1cbc1, 0xe760d676, 0xea23f0af, 0xeee2ed18, 0xf0a5bd1d, 0xf464a0aa, 0xf9278673, 0xfde69bc4,
	0x89b8fd09, 0x8d79e0be, 0x803ac667, 0x84fbdbd0, 0x9abc8bd5, 0x9e7d9662, 0x933eb0bb, 0x97ffad0c,
	0xafb010b1, 0xab710d06, 0xa6322bdf, 0xa2f33668, 0xbcb4666d, 0xb8757bda, 0xb5365d03, 0xb1f740b4
];

const START_BLOCK_STATE = 1;
const RAND_PART_A_STATE = 2;
const RAND_PART_B_STATE = 3;
const RAND_PART_C_STATE = 4;
const NO_RAND_PART_A_STATE = 5;
const NO_RAND_PART_B_STATE = 6;
const NO_RAND_PART_C_STATE = 7;

class StrangeCRC {

	constructor() {
		this.globalCrc = -1;
		this.reset();
	}

	reset() {
		this.globalCrc = -1;
	}

	get value() {
		return ~this.globalCrc >>> 0;
	}

	update(value) {
		let index = (this.globalCrc >> 24) ^ value;
		if (index < 0)
			index = 256 + index;

		this.globalCrc = ((this.globalCrc << 8) ^ CRC32_TABLE[index]) | 0;
	}

	updateBuffer(buf, off = 0, len = buf.length) {
		for (let i = 0; i < len; i++)
			this.update(buf[off + i]);
	}
}

class BZip2Exception extends Error {
	constructor(message) {
		super(message);
		this.name = 'BZip2Exception';
	}
}

class BufferInputStream {

	constructor(data) {
		this.data = data;
		this.position = 0;
	}

	readByte() {
		if (this.position >= this.data.length)
			return -1;

		return this.data[this.position++];
	}

	get length() {
		return this.data.length;
	}

	get currentPosition() {
		return this.position;
	}
}

class BZip2InputStream {

	constructor(stream) {
		this.last = 0;
		this.origPtr = 0;
		this.blockSize100k = 0;
		this.blockRandomised = false;

		this.bsBuff = 0;
		this.bsLive = 0;

		this.mCrc = new StrangeCRC();

		this.inUse = new Array(256).fill(false);
		this.nInUse = 0;
		this.seqToUnseq = new Uint8Array(256);
		this.unseqToSeq = new Uint8Array(256);

		this.selector = new Uint8Array(MAX_SELECTORS);
		this.selectorMtf = new Uint8Array(MAX_SELECTORS);

		this.tt = null;
		this.ll8 = null;

		this.unzftab = new Int32Array(256);
		this.limit = [];
		this.baseArray = [];
		this.perm = [];
		this.minLens = new Int32Array(N_GROUPS);

		this.baseStream = stream;
		this.streamEnd = false;

		this.currentChar = -1;
		this.currentState = START_BLOCK_STATE;

		this.storedBlockCRC = 0;
		this.storedCombinedCRC = 0;
		this.computedBlockCRC = 0;
		this.computedCombinedCRC = 0;

		this.count = 0;
		this.chPrev = 0;
		this.ch2 = 0;
		this.tPos = 0;
		this.rNToGo = 0;
		this.rTPos = 0;
		this.i2 = 0;
		this.j2 = 0;
		this.z = 0;

		for (let i = 0; i < N_GROUPS; i++) {
			this.limit[i] = new Int32Array(MAX_ALPHA_SIZE);
			this.baseArray[i] = new Int32Array(MAX_ALPHA_SIZE);
			this.perm[i] = new Int32Array(MAX_ALPHA_SIZE);
		}

		this.initialize();
		this.initBlock();
		this.setupBlock();
	}

	readByte() {
		if (this.streamEnd)
			return -1;

		const current_char = this.currentChar;

		switch (this.currentState) {
			case RAND_PART_B_STATE:
				this.setupRandPartB();
				break;

			case RAND_PART_C_STATE:
				this.setupRandPartC();
				break;

			case NO_RAND_PART_B_STATE:
				this.setupNoRandPartB();
				break;

			case NO_RAND_PART_C_STATE:
				this.setupNoRandPartC();
				break;
		}

		return current_char;
	}

	read(buffer, offset, count) {
		for (let i = 0; i < count; i++) {
			const byte = this.readByte();
			if (byte === -1)
				return i;

			buffer[offset + i] = byte;
		}
		return count;
	}

	initialize() {
		const c1 = this.bsGetUChar();
		const c2 = this.bsGetUChar();
		const c3 = this.bsGetUChar();
		const c4 = this.bsGetUChar();

		if (c1 !== 'B'.charCodeAt(0) || c2 !== 'Z'.charCodeAt(0) || c3 !== 'h'.charCodeAt(0) || c4 < '1'.charCodeAt(0) || c4 > '9'.charCodeAt(0)) {
			this.streamEnd = true;
			throw new BZip2Exception('invalid BZip2 header');
		}

		this.setDecompressStructureSizes(c4 - 0x30);
		this.computedCombinedCRC = 0;
	}

	initBlock() {
		const c1 = this.bsGetUChar();
		const c2 = this.bsGetUChar();
		const c3 = this.bsGetUChar();
		const c4 = this.bsGetUChar();
		const c5 = this.bsGetUChar();
		const c6 = this.bsGetUChar();

		// check for end-of-stream marker (0x177245385090)
		if (c1 === 0x17 && c2 === 0x72 && c3 === 0x45 && c4 === 0x38 && c5 === 0x50 && c6 === 0x90) {
			this.complete();
			return;
		}

		// check for block marker (0x314159265359)
		if (c1 !== 0x31 || c2 !== 0x41 || c3 !== 0x59 || c4 !== 0x26 || c5 !== 0x53 || c6 !== 0x59)
			throw new BZip2Exception('Bad BZip2 block header');

		this.storedBlockCRC = this.bsGetInt32();
		this.blockRandomised = this.bsR(1) === 1;

		this.getAndMoveToFrontDecode();

		this.mCrc.reset();
		this.currentState = START_BLOCK_STATE;
	}

	endBlock() {
		this.computedBlockCRC = this.mCrc.value;

		const stored_crc = this.storedBlockCRC >>> 0;
		const computed_crc = this.computedBlockCRC >>> 0;

		if (stored_crc !== computed_crc)
			throw new BZip2Exception(`BZip2 CRC error. Expected: 0x${stored_crc.toString(16)}, Got: 0x${computed_crc.toString(16)}`);

		this.computedCombinedCRC = (((this.computedCombinedCRC << 1) | (this.computedCombinedCRC >>> 31)) ^ this.computedBlockCRC) >>> 0;
	}

	complete() {
		this.storedCombinedCRC = this.bsGetInt32();

		// Convert both to unsigned 32-bit for comparison
		const stored_crc = this.storedCombinedCRC >>> 0;
		const computed_crc = this.computedCombinedCRC >>> 0;

		if (stored_crc !== computed_crc)
			throw new BZip2Exception(`BZip2 combined CRC error. Expected: 0x${stored_crc.toString(16)}, Got: 0x${computed_crc.toString(16)}`);

		this.streamEnd = true;
	}

	setDecompressStructureSizes(newSize100k) {
		if (newSize100k < 0 || newSize100k > 9)
			throw new BZip2Exception('Invalid block size');

		this.blockSize100k = newSize100k;

		if (newSize100k === 0)
			return;

		const length = BASE_BLOCK_SIZE * newSize100k;
		this.ll8 = new Uint8Array(length);
		this.tt = new Int32Array(length);
	}

	fillBuffer() {
		const byte = this.baseStream.readByte();
		if (byte === -1)
			throw new BZip2Exception('Unexpected end of BZip2 stream');

		this.bsBuff = (this.bsBuff << 8) | (byte & 0xFF);
		this.bsLive += 8;
	}

	bsR(n) {
		while (this.bsLive < n)
			this.fillBuffer();

		const result = (this.bsBuff >> (this.bsLive - n)) & ((1 << n) - 1);
		this.bsLive -= n;
		return result;
	}

	bsGetUChar() {
		return this.bsR(8);
	}

	bsGetInt32() {
		return (((((0 << 8 | this.bsR(8)) << 8 | this.bsR(8)) << 8 | this.bsR(8)) << 8 | this.bsR(8)) | 0);
	}

	bsGetIntVS(numBits) {
		return this.bsR(numBits);
	}

	hbCreateDecodeTables(limit, base, perm, length, minLen, maxLen, alphaSize) {
		let pp = 0;

		for (let i = minLen; i <= maxLen; i++) {
			for (let j = 0; j < alphaSize; j++) {
				if (length[j] === i) {
					perm[pp] = j;
					pp++;
				}
			}
		}

		for (let i = 0; i < MAX_CODE_LEN; i++)
			base[i] = 0;

		for (let i = 0; i < alphaSize; i++)
			base[length[i] + 1]++;

		for (let i = 1; i < MAX_CODE_LEN; i++)
			base[i] += base[i - 1];

		for (let i = 0; i < MAX_CODE_LEN; i++)
			limit[i] = 0;

		let vec = 0;
		for (let i = minLen; i <= maxLen; i++) {
			const nb = base[i + 1] - base[i];
			vec += nb;
			limit[i] = vec - 1;
			vec <<= 1;
		}

		for (let i = minLen + 1; i <= maxLen; i++)
			base[i] = ((limit[i - 1] + 1) << 1) - base[i];
	}

	recvDecodingTables() {
		const len = [];
		for (let i = 0; i < N_GROUPS; i++)
			len[i] = new Array(MAX_ALPHA_SIZE);

		const in_use_16 = new Array(16).fill(false);
		for (let i = 0; i < 16; i++)
			in_use_16[i] = this.bsR(1) === 1;

		for (let i = 0; i < 16; i++) {
			if (in_use_16[i]) {
				for (let j = 0; j < 16; j++)
					this.inUse[i * 16 + j] = this.bsR(1) === 1;
			} else {
				for (let j = 0; j < 16; j++)
					this.inUse[i * 16 + j] = false;
			}
		}

		this.makeMaps();
		const alpha_size = this.nInUse + 2;

		const n_groups = this.bsR(3);
		const n_selectors = this.bsR(15);

		for (let i = 0; i < n_selectors; i++) {
			let j = 0;
			while (this.bsR(1) === 1)
				j++;

			this.selectorMtf[i] = j;
		}

		// undo mtf
		const pos = new Uint8Array(N_GROUPS);
		for (let i = 0; i < n_groups; i++)
			pos[i] = i;

		for (let i = 0; i < n_selectors; i++) {
			const v = this.selectorMtf[i];
			const tmp = pos[v];
			for (let j = v; j > 0; j--)
				pos[j] = pos[j - 1];

			pos[0] = tmp;
			this.selector[i] = tmp;
		}

		for (let t = 0; t < n_groups; t++) {
			let curr = this.bsR(5);
			for (let i = 0; i < alpha_size; i++) {
				while (this.bsR(1) === 1) {
					if (this.bsR(1) === 0) {
						curr++;
					} else {
						curr--;
					}
				}
				len[t][i] = curr;
			}
		}

		for (let t = 0; t < n_groups; t++) {
			let min_len = 32;
			let max_len = 0;

			for (let i = 0; i < alpha_size; i++) {
				max_len = Math.max(max_len, len[t][i]);
				min_len = Math.min(min_len, len[t][i]);
			}

			this.hbCreateDecodeTables(this.limit[t], this.baseArray[t], this.perm[t], len[t], min_len, max_len, alpha_size);
			this.minLens[t] = min_len;
		}
	}

	makeMaps() {
		this.nInUse = 0;
		for (let i = 0; i < 256; i++) {
			if (this.inUse[i]) {
				this.seqToUnseq[this.nInUse] = i;
				this.unseqToSeq[i] = this.nInUse;
				this.nInUse++;
			}
		}
	}

	getAndMoveToFrontDecode() {
		const yy = new Uint8Array(256);
		const block_size = BASE_BLOCK_SIZE * this.blockSize100k;

		this.origPtr = this.bsGetIntVS(24);
		this.recvDecodingTables();

		const EOB = this.nInUse + 1;
		let group_no = -1;
		let group_pos = 0;

		// unzftab
		for (let i = 0; i <= 255; i++)
			this.unzftab[i] = 0;

		// yy (MTF list)
		for (let i = 0; i <= 255; i++)
			yy[i] = i;

		this.last = -1;

		if (group_pos === 0) {
			group_no++;
			group_pos = G_SIZE;
		}

		group_pos--;

		const zt = this.selector[group_no];
		let zn = this.minLens[zt];
		let zvec = this.bsR(zn);

		while (zvec > this.limit[zt][zn]) {
			if (zn > 20)
				throw new BZip2Exception('huffman code length exceeds maximum');

			zn++;
			while (this.bsLive < 1)
				this.fillBuffer();

			const zj = (this.bsBuff >> (this.bsLive - 1)) & 1;
			this.bsLive--;
			zvec = (zvec << 1) | zj;
		}

		if (zvec - this.baseArray[zt][zn] < 0 || zvec - this.baseArray[zt][zn] >= MAX_ALPHA_SIZE)
			throw new BZip2Exception('huffman decode error');

		let next_sym = this.perm[zt][zvec - this.baseArray[zt][zn]];

		while (next_sym !== EOB) {
			if (next_sym === RUNA || next_sym === RUNB) {
				let es = -1;
				let N = 1;

				do {
					if (next_sym === RUNA) {
						es += N;
					} else if (next_sym === RUNB) {
						es += 2 * N;
					}

					N <<= 1;

					if (group_pos === 0) {
						group_no++;
						group_pos = G_SIZE;
					}

					group_pos--;

					const zt = this.selector[group_no];
					let zn = this.minLens[zt];
					let zvec = this.bsR(zn);

					while (zvec > this.limit[zt][zn]) {
						zn++;
						while (this.bsLive < 1)
							this.fillBuffer();

						const zj = (this.bsBuff >> (this.bsLive - 1)) & 1;
						this.bsLive--;
						zvec = (zvec << 1) | zj;
					}

					next_sym = this.perm[zt][zvec - this.baseArray[zt][zn]];
				} while (next_sym === RUNA || next_sym === RUNB);

				es++;
				const ch = this.seqToUnseq[yy[0]];
				this.unzftab[ch] += es;

				for (let i = 0; i < es; i++) {
					this.last++;
					this.ll8[this.last] = ch;
				}

				if (this.last >= block_size)
					throw new BZip2Exception('block overrun');
			} else {
				// reg symbol
				this.last++;
				if (this.last >= block_size)
					throw new BZip2Exception('block overrun');

				const tmp = yy[next_sym - 1];
				this.unzftab[this.seqToUnseq[tmp]]++;
				this.ll8[this.last] = this.seqToUnseq[tmp];

				// move to front
				for (let j = next_sym - 1; j > 0; j--)
					yy[j] = yy[j - 1];

				yy[0] = tmp;

				if (group_pos === 0) {
					group_no++;
					group_pos = G_SIZE;
				}

				group_pos--;

				const zt = this.selector[group_no];
				let zn = this.minLens[zt];
				let zvec = this.bsR(zn);

				while (zvec > this.limit[zt][zn]) {
					zn++;
					while (this.bsLive < 1)
						this.fillBuffer();

					const zj = (this.bsBuff >> (this.bsLive - 1)) & 1;
					this.bsLive--;
					zvec = (zvec << 1) | zj;
				}

				next_sym = this.perm[zt][zvec - this.baseArray[zt][zn]];
			}
		}
	}

	setupBlock() {
		if (this.ll8 === null || this.tt === null)
			throw new BZip2Exception('block not initialized');

		// Build inverse BWT pointer array
		const cftab = new Int32Array(257);
		cftab[0] = 0;

		for (let i = 1; i <= 256; i++)
			cftab[i] = this.unzftab[i - 1];

		for (let i = 1; i <= 256; i++)
			cftab[i] += cftab[i - 1];

		for (let i = 0; i <= this.last; i++) {
			const ch = this.ll8[i];
			this.tt[cftab[ch]] = i;
			cftab[ch]++;
		}

		this.tPos = this.tt[this.origPtr];
		this.count = 0;
		this.i2 = 0;
		this.ch2 = 256;

		if (this.blockRandomised) {
			this.rNToGo = 0;
			this.rTPos = 0;
			this.setupRandPartA();
		} else {
			this.setupNoRandPartA();
		}
	}

	setupRandPartA() {
		if (this.i2 <= this.last) {
			this.chPrev = this.ch2;
			this.ch2 = this.ll8[this.tPos];
			this.tPos = this.tt[this.tPos];

			if (this.rNToGo === 0) {
				this.rNToGo = R_NUMS[this.rTPos];
				this.rTPos++;
				if (this.rTPos === 512)
					this.rTPos = 0;
			}
			this.rNToGo--;
			this.ch2 ^= (this.rNToGo === 1) ? 1 : 0;

			this.i2++;
			this.currentChar = this.ch2;
			this.currentState = RAND_PART_B_STATE;
			this.mCrc.update(this.ch2);
		} else {
			this.endBlock();
			this.initBlock();
			this.setupBlock();
		}
	}

	setupRandPartB() {
		if (this.ch2 !== this.chPrev) {
			this.currentState = RAND_PART_A_STATE;
			this.count = 1;
			this.setupRandPartA();
		} else {
			this.count++;
			if (this.count >= 4) {
				this.z = this.ll8[this.tPos];
				this.tPos = this.tt[this.tPos];

				if (this.rNToGo === 0) {
					this.rNToGo = R_NUMS[this.rTPos];
					this.rTPos++;
					if (this.rTPos === 512)
						this.rTPos = 0;
				}
				this.rNToGo--;
				this.z ^= (this.rNToGo === 1) ? 1 : 0;

				this.j2 = 0;
				this.currentState = RAND_PART_C_STATE;
				this.setupRandPartC();
			} else {
				this.currentState = RAND_PART_A_STATE;
				this.setupRandPartA();
			}
		}
	}

	setupRandPartC() {
		if (this.j2 < this.z) {
			this.currentChar = this.ch2;
			this.mCrc.update(this.ch2);
			this.j2++;
		} else {
			this.currentState = RAND_PART_A_STATE;
			this.i2++;
			this.count = 0;
			this.setupRandPartA();
		}
	}

	setupNoRandPartA() {
		if (this.i2 <= this.last) {
			this.chPrev = this.ch2;
			this.ch2 = this.ll8[this.tPos];
			this.tPos = this.tt[this.tPos];
			this.i2++;

			this.currentChar = this.ch2;
			this.currentState = NO_RAND_PART_B_STATE;
			this.mCrc.update(this.ch2);
		} else {
			this.endBlock();
			this.initBlock();
			this.setupBlock();
		}
	}

	setupNoRandPartB() {
		if (this.ch2 !== this.chPrev) {
			this.currentState = NO_RAND_PART_A_STATE;
			this.count = 1;
			this.setupNoRandPartA();
		} else {
			this.count++;
			if (this.count >= 4) {
				this.z = this.ll8[this.tPos];
				this.tPos = this.tt[this.tPos];
				this.currentState = NO_RAND_PART_C_STATE;
				this.j2 = 0;
				this.setupNoRandPartC();
			} else {
				this.currentState = NO_RAND_PART_A_STATE;
				this.setupNoRandPartA();
			}
		}
	}

	setupNoRandPartC() {
		if (this.j2 < this.z) {
			this.currentChar = this.ch2;
			this.mCrc.update(this.ch2);
			this.j2++;
		} else {
			this.currentState = NO_RAND_PART_A_STATE;
			this.i2++;
			this.count = 0;
			this.setupNoRandPartA();
		}
	}
}

function bzip2_decompress(compressed_data, expected_length) {
	const input_stream = new BufferInputStream(compressed_data);
	const decompressor = new BZip2InputStream(input_stream);

	const output_chunks = [];
	let total_length = 0;

	const chunk_size = expected_length ? Math.min(expected_length, 65536) : 65536;

	while (true) {
		const chunk = new Uint8Array(chunk_size);
		let bytes_read = 0;

		// Read into chunk
		for (let i = 0; i < chunk_size; i++) {
			const byte = decompressor.readByte();
			if (byte === -1)
				break;

			chunk[i] = byte;
			bytes_read++;
		}

		if (bytes_read === 0)
			break;

		if (bytes_read === chunk_size) {
			output_chunks.push(chunk);
		} else {
			output_chunks.push(chunk.slice(0, bytes_read));
		}

		total_length += bytes_read;

		if (bytes_read < chunk_size)
			break;
	}

	if (output_chunks.length === 0)
		return new Uint8Array(0);

	if (output_chunks.length === 1)
		return output_chunks[0];

	const result = new Uint8Array(total_length);
	let offset = 0;

	for (const chunk of output_chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}

	return result;
}

export { bzip2_decompress };
