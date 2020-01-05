const FieldType = require('../FieldType');

module.exports = {
	Density: FieldType.UInt32,
	Sound: FieldType.UInt8,
	DoodadID: [FieldType.UInt16, 4]
	// DoodadWeights
};