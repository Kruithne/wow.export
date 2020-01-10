const FieldType = require('../FieldType');

module.exports = {
	GeoBox: [FieldType.Float, 6],
	Flags: FieldType.UInt32,
	FileDataID: FieldType.UInt32
};