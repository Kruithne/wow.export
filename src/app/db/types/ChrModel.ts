// Source: https://github.com/wowdev/WoWDBDefs/blob/master/definitions/ChrModel.dbd
type ChrModel = {
    FaceCustomizationOffset: Array<number>,
    CustomizeOffset: Array<number>,
	ID: number,
	Sex: number,
	DisplayID: number,
	CharComponentTextureLayoutID: number,
	Flags: number,
	SkeletonFileDataID: number,
	ModelFallbackChrModelID: number,
	TextureFallbackChrModelID: number,
	HelmVisFallbackChrModelID: number,
	CustomizeScale: number,
	CustomizeFacing: number,
	CameraDistanceOffset: number,
	BarberShopCameraOffsetScale: number,
	BarberShopCameraRotationFacing: number,
	BarberShopCameraRotationOffset: number,
}

export default ChrModel;