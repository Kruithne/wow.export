const FieldType = require('../FieldType');

module.exports = {
	EntryID: FieldType.UInt32,
	Sound: FieldType.UInt8,
	Density: FieldType.UInt32,
	DoodadID: [FieldType.UInt16, 4]
	// DoodadWeights
};