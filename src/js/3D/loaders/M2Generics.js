class M2Track {
	/**
	 * Construct a new M2Track instance.
	 * @param {number} globalSeq 
	 * @param {number} interpolation 
	 * @param {Array} timestamps 
	 * @param {Array} values 
	 */
	constructor(globalSeq, interpolation, timestamps, values) {
		this.globalSeq = globalSeq;
		this.interpolation = interpolation;
		this.timestamps = timestamps;
		this.values = values;
	}
}

// See https://wowdev.wiki/M2#Standard_animation_block
function read_m2_array_array(data, ofs, dataType, useAnims = false, animFiles = new Map()) {
	const arrCount = data.readUInt32LE();
	const arrOfs = data.readUInt32LE();

	const base = data.offset;
	data.seek(ofs + arrOfs);

	const arr = Array(arrCount);
	for (let i = 0; i < arrCount; i++) {
		const subArrCount = data.readUInt32LE();
		const subArrOfs = data.readUInt32LE();
		const subBase = data.offset;
		data.seek(ofs + subArrOfs);

		arr[i] = Array(subArrCount);
		for (let j = 0; j < subArrCount; j++) {
			if (useAnims && animFiles.has(i)) {
				switch (dataType) {
					case "uint32":
						animFiles.get(i).seek(subArrOfs + (j * 4));
						arr[i][j] = animFiles.get(i).readUInt32LE();
						break;
					case "int16":
						animFiles.get(i).seek(subArrOfs + (j * 2));
						arr[i][j] = animFiles.get(i).readInt16LE();
						break;
					case "float3":
						animFiles.get(i).seek(subArrOfs + (j * 12));
						arr[i][j] = animFiles.get(i).readFloatLE(3);
						break;
					case "float4":
						animFiles.get(i).seek(subArrOfs + (j * 16));
						arr[i][j] = animFiles.get(i).readFloatLE(4);
						break;
					case "compquat":
						animFiles.get(i).seek(subArrOfs + (j * 8));
						arr[i][j] = animFiles.get(i).readUInt16LE(4).map(e => (e < 0? e + 32768 : e - 32767) / 32767);
						break;
					default:
						throw new Error(`Unhandled data type: ${dataType}`);
				}
			} else {
				switch (dataType) {
					case "uint32":
						arr[i][j] = data.readUInt32LE();
						break;
					case "int16":
						arr[i][j] = data.readInt16LE();
						break;
					case "float3":
						arr[i][j] = data.readFloatLE(3);
						break;
					case "float4":
						arr[i][j] = data.readFloatLE(4);
						break;
					case "compquat":
						arr[i][j] = data.readUInt16LE(4).map(e => (e < 0? e + 32768 : e - 32767) / 32767);
						break;
					default:
						throw new Error(`Unknown data type: ${dataType}`);
				}
			}
		}

		data.seek(subBase);
	}

	data.seek(base);
	return arr;
}

// See https://wowdev.wiki/M2#Standard_animation_block
function read_m2_track(data, ofs, dataType, useAnims = false, animFiles = new Map()) {
	const interpolation = data.readUInt16LE();
	const globalSeq = data.readUInt16LE();

	let timestamps;
	let values;

	if (useAnims) {
		timestamps = read_m2_array_array(data, ofs, "uint32", useAnims, animFiles);
		values = read_m2_array_array(data, ofs, dataType, useAnims, animFiles);
	} else {
		timestamps = read_m2_array_array(data, ofs, "uint32");
		values = read_m2_array_array(data, ofs, dataType);
	}

	return new M2Track(globalSeq, interpolation, timestamps, values);
}

// See https://wowdev.wiki/Common_Types#CAaBox
function read_caa_bb(data) {
	return { min: data.readFloatLE(3), max: data.readFloatLE(3) };
}

module.exports = { M2Track, read_m2_array_array, read_m2_track, read_caa_bb }