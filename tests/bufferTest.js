const assert = require('assert').strict;
const BufferWrapper = require('../src/js/buffer');

{
	// [new BufferWrapper(buffer)]
	const raw = Buffer.from('BOLDLY, YOU SOUGHT THE POWER OF RAGNAROS. NOW YOU SHALL SEE IT FIRSTHAND!');
	const buf = new BufferWrapper(raw);

	assert.strictEqual(buf.byteLength, raw.byteLength, 'Wrapped buffer size does not match source node buffer size');

	for (let i = 0; i < raw.byteLength; i++)
		assert.strictEqual(buf.readInt8(), raw[i], 'Wrapped buffer does not match source node buffer');
}

{
	// [BufferWrapper.from(string), readString()]
	const text = 'We all have our demons.';
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
}

{
	// Test .indexOf()
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

{
	// [Unsafe Allocation]
	const buf = BufferWrapper.alloc(42, false);
	assert.strictEqual(buf.byteLength, 42, 'Incorrect buffer size on allocation');
	assert.strictEqual(buf.offset, 0, 'Non-zero offset on buffer allocation');
}

{
	// [Safe Allocation]
	const buf = BufferWrapper.alloc(32, true);
	for (let i = 0; i < 32; i++)
		assert.strictEqual(buf.readUInt8(), 0x0, 'Non-zero value in safe buffer allocation');
}