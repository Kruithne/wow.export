// view-side DB proxy objects
// each property access returns an async function that calls dbc_call via RPC

import { dbc } from '../views/main/rpc.js';
import { serialize, deserialize } from '../rpc/serialize.js';

function create_db_proxy(module_name) {
	return new Proxy({}, {
		get(_, method) {
			return async (...args) => {
				const serialized_args = args.map(a => serialize(a));
				const result = await dbc.call(module_name, method, serialized_args);
				return deserialize(result);
			};
		}
	});
}

export const DBCharacterCustomization = create_db_proxy('DBCharacterCustomization');
export const DBCreatures = create_db_proxy('DBCreatures');
export const DBCreatureDisplayExtra = create_db_proxy('DBCreatureDisplayExtra');
export const DBCreatureList = create_db_proxy('DBCreatureList');
export const DBItemGeosets = create_db_proxy('DBItemGeosets');
export const DBItemModels = create_db_proxy('DBItemModels');
export const DBItemCharTextures = create_db_proxy('DBItemCharTextures');
export const DBItems = create_db_proxy('DBItems');
export const DBNpcEquipment = create_db_proxy('DBNpcEquipment');
export const DBGuildTabard = create_db_proxy('DBGuildTabard');
export const DBModelFileData = create_db_proxy('DBModelFileData');
export const DBTextureFileData = create_db_proxy('DBTextureFileData');
export const DBItemDisplays = create_db_proxy('DBItemDisplays');
export const DBDecor = create_db_proxy('DBDecor');
export const DBDecorCategories = create_db_proxy('DBDecorCategories');
