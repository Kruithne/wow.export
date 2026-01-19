class M2Track {
	/**
	 * Construct a new M2Track instance.
	 * @param {number} globalSeq
	 * @param {number} interpolation
	 * @param {Array} timestamps
	 * @param {Array} values
	 * @param {Array} timestampOffsets - array of {count, offset} per animation
	 * @param {Array} valueOffsets - array of {count, offset} per animation
	 */
	constructor(globalSeq, interpolation, timestamps, values, timestampOffsets = null, valueOffsets = null) {
		this.globalSeq = globalSeq;
		this.interpolation = interpolation;
		this.timestamps = timestamps;
		this.values = values;
		this.timestampOffsets = timestampOffsets;
		this.valueOffsets = valueOffsets;
	}
}

// See https://wowdev.wiki/M2#Standard_animation_block
function read_m2_array_array(data, ofs, dataType, useAnims = false, animFiles = new Map(), storeOffsets = false) {
	const arrCount = data.readUInt32LE();
	const arrOfs = data.readUInt32LE();

	const base = data.offset;
	data.seek(ofs + arrOfs);

	const arr = Array(arrCount);
	const offsets = storeOffsets ? Array(arrCount) : null;

	for (let i = 0; i < arrCount; i++) {
		const subArrCount = data.readUInt32LE();
		const subArrOfs = data.readUInt32LE();
		const subBase = data.offset;

		if (storeOffsets)
			offsets[i] = { count: subArrCount, offset: subArrOfs };

		data.seek(ofs + subArrOfs);

		arr[i] = Array(subArrCount);
		for (let j = 0; j < subArrCount; j++) {
			if (useAnims && animFiles.has(i)) {
				switch (dataType) {
					case 'uint32':
						animFiles.get(i).seek(subArrOfs + (j * 4));
						arr[i][j] = animFiles.get(i).readUInt32LE();
						break;
					case 'int16':
						animFiles.get(i).seek(subArrOfs + (j * 2));
						arr[i][j] = animFiles.get(i).readInt16LE();
						break;
					case 'float3':
						animFiles.get(i).seek(subArrOfs + (j * 12));
						arr[i][j] = animFiles.get(i).readFloatLE(3);
						break;
					case 'float4':
						animFiles.get(i).seek(subArrOfs + (j * 16));
						arr[i][j] = animFiles.get(i).readFloatLE(4);
						break;
					case 'compquat':
						animFiles.get(i).seek(subArrOfs + (j * 8));
						arr[i][j] = animFiles.get(i).readUInt16LE(4).map(e => (e - 32767) / 32768);
						break;
					case 'uint8':
						animFiles.get(i).seek(subArrOfs + j);
						arr[i][j] = animFiles.get(i).readUInt8();
						break;
					default:
						throw new Error(`Unhandled data type: ${dataType}`);
				}
			} else {
				switch (dataType) {
					case 'uint32':
						arr[i][j] = data.readUInt32LE();
						break;
					case 'int16':
						arr[i][j] = data.readInt16LE();
						break;
					case 'float3':
						arr[i][j] = data.readFloatLE(3);
						break;
					case 'float4':
						arr[i][j] = data.readFloatLE(4);
						break;
					case 'compquat':
						arr[i][j] = data.readUInt16LE(4).map(e => (e - 32767) / 32768);
						break;
					case 'uint8':
						arr[i][j] = data.readUInt8();
						break;
					default:
						throw new Error(`Unknown data type: ${dataType}`);
				}
			}
		}

		data.seek(subBase);
	}

	data.seek(base);

	if (storeOffsets)
		return { arr, offsets };

	return arr;
}

// See https://wowdev.wiki/M2#Standard_animation_block
function read_m2_track(data, ofs, dataType, useAnims = false, animFiles = new Map(), storeOffsets = false) {
	const interpolation = data.readUInt16LE();
	const globalSeq = data.readUInt16LE();

	let timestamps, values;
	let timestampOffsets = null, valueOffsets = null;

	if (useAnims) {
		timestamps = read_m2_array_array(data, ofs, 'uint32', useAnims, animFiles);
		values = read_m2_array_array(data, ofs, dataType, useAnims, animFiles);
	} else if (storeOffsets) {
		const tsResult = read_m2_array_array(data, ofs, 'uint32', false, animFiles, true);
		timestamps = tsResult.arr;
		timestampOffsets = tsResult.offsets;

		const valResult = read_m2_array_array(data, ofs, dataType, false, animFiles, true);
		values = valResult.arr;
		valueOffsets = valResult.offsets;
	} else {
		timestamps = read_m2_array_array(data, ofs, 'uint32');
		values = read_m2_array_array(data, ofs, dataType);
	}

	return new M2Track(globalSeq, interpolation, timestamps, values, timestampOffsets, valueOffsets);
}

/**
 * Patch a single animation slot in a track using external .anim data.
 * @param {M2Track} track
 * @param {number} animIndex
 * @param {BufferWrapper} animBuffer
 * @param {string} valueType
 */
function patch_track_animation(track, animIndex, animBuffer, valueType) {
	if (!track.timestampOffsets || !track.valueOffsets)
		return;

	if (animIndex >= track.timestampOffsets.length)
		return;

	const tsInfo = track.timestampOffsets[animIndex];
	const valInfo = track.valueOffsets[animIndex];

	// read timestamps from .anim buffer
	const timestamps = Array(tsInfo.count);
	for (let j = 0; j < tsInfo.count; j++) {
		animBuffer.seek(tsInfo.offset + (j * 4));
		timestamps[j] = animBuffer.readUInt32LE();
	}
	track.timestamps[animIndex] = timestamps;

	// read values from .anim buffer
	const values = Array(valInfo.count);
	for (let j = 0; j < valInfo.count; j++) {
		switch (valueType) {
			case 'float3':
				animBuffer.seek(valInfo.offset + (j * 12));
				values[j] = animBuffer.readFloatLE(3);
				break;
			case 'compquat':
				animBuffer.seek(valInfo.offset + (j * 8));
				values[j] = animBuffer.readUInt16LE(4).map(e => (e - 32767) / 32768);
				break;
			case 'float4':
				animBuffer.seek(valInfo.offset + (j * 16));
				values[j] = animBuffer.readFloatLE(4);
				break;
			case 'int16':
				animBuffer.seek(valInfo.offset + (j * 2));
				values[j] = animBuffer.readInt16LE();
				break;
			case 'uint32':
				animBuffer.seek(valInfo.offset + (j * 4));
				values[j] = animBuffer.readUInt32LE();
				break;
			case 'uint8':
				animBuffer.seek(valInfo.offset + j);
				values[j] = animBuffer.readUInt8();
				break;
		}
	}

	track.values[animIndex] = values;
}

// See https://wowdev.wiki/Common_Types#CAaBox
function read_caa_bb(data) {
	return { min: data.readFloatLE(3), max: data.readFloatLE(3) };
}

module.exports = { M2Track, read_m2_array_array, read_m2_track, read_caa_bb, patch_track_animation }