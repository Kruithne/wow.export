const FieldType = require('../FieldType');

module.exports = {
	Name: FieldType.String,
	Position: [FieldType.Float, 3],
	Rotation: [FieldType.Float, 4],
	ID: FieldType.UInt32,
	OwnerID: FieldType.UInt32,
	DisplayID: FieldType.UInt32,
	Scale: FieldType.Float
};