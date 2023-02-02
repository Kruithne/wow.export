// Source: https://github.com/wowdev/WoWDBDefs/blob/master/definitions/GameObjects.dbd
type GameObjects = {
	ID: number,
	DisplayID: number,
	Name_lang: string,
	OwnerID: number,
	PhaseGroupID: number,
	PhaseID: number,
	PhaseUseFlags: number,
	Pos: Array<number>,
	PropValue: Array<number>,
	Rot: Array<number>,
	Scale: number,
	TypeID: number
}

export default GameObjects;