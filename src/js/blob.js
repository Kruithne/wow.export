/*!
 * Blob.js Polyfill for wow.export
 * Adapted from: https://github.com/eligrey/Blob.js by Kruithne <kruithne@gmail.com>
 * By Eli Grey, https://eligrey.com
 * By Jimmy Wärting, https://github.com/jimmywarting
 * License: MIT
 */

function array2base64(input) {
	const byteToCharMap = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
	const output = [];

	for (let i = 0; i < input.length; i += 3) {
		const byte1 = input[i];
		const haveByte2 = i + 1 < input.length;
		const byte2 = haveByte2 ? input[i + 1] : 0;
		const haveByte3 = i + 2 < input.length;
		const byte3 = haveByte3 ? input[i + 2] : 0;

		const outByte1 = byte1 >> 2;
		const outByte2 = ((byte1 & 0x03) << 4) | (byte2 >> 4);
		let outByte3 = ((byte2 & 0x0F) << 2) | (byte3 >> 6);
		let outByte4 = byte3 & 0x3F;

		if (!haveByte3) {
			outByte4 = 64;
			if (!haveByte2)
				outByte3 = 64;
		}

		output.push(
			byteToCharMap[outByte1],
			byteToCharMap[outByte2],
			byteToCharMap[outByte3],
			byteToCharMap[outByte4]
		);
	}

	return output.join('');
}

function stringEncode(string) {
	let pos = 0;
	const len = string.length;
	const Arr = Uint8Array || Array;

	let at = 0;
	let tlen = Math.max(32, len + (len >> 1) + 7);
	let target = new Arr((tlen >> 3) << 3);

	while (pos < len) {
		let value = string.charCodeAt(pos++);
		if (value >= 0xd800 && value <= 0xdbff) {
			if (pos < len) {
				const extra = string.charCodeAt(pos);
				if ((extra & 0xfc00) === 0xdc00) {
					++pos;
					value = ((value & 0x3ff) << 10) + (extra & 0x3ff) + 0x10000;
				}
			}
			if (value >= 0xd800 && value <= 0xdbff)
				continue;
		}

		if (at + 4 > target.length) {
			tlen += 8;
			tlen *= (1.0 + (pos / string.length) * 2);
			tlen = (tlen >> 3) << 3;

			const update = new Uint8Array(tlen);
			update.set(target);
			target = update;
		}

		if ((value & 0xffffff80) === 0) {
			target[at++] = value;
			continue;
		} else if ((value & 0xfffff800) === 0) {
			target[at++] = ((value >> 6) & 0x1f) | 0xc0;
		} else if ((value & 0xffff0000) === 0) {
			target[at++] = ((value >> 12) & 0x0f) | 0xe0;
			target[at++] = ((value >> 6) & 0x3f) | 0x80;
		} else if ((value & 0xffe00000) === 0) {
			target[at++] = ((value >> 18) & 0x07) | 0xf0;
			target[at++] = ((value >> 12) & 0x3f) | 0x80;
			target[at++] = ((value >> 6) & 0x3f) | 0x80;
		} else {
			continue;
		}

		target[at++] = (value & 0x3f) | 0x80;
	}

	return target.slice(0, at);
}

function stringDecode(buf) {
	const end = buf.length;
	const res = [];

	let i = 0;
	while (i < end) {
		const firstByte = buf[i];
		let codePoint = null;
		const bytesPerSequence = (firstByte > 0xEF) ? 4 :
			(firstByte > 0xDF) ? 3 :
			(firstByte > 0xBF) ? 2 : 1;

		if (i + bytesPerSequence <= end) {
			let secondByte, thirdByte, fourthByte, tempCodePoint;

			switch (bytesPerSequence) {
				case 1:
					if (firstByte < 0x80)
						codePoint = firstByte;
					break;
				case 2:
					secondByte = buf[i + 1];
					if ((secondByte & 0xC0) === 0x80) {
						tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F);
						if (tempCodePoint > 0x7F)
							codePoint = tempCodePoint;
					}
					break;
				case 3:
					secondByte = buf[i + 1];
					thirdByte = buf[i + 2];
					if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
						tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F);
						if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF))
							codePoint = tempCodePoint;
					}
					break;
				case 4:
					secondByte = buf[i + 1];
					thirdByte = buf[i + 2];
					fourthByte = buf[i + 3];
					if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
						tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F);
						if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000)
							codePoint = tempCodePoint;
					}
			}
		}

		if (codePoint === null) {
			codePoint = 0xFFFD;
			bytesPerSequence = 1;
		} else if (codePoint > 0xFFFF) {
			codePoint -= 0x10000;
			res.push(codePoint >>> 10 & 0x3FF | 0xD800);
			codePoint = 0xDC00 | codePoint & 0x3FF;
		}

		res.push(codePoint);
		i += bytesPerSequence;
	}

	const len = res.length;
	let str = '';
	let j = 0;

	while (j < len)
		str += String.fromCharCode.apply(String, res.slice(j, j += 0x1000));

	return str;
}

const textEncode = typeof TextEncoder === 'function' ?
	TextEncoder.prototype.encode.bind(new TextEncoder()) : stringEncode;

const textDecode = typeof TextDecoder === 'function' ?
	TextDecoder.prototype.decode.bind(new TextDecoder()) : stringDecode;

function bufferClone(buf) {
	const view = new Array(buf.byteLength);
	const array = new Uint8Array(buf);
	let i = view.length;
	while (i--)
		view[i] = array[i];
	return view;
}

function getObjectTypeName(o) {
	return Object.prototype.toString.call(o).slice(8, -1);
}

function isPrototypeOf(c, o) {
	return typeof c === 'object' && Object.prototype.isPrototypeOf.call(c.prototype, o);
}

function isDataView(o) {
	return getObjectTypeName(o) === 'DataView' || isPrototypeOf(DataView, o);
}

const arrayBufferClassNames = [
	'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array',
	'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array',
	'Float64Array', 'ArrayBuffer'
];

function isArrayBuffer(o) {
	return arrayBufferClassNames.indexOf(getObjectTypeName(o)) !== -1 || isPrototypeOf(ArrayBuffer, o);
}

function concatTypedarrays(chunks) {
	let size = 0;
	let j = chunks.length;
	while (j--)
		size += chunks[j].length;

	const b = new Uint8Array(size);
	let offset = 0;
	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i];
		b.set(chunk, offset);
		offset += chunk.byteLength || chunk.length;
	}

	return b;
}

class BlobPolyfill {
	constructor(chunks, opts) {
		chunks = chunks ? chunks.slice() : [];
		opts = opts == null ? {} : opts;

		for (let i = 0, len = chunks.length; i < len; i++) {
			const chunk = chunks[i];
			if (chunk instanceof BlobPolyfill) {
				chunks[i] = chunk._buffer;
			} else if (typeof chunk === 'string') {
				chunks[i] = textEncode(chunk);
			} else if (isDataView(chunk)) {
				chunks[i] = bufferClone(chunk.buffer);
			} else if (isArrayBuffer(chunk)) {
				chunks[i] = bufferClone(chunk);
			} else {
				chunks[i] = textEncode(String(chunk));
			}
		}

		this._buffer = Uint8Array ? concatTypedarrays(chunks) : [].concat.apply([], chunks);
		this.size = this._buffer.length;

		this.type = opts.type || '';
		if (/[^\u0020-\u007E]/.test(this.type)) {
			this.type = '';
		} else {
			this.type = this.type.toLowerCase();
		}
	}

	arrayBuffer() {
		return Promise.resolve(this._buffer.buffer || this._buffer);
	}

	text() {
		return Promise.resolve(textDecode(this._buffer));
	}

	slice(start, end, type) {
		const slice = this._buffer.slice(start || 0, end || this._buffer.length);
		return new BlobPolyfill([slice], { type });
	}

	toString() {
		return '[object Blob]';
	}

	stream() {
		const position = 0;
		const blob = this;

		return new ReadableStream({
			pull(controller) {
				const chunk = blob.slice(position, position + 524288);
				return chunk.arrayBuffer().then(buffer => {
					position += buffer.byteLength;
					const uint8array = new Uint8Array(buffer);
					controller.enqueue(uint8array);

					if (position == blob.size)
						controller.close();
				});
			}
		});
	}
}

BlobPolyfill.isPolyfill = true;

class URLPolyfill {
	static createObjectURL(blob) {
		if (blob instanceof BlobPolyfill)
			return 'data:' + blob.type + ';base64,' + array2base64(blob._buffer);

		// fallback to native
		return URL.createObjectURL(blob);
	}

	static revokeObjectURL(url) {
		// data urls don't need revoking, but call native for non-data urls
		if (!url.startsWith('data:'))
			URL.revokeObjectURL(url);
	}
}

module.exports = { BlobPolyfill, URLPolyfill };
