import log from '../log.js';
import { dbc } from '../../views/main/rpc.js';
import db2 from '../db2-proxy.js';
import { DBItems } from '../db-proxy.js';
import InstallType from '../install-type.js';
import { get_slot_name } from '../wow/EquipmentSlots.js';

class ItemSet {
	constructor(id, name, item_ids, first_item) {
		this.id = id;
		this.name = name;
		this.item_ids = item_ids;
		this.icon = first_item?.icon ?? 0;
		this.quality = first_item?.quality ?? 0;
	}

	get displayName() {
		return this.name + ' (' + this.id + ')';
	}
}

let item_sets = [];

const initialize_item_sets = async (core) => {
	item_sets.length = 0;

	await core.progressLoadingScreen('Loading item data...');
	await DBItems.ensureInitialized();

	await core.progressLoadingScreen('Loading item appearance data...');
	const appearance_map = new Map();
	for (const row of (await db2.ItemModifiedAppearance.getAllRows()).values())
		appearance_map.set(row.ItemID, row.ItemAppearanceID);

	await core.progressLoadingScreen('Loading item sets...');
	const item_set_rows = await db2.ItemSet.getAllRows();

	for (const [set_id, set_row] of item_set_rows) {
		const item_ids = set_row.ItemID.filter(id => id !== 0);

		if (item_ids.length === 0)
			continue;

		// get first item for icon/quality
		let first_item = null;
		for (const item_id of item_ids) {
			const item = await DBItems.getItemById(item_id);
			if (item) {
				const appearance_id = appearance_map.get(item_id);
				const appearance_row = await db2.ItemAppearance.getRow(appearance_id);

				first_item = {
					icon: appearance_row?.DefaultIconFileDataID ?? 0,
					quality: item.quality
				};

				if (first_item.icon !== 0)
					break;
			}
		}

		item_sets.push(Object.freeze(new ItemSet(set_id, set_row.Name_lang, item_ids, first_item)));
	}

	log.write('Loaded %d item sets', item_sets.length);
};

const apply_filter = (core) => {
	core.view.listfileItemSets = item_sets;
};

export default {
	register() {
		this.registerNavButton('Item Sets', 'armour.svg', InstallType.CASC);
	},

	template: `
		<div class="tab" id="tab-item-sets">
			<div class="list-container list-container-full">
				<component :is="$components.Itemlistbox" id="listbox-item-sets" v-model:selection="$core.view.selectionItemSets" :items="$core.view.listfileItemSets" :filter="$core.view.userInputFilterItemSets" :keyinput="true" :includefilecount="true" unittype="set" @equip="equip_set"></component>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="$core.view.userInputFilterItemSets" placeholder="Filter item sets..."/>
			</div>
		</div>
	`,

	methods: {
		async initialize() {
			this.$core.showLoadingScreen(3);
			await initialize_item_sets(this.$core);
			this.$core.hideLoadingScreen();
			apply_filter(this.$core);
		},

		async equip_set(set) {
			let equipped_count = 0;

			for (const item_id of set.item_ids) {
				const slot_id = await DBItems.getItemSlotId(item_id);
				if (slot_id) {
					this.$core.view.chrEquippedItems[slot_id] = item_id;
					equipped_count++;
				}
			}

			if (equipped_count > 0) {
				this.$core.view.chrEquippedItems = { ...this.$core.view.chrEquippedItems };
				this.$core.setToast('success', `Equipped ${equipped_count} items from ${set.name}.`, null, 2000);
			} else {
				this.$core.setToast('info', 'No equippable items in this set.', null, 2000);
			}
		}
	},

	async mounted() {
		await this.initialize();
	}
};
