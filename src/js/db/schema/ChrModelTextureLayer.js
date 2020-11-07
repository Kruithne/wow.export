const FieldType = require('../FieldType');

// LayoutHash B6E31714

module.exports = {
	ID: FieldType.Int32,
	TextureType: FieldType.Int32,
	Layer: FieldType.Int32,
	Flags: FieldType.Int32,
	Field_9_0_1_34365_004: FieldType.Int32,
	TextureSectionTypeBitMask: FieldType.Int32,
	Field_9_0_1_34365_006: [FieldType.Int32, 3],
	ChrModelTextureTargetID: [FieldType.Int32, 3],
	CharComponentTextureLayoutsID: FieldType.Relation
};