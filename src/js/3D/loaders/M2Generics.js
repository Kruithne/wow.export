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
function read_m2_array(data, ofs, read) {
	const arrCount = data.readUInt32LE();
	const arrOfs = data.readUInt32LE();

	const base = data.offset;
	data.seek(ofs + arrOfs);

	const arr = Array(arrCount);
	for (let i = 0; i < arrCount; i++)
		arr[i] = read();

	data.seek(base);
	return arr;
}

// See https://wowdev.wiki/M2#Standard_animation_block
function read_m2_track(data, ofs, read) {
	const interpolation = data.readUInt16LE();
	const globalSeq = data.readUInt16LE();

	const timestamps = read_m2_array(data, ofs, () => read_m2_array(data, ofs, () => data.readUInt32LE()));
	const values = read_m2_array(data, ofs, () => read_m2_array(data, ofs, read));

	return new M2Track(globalSeq, interpolation, timestamps, values);
}

// See https://wowdev.wiki/Common_Types#CAaBox
function read_caa_bb(data) {
	return { min: data.readFloatLE(3), max: data.readFloatLE(3) };
}

module.exports = { M2Track, read_m2_array, read_m2_track, read_caa_bb }