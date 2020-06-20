const FieldType = require('../FieldType');

module.exports = {
	GeosetIndex: FieldType.UInt8,
	GeosetValue: FieldType.UInt8,
	CreatureDisplayInfoID: FieldType.Relation
};