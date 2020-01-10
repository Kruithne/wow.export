const FieldType = require('../FieldType');

module.exports = {
	ID: FieldType.UInt32,
	ModelID: FieldType.UInt16,
	SoundID: FieldType.UInt16,
	SizeClass: FieldType.Int8,
	CreatureModelScale: FieldType.Float,
	CreatureModelAlpha: FieldType.UInt8,
	BloodID: FieldType.UInt8,
	ExtendedDisplayInfoID: FieldType.Int32,
	NPCSoundID: FieldType.UInt16,
	ParticleColorID: FieldType.UInt16,
	PortraitCreatureDisplayInfoID: FieldType.Int32,
	PortraitTextureFileDataID: FieldType.Int32,
	ObjectEffectPackageID: FieldType.UInt16,
	AnimReplacementSetID: FieldType.UInt16,
	Flags: FieldType.UInt8,
	StateSpellVisualKitID: FieldType.Int32,
	PlayerOverrideScale: FieldType.Float,
	PetInstanceScale: FieldType.Float,
	UnarmedWeaponType: FieldType.Int8,
	MountProofSpellVisualKitID: FieldType.Int32,
	DissolveEffectID: FieldType.Int32,
	Gender: FieldType.Int8,
	DissolveOutEffectID: FieldType.Int32,
	CreatureModelMinLod: FieldType.Int8,
	TextureVariationFieldDataID: [FieldType.Int32, 3]
};