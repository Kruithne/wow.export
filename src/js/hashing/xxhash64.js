/*!
	xxHash64 (native BigInt rewrite)
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>

	Original Implementation
	js-xxhash (https://github.com/pierrec/js-xxhash)
	Authors: Pierre Curto (2016)

	License: MIT
*/

const PRIME64_1 = 11400714785074694791n;
const PRIME64_2 = 14029467366897019727n;
const PRIME64_3 = 1609587929392839161n;
const PRIME64_4 = 9650029242287828579n;
const PRIME64_5 = 2870177450012600261n;
const MASK_64 = 0xFFFFFFFFFFFFFFFFn;

function toUTF8Array(str) {
	const utf8 = [];
	for (let i = 0, n = str.length; i < n; i++) {
		let charcode = str.charCodeAt(i);
		if (charcode < 0x80)
			utf8.push(charcode);
		else if (charcode < 0x800) {
			utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
		}
		else if (charcode < 0xd800 || charcode >= 0xe000) {
			utf8.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
		}
		else {
			i++;
			charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
			utf8.push(0xf0 | (charcode >> 18), 0x80 | ((charcode >> 12) & 0x3f), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
		}
	}

	return new Uint8Array(utf8);
}

function rotl64(value, n) {
	return ((value << BigInt(n)) | (value >> (64n - BigInt(n)))) & MASK_64;
}

function read_u64_le(input, p) {
	return BigInt(input[p]) |
		(BigInt(input[p + 1]) << 8n) |
		(BigInt(input[p + 2]) << 16n) |
		(BigInt(input[p + 3]) << 24n) |
		(BigInt(input[p + 4]) << 32n) |
		(BigInt(input[p + 5]) << 40n) |
		(BigInt(input[p + 6]) << 48n) |
		(BigInt(input[p + 7]) << 56n);
}

function read_u32_le(input, p) {
	return BigInt(input[p]) |
		(BigInt(input[p + 1]) << 8n) |
		(BigInt(input[p + 2]) << 16n) |
		(BigInt(input[p + 3]) << 24n);
}

function XXH64(input_data, seed) {
	if (arguments.length === 2)
		return new XXH64_state(seed).update(input_data).digest();

	if (arguments.length === 1)
		return new XXH64_state(0).update(input_data).digest();

	if (!(this instanceof XXH64))
		return new XXH64(input_data);

	this.init(input_data);
}

function XXH64_state(seed) {
	this.init(seed);
}

XXH64_state.prototype.init = function(seed) {
	if (seed === undefined || seed === null)
		seed = 0n;
	else if (typeof seed === 'bigint')
		seed = seed;
	else if (typeof seed === 'number')
		seed = BigInt(seed);
	else
		seed = 0n;

	this.seed = seed & MASK_64;
	this.v1 = (this.seed + PRIME64_1 + PRIME64_2) & MASK_64;
	this.v2 = (this.seed + PRIME64_2) & MASK_64;
	this.v3 = this.seed;
	this.v4 = (this.seed - PRIME64_1) & MASK_64;
	this.total_len = 0;
	this.memsize = 0;
	this.memory = null;

	return this;
};

XXH64_state.prototype.update = function(input) {
	if (typeof input === 'string')
		input = toUTF8Array(input);

	if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer)
		input = new Uint8Array(input);

	let p = 0;
	const len = input.length;
	const bEnd = p + len;

	if (len === 0)
		return this;

	this.total_len += len;

	if (this.memsize === 0)
		this.memory = new Uint8Array(32);

	if (this.memsize + len < 32) {
		this.memory.set(input.subarray(0, len), this.memsize);
		this.memsize += len;
		return this;
	}

	if (this.memsize > 0) {
		this.memory.set(input.subarray(0, 32 - this.memsize), this.memsize);

		let p64 = 0;
		let other;

		other = read_u64_le(this.memory, p64);
		this.v1 = (this.v1 + (other * PRIME64_2) & MASK_64) & MASK_64;
		this.v1 = rotl64(this.v1, 31);
		this.v1 = (this.v1 * PRIME64_1) & MASK_64;
		p64 += 8;

		other = read_u64_le(this.memory, p64);
		this.v2 = (this.v2 + (other * PRIME64_2) & MASK_64) & MASK_64;
		this.v2 = rotl64(this.v2, 31);
		this.v2 = (this.v2 * PRIME64_1) & MASK_64;
		p64 += 8;

		other = read_u64_le(this.memory, p64);
		this.v3 = (this.v3 + (other * PRIME64_2) & MASK_64) & MASK_64;
		this.v3 = rotl64(this.v3, 31);
		this.v3 = (this.v3 * PRIME64_1) & MASK_64;
		p64 += 8;

		other = read_u64_le(this.memory, p64);
		this.v4 = (this.v4 + (other * PRIME64_2) & MASK_64) & MASK_64;
		this.v4 = rotl64(this.v4, 31);
		this.v4 = (this.v4 * PRIME64_1) & MASK_64;

		p += 32 - this.memsize;
		this.memsize = 0;
	}

	if (p <= bEnd - 32) {
		const limit = bEnd - 32;

		do {
			let other;

			other = read_u64_le(input, p);
			this.v1 = (this.v1 + (other * PRIME64_2) & MASK_64) & MASK_64;
			this.v1 = rotl64(this.v1, 31);
			this.v1 = (this.v1 * PRIME64_1) & MASK_64;
			p += 8;

			other = read_u64_le(input, p);
			this.v2 = (this.v2 + (other * PRIME64_2) & MASK_64) & MASK_64;
			this.v2 = rotl64(this.v2, 31);
			this.v2 = (this.v2 * PRIME64_1) & MASK_64;
			p += 8;

			other = read_u64_le(input, p);
			this.v3 = (this.v3 + (other * PRIME64_2) & MASK_64) & MASK_64;
			this.v3 = rotl64(this.v3, 31);
			this.v3 = (this.v3 * PRIME64_1) & MASK_64;
			p += 8;

			other = read_u64_le(input, p);
			this.v4 = (this.v4 + (other * PRIME64_2) & MASK_64) & MASK_64;
			this.v4 = rotl64(this.v4, 31);
			this.v4 = (this.v4 * PRIME64_1) & MASK_64;
			p += 8;
		} while (p <= limit);
	}

	if (p < bEnd) {
		this.memory.set(input.subarray(p, bEnd), this.memsize);
		this.memsize = bEnd - p;
	}

	return this;
};

XXH64_state.prototype.digest = function() {
	const input = this.memory;
	let p = 0;
	const bEnd = this.memsize;
	let h64;

	if (this.total_len >= 32) {
		h64 = rotl64(this.v1, 1);
		h64 = (h64 + rotl64(this.v2, 7)) & MASK_64;
		h64 = (h64 + rotl64(this.v3, 12)) & MASK_64;
		h64 = (h64 + rotl64(this.v4, 18)) & MASK_64;

		let v1_temp = (this.v1 * PRIME64_2) & MASK_64;
		v1_temp = rotl64(v1_temp, 31);
		v1_temp = (v1_temp * PRIME64_1) & MASK_64;
		h64 = (h64 ^ v1_temp) & MASK_64;
		h64 = (h64 * PRIME64_1) & MASK_64;
		h64 = (h64 + PRIME64_4) & MASK_64;

		let v2_temp = (this.v2 * PRIME64_2) & MASK_64;
		v2_temp = rotl64(v2_temp, 31);
		v2_temp = (v2_temp * PRIME64_1) & MASK_64;
		h64 = (h64 ^ v2_temp) & MASK_64;
		h64 = (h64 * PRIME64_1) & MASK_64;
		h64 = (h64 + PRIME64_4) & MASK_64;

		let v3_temp = (this.v3 * PRIME64_2) & MASK_64;
		v3_temp = rotl64(v3_temp, 31);
		v3_temp = (v3_temp * PRIME64_1) & MASK_64;
		h64 = (h64 ^ v3_temp) & MASK_64;
		h64 = (h64 * PRIME64_1) & MASK_64;
		h64 = (h64 + PRIME64_4) & MASK_64;

		let v4_temp = (this.v4 * PRIME64_2) & MASK_64;
		v4_temp = rotl64(v4_temp, 31);
		v4_temp = (v4_temp * PRIME64_1) & MASK_64;
		h64 = (h64 ^ v4_temp) & MASK_64;
		h64 = (h64 * PRIME64_1) & MASK_64;
		h64 = (h64 + PRIME64_4) & MASK_64;
	}
	else {
		h64 = (this.seed + PRIME64_5) & MASK_64;
	}

	h64 = (h64 + BigInt(this.total_len)) & MASK_64;

	while (p <= bEnd - 8) {
		let u = read_u64_le(input, p);
		u = (u * PRIME64_2) & MASK_64;
		u = rotl64(u, 31);
		u = (u * PRIME64_1) & MASK_64;
		h64 = (h64 ^ u) & MASK_64;
		h64 = rotl64(h64, 27);
		h64 = (h64 * PRIME64_1) & MASK_64;
		h64 = (h64 + PRIME64_4) & MASK_64;
		p += 8;
	}

	if (p + 4 <= bEnd) {
		let u = read_u32_le(input, p);
		h64 = (h64 ^ ((u * PRIME64_1) & MASK_64)) & MASK_64;
		h64 = rotl64(h64, 23);
		h64 = (h64 * PRIME64_2) & MASK_64;
		h64 = (h64 + PRIME64_3) & MASK_64;
		p += 4;
	}

	while (p < bEnd) {
		let u = BigInt(input[p++]);
		h64 = (h64 ^ ((u * PRIME64_5) & MASK_64)) & MASK_64;
		h64 = rotl64(h64, 11);
		h64 = (h64 * PRIME64_1) & MASK_64;
	}

	h64 = (h64 ^ (h64 >> 33n)) & MASK_64;
	h64 = (h64 * PRIME64_2) & MASK_64;
	h64 = (h64 ^ (h64 >> 29n)) & MASK_64;
	h64 = (h64 * PRIME64_3) & MASK_64;
	h64 = (h64 ^ (h64 >> 32n)) & MASK_64;

	this.init(this.seed);

	return h64;
};

XXH64.prototype = XXH64_state.prototype;

module.exports = XXH64;
