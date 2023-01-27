/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
/* Based off original works by Robert John Jenkins Junior (Port by bryc). (https://en.wikipedia.org/wiki/Jenkins_hash_function) */
module.exports = (k, init = 0, init2 = 0) => {
	let len = k.length, o = 0,
		a = 0xDEADBEEF + len + init | 0,
		b = 0xDEADBEEF + len + init | 0,
		c = 0xDEADBEEF + len + init + init2 | 0;

	while (len > 12) {
		a += k[o]   | k[o+1] << 8 | k[o+2]  << 16 | k[o+3]  << 24;
		b += k[o+4] | k[o+5] << 8 | k[o+6]  << 16 | k[o+7]  << 24;
		c += k[o+8] | k[o+9] << 8 | k[o+10] << 16 | k[o+11] << 24;

		a -= c; a ^= c<<4  | c>>>28; c = c+b | 0;
		b -= a; b ^= a<<6  | a>>>26; a = a+c | 0;
		c -= b; c ^= b<<8  | b>>>24; b = b+a | 0;
		a -= c; a ^= c<<16 | c>>>16; c = c+b | 0;
		b -= a; b ^= a<<19 | a>>>13; a = a+c | 0;
		c -= b; c ^= b<<4  | b>>>28; b = b+a | 0;

		len -= 12, o += 12;
	}

	if (len > 0) { // final mix only if len > 0
		switch (len) { // incorporate trailing bytes before fmix
		case 12: c += k[o+11] << 24; break;
		case 11: c += k[o+10] << 16; break;
		case 10: c += k[o+9] << 8; break;
		case 9: c += k[o+8]; break;
		case 8: b += k[o+7] << 24; break;
		case 7: b += k[o+6] << 16; break;
		case 6: b += k[o+5] << 8; break;
		case 5: b += k[o+4]; break;
		case 4: a += k[o+3] << 24; break;
		case 3: a += k[o+2] << 16; break;
		case 2: a += k[o+1] << 8; break;
		case 1: a += k[o]; break;
		}

		c ^= b; c -= b<<14 | b>>>18;
		a ^= c; a -= c<<11 | c>>>21;
		b ^= a; b -= a<<25 | a>>>7;
		c ^= b; c -= b<<16 | b>>>16;
		a ^= c; a -= c<<4  | c>>>28;
		b ^= a; b -= a<<14 | a>>>18;
		c ^= b; c -= b<<24 | b>>>8;
	}
	// use c as 32-bit hash; add b for 64-bit hash. a is not mixed well.
	return [b >>> 0, c >>> 0];
};