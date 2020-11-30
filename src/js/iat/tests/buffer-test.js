/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const assert = require('assert');
const BufferWrapper = require('../../buffer');
const IntegrationTest = require('../integration-test');

class BufferTest extends IntegrationTest {
	/**
	 * Returns the individual tests for this test unit.
	 * @returns {function[]}
	 */
	get tests() {
		return [
			this.testBufferConstruction,
			this.testBufferString,
			this.testBufferIndexOf,
			this.testBufferAllocation
		]
	}

	/**
	 * Test basic BufferWrapper class construction.
	 */
	testBufferConstruction() {
		const raw = Buffer.from('BOLDLY, YOU SOUGHT THE POWER OF RAGNAROS. NOW YOU SHALL SEE IT FIRSTHAND!');
		const buf = new BufferWrapper(raw);

		assert.strictEqual(buf.byteLength, raw.byteLength, 'Wrapped buffer size does not match source node buffer size');
		assert.strictEqual(buf.offset, 0, 'Non-zero offset in newly wrapped buffer.');

		for (let i = 0; i < raw.byteLength; i++)
			assert.strictEqual(buf.readInt8(), raw[i], 'Wrapped buffed does not match source node buffer');

		assert.fail('Some kind of test failure');
	}

	/**
	 * Test construction of a BufferWrapper from a string and readString() functionality.
	 */
	testBufferString() {
		const text = 'Keep your feet on the ground.';
		const textByteLength = Buffer.byteLength(text);
	
		const buf = BufferWrapper.from(text);
		assert.strictEqual(buf.byteLength, Buffer.byteLength(text), 'Buffer from string does not match string length');
	
		// Read full string back from buffer.
		const outFull = buf.readString(textByteLength);
		assert.strictEqual(outFull, text, 'readString(x) does not return expected string');
	
		buf.seek(0);
	
		// Read entire buffer as a string.
		const outAll = buf.readString();
		assert.strictEqual(outAll, text, 'readString() does not return expected string');
	
		buf.seek(0);
	
		// Read partial string.
		const outShort = buf.readString(6);
		assert.strictEqual(outShort, text.slice(0, 6), 'readString(x) does not return expected string');

		// Read encoded string (hex).
		buf.seek(0);
		const hexExpected = Buffer.from(text).toString('hex');
		const hexActual = buf.readString(-1, 'hex');
		assert.strictEqual(hexActual, hexExpected, 'readString(-1, hex) does not return expected hex string');
	}

	/**
	 * Test BufferWrapper.indexOf() functionality.
	 */
	testBufferIndexOf() {
		const buf = BufferWrapper.from('The Brotherhood shall prevail');
		const startOffset = buf.offset;
	
		// Obtain position of a given numerical character from the start of the buffer.
		assert.strictEqual(buf.indexOf(0x70, 0), 22, 'indexOf(number, 0) did not return correct character position');
		assert.strictEqual(buf.offset, startOffset, 'indexOf(number, 0) did not reset cursor properly');
	
		// Obtain position of a given string character from the start of the buffer.
		assert.strictEqual(buf.indexOf('B', 0), 4, 'indexOf(char, 0) did not return correct character position');
		assert.strictEqual(buf.offset, startOffset, 'indexOf(char, 0) did not reset cursor properly');
	
		// Obtain position of a given character, from the start of the cursor (default start index).
		buf.seek(22);
		assert.strictEqual(buf.indexOf('a'), 26, 'indexOf(char) did not return correct character position');
		assert.strictEqual(buf.offset, 22, 'indexOf(char) did not reset cursor properly');
		buf.seek(startOffset);
	
		// Obtain position of a character that does not exist in the string.
		assert.strictEqual(buf.indexOf('x', 0), -1, 'indexOf(char) did not return -1 for non-existent character');
		assert.strictEqual(buf.offset, startOffset, 'indexOf(char) did not reset cursor after non-existent character');
	
		// Obtain position of character that is in string, but before cursor.
		assert.strictEqual(buf.indexOf('B', 22), -1, 'indexOf(char) did not return -1 for character before cursor');
		assert.strictEqual(buf.offset, startOffset, 'indexOf(char) did not reset cursor after pre-cursor character');
	
		// Providing a string rather than a single character should throw.
		assert.throws(() => buf.indexOf('Anduin'), 'indexOf(string) did not throw an error');
	}

	/**
	 * Test allocation of a buffer wrapper.
	 */
	testBufferAllocation() {
		const unsafeAllocBuf = BufferWrapper.alloc(42, false);
		assert.strictEqual(unsafeAllocBuf.byteLength, 42, 'Incorrect buffer size on unsafe allocation');
		assert.strictEqual(unsafeAllocBuf.offset, 0, 'Non-zero offset on buffer unsafe allocation');

		const safeAllocBuf = BufferWrapper.alloc(32, true);
		assert.strictEqual(safeAllocBuf.byteLength, 32, 'Incorrect buffer size on safe allocation');
		assert.strictEqual(safeAllocBuf.offset, 0, 'Non-zero offset safe buffer allocation');

		for (let i = 0; i < 32; i++)
			assert.strictEqual(unsafeAllocBuf.readUInt8(), 0x0, 'Non-zero value in safe buffer allocation');
	}
}

module.exports = BufferTest;