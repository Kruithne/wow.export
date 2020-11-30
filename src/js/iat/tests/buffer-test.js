/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const assert = require('assert');
const BufferWrapper = require('../../buffer');
const IntegrationTest = require('../integration-test');

// TODO: Add test for getDataURL / revokeDataURL.
// TODO: Add test for deflate().
// TODO: Add test for writeToFile()/readFile()
// TODO: Add test for writeBuffer()/readBuffer()
// TODO: Add integer/float read/write tests.
// TODO: Add test for readHexString()

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
			this.testBufferAllocation,
			this.testRawProperties,
			this.testBufferFrom,
			this.testBufferNavigation,
			this.testBufferCRC32,
			this.testBufferReadLines,
			this.testBufferCalculateHash,
			this.testBufferSetCapacity,
			this.testBufferIsZeroed
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
		assert.strictEqual(buf.remainingBytes, raw.byteLength, 'Unexpected amount of remaining bytes after construction');

		for (let i = 0; i < raw.byteLength; i++)
			assert.strictEqual(buf.readInt8(), raw[i], 'Wrapped buffed does not match source node buffer');
	}

	/**
	 * Test functionality of the BufferWrapper.from() static constructor.
	 */
	testBufferFrom() {
		const str = 'Stand and deliver.';
		const raw = Buffer.from(str);
		const buf = BufferWrapper.from(str);

		assert.strictEqual(buf.byteLength, raw.byteLength, 'Size of Buffer.from() and BufferWrapper.from() do not match');
		assert.strictEqual(buf.offset, 0, 'Non-zero offset for BufferWrapper.from() construction')
		assert.strictEqual(buf.remainingBytes, raw.byteLength, 'Unexpected amount of remaining bytes after BufferWrapper.from() construction');

		for (let i = 0; i < raw.byteLength; i++)
			assert.strictEqual(buf.readInt8(), raw[i], 'Contents of Buffer.from() does not match BufferWrapper.from()');
	}

	/**
	 * Test the return value of BufferWrapper.raw and BufferWrapper.internalArrayBuffer.
	 */
	testRawProperties() {
		const raw = Buffer.from('Hello, world!');
		const buf = new BufferWrapper(raw);

		assert.strictEqual(buf.raw, raw, 'BufferWrapper.raw does not return the given buffer instance');
		assert.strictEqual(buf.internalArrayBuffer, raw.buffer, 'BufferWrapper.internalArrayBuffer does not return the correct instance');
	}

	testBufferNavigation() {
		const buf = BufferWrapper.from('This string is 28 bytes long');
		
		// A newly constructed BufferWrapper should always start with an offset of zero.
		assert.strictEqual(buf.offset, 0, 'Buffer does not start at zero offset');

		// Seek to every in-bounds position and validate offset/remainingBytes.
		for (let i = 0; i < 29; i++) {
			buf.seek(i);
			assert.strictEqual(buf.offset, i, 'Buffer did not seek() to correct index');
			assert.strictEqual(buf.remainingBytes, 28 - i, 'Unexpected remaining bytes after seek()');
		}

		// Seeking with a negative value seeks from the end of the buffer.
		buf.seek(-8);
		assert.strictEqual(buf.offset, 20, 'Buffer did not seek to correct negative offset');

		// Attempt to seek out-of-bounds in both directions.
		assert.throws(() => buf.seek(buf.byteLength + 1), 'Buffer did not throw when seeking out of bounds');
		assert.throws(() => buf.seek(-(buf.byteLength + 1)), 'Buffer did not throw when seeking out of bounds (negative)');

		// Reset to offset 5 and move forward zero bytes. The offset should remain at 5.
		buf.seek(5);
		buf.move(0);
		assert.strictEqual(buf.offset, 5, 'Buffer offset moved after calling move(0)');

		// Move some bytes in both directions and validate offset.
		buf.move(5);
		assert.strictEqual(buf.offset, 10, 'Buffer at unexpected offset after move(5)');
		buf.move(-7);
		assert.strictEqual(buf.offset, 3, 'Buffer at unexpected offset after move(-7)');

		// Attempt to move out-of-bounds in both directions.
		buf.seek(0);
		assert.throws(() => buf.move(40), 'Buffer did not throw when moving out of bounds');
		assert.throws(() => buf.move(-40), 'Buffer did not throw when moving out of bounds (negative)');
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
		// Allocate an unsafe buffer and verify initial values.
		const unsafeAllocBuf = BufferWrapper.alloc(42, false);
		assert.strictEqual(unsafeAllocBuf.byteLength, 42, 'Incorrect buffer size on unsafe allocation');
		assert.strictEqual(unsafeAllocBuf.offset, 0, 'Non-zero offset on buffer unsafe allocation');
		assert.strictEqual(unsafeAllocBuf.remainingBytes, 42, 'Unexpected amount of remaining bytes after unsafe allocation');

		// Allocate a safe buffer and verify initial values.
		const safeAllocBuf = BufferWrapper.alloc(32, true);
		assert.strictEqual(safeAllocBuf.byteLength, 32, 'Incorrect buffer size on safe allocation');
		assert.strictEqual(safeAllocBuf.offset, 0, 'Non-zero offset safe buffer allocation');
		assert.strictEqual(safeAllocBuf.remainingBytes, 32, 'Unexpected amount of remaining bytes after safe allocation');

		// A safely allocated buffer should be zeroed.
		for (let i = 0; i < 32; i++)
			assert.strictEqual(unsafeAllocBuf.readUInt8(), 0x0, 'Non-zero value in safe buffer allocation');
	}

	/**
	 * Test BufferWrapper.getCRC32() return value.
	 */
	testBufferCRC32() {
		const buf = BufferWrapper.from('I bless the rains down in Africa.');
		assert.strictEqual(buf.getCRC32(), -555790484, 'CRC32 mismatch');
	}

	/**
	 * Test BufferWrapper.calculateHash() return values.
	 */
	testBufferCalculateHash() {
		const buf = BufferWrapper.from('We do what we must, because, we can.');
		assert.strictEqual(buf.calculateHash('md5'), 'aee2eb3a016fec70d3dc867a7affe73d', 'MD5 hash mismatch');
		assert.strictEqual(buf.calculateHash('sha1'), 'bbda825e691c4adff5fe646f10e3786722541d31', 'SHA-1 hash mismatch');
	}

	/**
	 * Test BufferWrapper.readLines() functionality.
	 */
	testBufferReadLines() {
		// The following string contains three possible line-endings, a blank line
		// and trailing/leading empty lines.
		const input = '\nLineA\nLineB\n\nLineC\r\nLineD\rLineE\n';
		const expected = ["", "LineA", "LineB", "", "LineC", "LineD", "LineE", ""];

		const buf = BufferWrapper.from(input);
		const lines = buf.readLines();

		for (let i = 0; i < expected.length; i++)
			assert.strictEqual(lines[i], expected[i], 'readLines() output mismatch');
	}

	/**
	 * Test BufferWrapper.setCapacity() functionality.
	 */
	testBufferSetCapacity() {
		const str = 'I walk through the valley of the shadow of death.';
		const buf = BufferWrapper.from(str);

		// Setting the capacity of a buffer to the current size should not effect the data.
		buf.seek(0);
		buf.setCapacity(buf.byteLength);
		assert.strictEqual(buf.byteLength, str.length, 'setCapacity(size) has changed buffer size');
		assert.strictEqual(buf.readString(), str, 'setCapacity(size) has changed buffer data');

		// Setting the capacity to be higher should introduce null bytes (if secure is set).
		buf.seek(0);
		buf.setCapacity(55, true);
		assert.strictEqual(buf.byteLength, 55, 'setCapacity(55) does not give expected buffer size');
		assert.strictEqual(buf.readString(), str.padEnd(55, '\0'), 'setCapacity(55) does not give expected buffer data');

		// Setting the capacity lower should result in data maintained up to the new capacity.
		buf.seek(0);
		buf.setCapacity(20);
		assert.strictEqual(buf.byteLength, 20, 'setCapacity(20) does not give expected buffer size');
		assert.strictEqual(buf.readString(), str.substr(0, 20), 'setCapacity(20) does not give expected buffer data');
	}

	/**
	 * Test BufferWrapper.isZeroed() functionality.
	 */
	testBufferIsZeroed() {
		const nonZeroed = BufferWrapper.from('Where have all the good monks gone?');
		const zeroed = BufferWrapper.from('\0'.repeat(10));

		assert.strictEqual(nonZeroed.isZeroed(), false, '.isZeroed() returns true on non-zeroed buffer');
		assert.strictEqual(zeroed.isZeroed(), true, '.isZeroed() returns false on zeroed buffer');
	}
}

module.exports = BufferTest;