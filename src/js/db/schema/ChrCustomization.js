const FieldType = require('../FieldType');

module.exports = {
	Name_lang: FieldType.String,
	ID: FieldType.Int32,
	Sex: FieldType.Int32,
	BaseSection: FieldType.Int32,
	UiCustomizationType: FieldType.Int32,
	Flags: FieldType.Int32,
	ComponentSection: [FieldType.Int32, 3],
};