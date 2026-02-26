/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

class BitStream {
	constructor(data) {
		this.data = data;
		this.position = 0;
		this.current = 0;
		this.bitCount = 0;
	}

	get bytePosition() {
		return this.position;
	}

	get length() {
		return this.data.length;
	}

	readBits(bitCount) {
		if (bitCount > 16)
			throw new Error(`maximum bitCount is 16, got ${bitCount}`);

		if (!this.ensureBits(bitCount))
			return -1;

		const mask = (1 << bitCount) - 1;
		const result = this.current & mask;

		this.wasteBits(bitCount);
		return result;
	}

	peekByte() {
		if (!this.ensureBits(8))
			return -1;

		return this.current & 0xFF;
	}

	ensureBits(bitCount) {
		while (this.bitCount < bitCount) {
			if (this.position >= this.data.length)
				return false;

			this.current |= this.data[this.position++] << this.bitCount;
			this.bitCount += 8;
		}
		return true;
	}

	wasteBits(bitCount) {
		this.current >>>= bitCount;
		this.bitCount -= bitCount;
	}
}

export default BitStream;
