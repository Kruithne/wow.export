// Source: https://github.com/wowdev/WoWDBDefs/blob/master/definitions/GameObjectDisplayInfo.dbd
type GameObjectDisplayInfo = {
	ID: number,
	FileDataID: number,
	Sound: number,
	GeoBoxMin: number,
	GeoBoxMax: number,
	ObjectEffectPackageID: number,
	OverrideLootEffectScale: number,
	OverrideNameScale: number,
	GeoBox: number,
	ModelName: string
}

export default GameObjectDisplayInfo;