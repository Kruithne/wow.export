const FieldType = require('../FieldType');

module.exports = {
	GeoBox: [FieldType.Float, 6],
	Flags: FieldType.UInt32,
	FileDataID: FieldType.UInt32,
	BloodID: FieldType.UInt32,
	FootprintTextureID: FieldType.UInt32,
	FootprintTextureLength: FieldType.Float,
	FootprintTextureWidth: FieldType.Float,
	FootprintParticleScale: FieldType.Float,
	FoleyMaterialID: FieldType.UInt32,
	FootstepCameraEffectID: FieldType.UInt32,
	DeathThudCameraEffectID: FieldType.UInt32,
	SoundID: FieldType.UInt32,
	SizeClass: FieldType.UInt32,
	CollisionWidth: FieldType.Float,
	CollisionHeight: FieldType.Float,
	WorldEffectScale: FieldType.Float,
	CreatureGeosetDataID: FieldType.UInt32
};