const assert = require('assert').strict;
const BufferWrapper = require('../src/js/buffer');
const WDCReader = require('../src/js/db/WDCReader');
const DB_CreatureDisplayInfo = require('../src/js/db/schema/CreatureDisplayInfo');
const DB_Map = require('../src/js/db/schema/Map');
const FieldType = require ('../src/js/db/FieldType');

(async () => {
	// Map
	const MapData = await BufferWrapper.readFile('./tests/resources/db2/Map.db2');
	const MapDB = new WDCReader('DBFilesClient/Map.db2', DB_Map);
	MapDB.parse(MapData);
})();

(async () => {
	// CreatureDisplayInfo
	const CDIData = await BufferWrapper.readFile('./tests/resources/db2/CreatureDisplayInfo.db2');
	const CDIDB = new WDCReader('DBFilesClient/CreatureDisplayInfo.db2', DB_CreatureDisplayInfo);
	CDIDB.parse(CDIData);

	// ID 93456 as of 8.2.5.32978 (retrieved from WoW.tools), if DB2 in test is updated to newer version please double check if info is still correct.
	const properRecord =
	{
		ID: 93456,
		ModelID: 10662,
		SizeClass: 1,
		CreatureModelScale: 1.3,
		BloodID: 0,
		ExtendedDisplayInfoID: 0,
		NPCSoundID: 0,
		ParticleColorID: 0,
		PortraitCreatureDisplayInfoID: 0,
		PortraitTextureFileDataID: 0,
		ObjectEffectPackageID: 0,
		AnimReplacementSetID: 0,
		Flags: 0,
		StateSpellVisualKitID: 0,
		PlayerOverrideScale: 0,
		PetInstanceScale: 1,
		UnarmedWeaponType: -1,
		MountPoofSpellVisualKitID: 0,
		DissolveEffectID: 0,
		Gender: 2,
		DissolveOutEffectID: 0,
		CreatureModelMinLod: 0,
		TextureVariationFileDataID: [1795294, 1848705, 0],
	};

	const ourRecord = CDIDB.getRow(93456);
	for (const [name, value] of Object.entries(properRecord)) {
		assert.deepStrictEqual(value, ourRecord[name], 'Mismatch for column ' + name + ', proper value: ' + value + ' (' + value.toString(2) + '), our value: ' + ourRecord[name] + ' (' + ourRecord[name].toString(2) +')');
	}
})();