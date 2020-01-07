const assert = require('assert').strict;
const BufferWrapper = require('../src/js/buffer');

{
	// [new BufferWrapper(buffer)]
	const raw = Buffer.from('BOLDLY, YOU SOUGHT THE POWER OF RAGNAROS. NOW YOU SHALL SEE IT FIRSTHAND!');
	const buf = new BufferWrapper(raw);

	assert.strictEqual(buf.byteLength, buf.byteLength, 'Wrapped buffer size does not match source node buffer size');

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