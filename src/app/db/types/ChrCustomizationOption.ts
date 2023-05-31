// Source: https://github.com/wowdev/WoWDBDefs/blob/master/definitions/ChrModel.dbd
type ChrCustomizationOption = {
    Name_lang: string,
	ID: number,
	SecondaryID: number,
	Flags: number,
	ChrModelID: number,
	OrderIndex: number,
	ChrCustomizationCategoryID: number,
	OptionType: number,
	BarberShopCostModifier: number,
	ChrCustomizationID: number,
	Requirement: number,
	SecondaryOrderIndex: number,
	AddedInPatch: number,
}

export default ChrCustomizationOption;