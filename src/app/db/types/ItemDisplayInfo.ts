// Source https://github.com/wowdev/WoWDBDefs/blob/master/definitions/ItemDisplayInfo.dbd
type ItemDisplayInfo = {
	ID: number,
	Field_3_4_1_46917_000: number,
	ItemVisual: number,
	ParticleColorID: number,
	ItemRangedDisplayInfoID: number,
	OverrideSwooshSoundKitID: number,
	SheatheTransformMatrixID: number,
	StateSpellVisualKitID: number,
	SheathedSpellVisualKitID: number,
	UnsheathedSpellVisualKitID: number,
	Flags: number,
	ModelResourcesID: Array<number>,
	ModelMaterialResourcesID: Array<number>,
	ModelType: Array<number>,
	GeosetGroup: Array<number>,
	AttachmentGeosetGroup: Array<number>,
	HelmetGeosetVis: Array<number>,
}

export default ItemDisplayInfo;