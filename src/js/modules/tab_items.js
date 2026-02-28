import log from '../log.js';
import { listfile } from '../../views/main/rpc.js';
import MultiMap from '../MultiMap.js';
import ExternalLinks from '../external-links.js';

import { dbc } from '../../views/main/rpc.js';
import db2 from '../db2-proxy.js';
import { DBItems, DBModelFileData, DBTextureFileData } from '../db-proxy.js';
import ItemSlot from '../wow/ItemSlot.js';
import InstallType from '../install-type.js';
import { get_slot_name } from '../wow/EquipmentSlots.js';

const ITEM_SLOTS_IGNORED = [0, 18, 11, 12, 24, 25, 27, 28];

const ITEM_QUALITIES = [
	{ id: 0, label: 'Poor' },
	{ id: 1, label: 'Common' },
	{ id: 2, label: 'Uncommon' },
	{ id: 3, label: 'Rare' },
	{ id: 4, label: 'Epic' },
	{ id: 5, label: 'Legendary' },
	{ id: 6, label: 'Artifact' },
	{ id: 7, label: 'Heirloom' }
];

const ITEM_SLOTS_MERGED = {
	'Head': [1],
	'Neck': [2],
	'Shoulder': [3],
	'Shirt': [4],
	'Chest': [5, 20],
	'Waist': [6],
	'Legs': [7],
	'Feet': [8],
	'Wrist': [9],
	'Hands': [10],
	'One-hand': [13],
	'Off-hand': [14, 22, 23],
	'Two-hand': [17],
	'Main-hand': [21],
	'Ranged': [15, 26],
	'Back': [16],
	'Tabard': [19]
};

class Item {
	constructor(id, item_sparse_row, item_appearance_row, textures, models) {
		this.id = id;
		this.name = item_sparse_row.Display_lang;

		if (this.name === undefined)
			this.name = 'Unknown item #' + id;

		this.inventoryType = item_sparse_row.InventoryType;
		this.quality = item_sparse_row.OverallQualityID ?? 0;

		this.icon = item_appearance_row?.DefaultIconFileDataID ?? 0;

		if (this.icon == 0)
			this.icon = item_sparse_row.IconFileDataID;

		this.models = models;
		this.textures = textures;

		this.modelCount = this.models?.length ?? 0;
		this.textureCount = this.textures?.length ?? 0;
	}

	get itemSlotName() {
		return ItemSlot.getSlotName(this.inventoryType);
	}

	get displayName() {
		return this.name + ' (' + this.id + ')';
	}
}

let items = [];

const view_item_models = async (core, modules, item) => {
	modules.tab_models.setActive();

	const list = new Set();

	for (const model_id of item.models) {
		const file_data_ids = await DBModelFileData.getModelFileDataID(model_id);
		for (const file_data_id of file_data_ids) {
			const entry = await listfile.getByID(file_data_id);

			if (entry !== undefined)
				list.add(`${entry} [${file_data_id}]`);
		}
	}

	core.view.userInputFilterModels = '';

	core.view.overrideModelList = [...list];
	core.view.selectionModels = [...list];
	core.view.overrideModelName = item.name;
};

const view_item_textures = async (core, modules, item) => {
	modules.tab_textures.setActive();
	await DBTextureFileData.ensureInitialized();

	const list = new Set();

	for (const texture_id of item.textures) {
		const file_data_ids = await DBTextureFileData.getTextureFDIDsByMatID(texture_id);
		if (file_data_ids) {
			for (const file_data_id of file_data_ids) {
				const entry = await listfile.getByID(file_data_id);

				if (entry !== undefined)
					list.add(`${entry} [${file_data_id}]`);
			}
		}
	}

	core.view.userInputFilterTextures = '';

	core.view.overrideTextureList = [...list];
	core.view.selectionTextures = [...list];
	core.view.overrideTextureName = item.name;
};

const initialize_items = async (core) => {
	items.length = 0;

	await core.progressLoadingScreen('Loading model file data...');
	await DBModelFileData.initializeModelFileData();

	await core.progressLoadingScreen('Loading item data...');
	await DBItems.ensureInitialized();

	const item_sparse_rows = await db2.ItemSparse.getAllRows();

	const appearance_map = new Map();
	for (const row of (await db2.ItemModifiedAppearance.getAllRows()).values())
		appearance_map.set(row.ItemID, row.ItemAppearanceID);

	const material_map = new MultiMap();
	for (const row of (await db2.ItemDisplayInfoMaterialRes.getAllRows()).values())
		material_map.set(row.ItemDisplayInfoID, row.MaterialResourcesID);

	for (const [item_id, item_row] of item_sparse_rows) {
		if (ITEM_SLOTS_IGNORED.includes(item_row.inventoryType))
			continue;

		const item_appearance_id = appearance_map.get(item_id);
		const item_appearance_row = await db2.ItemAppearance.getRow(item_appearance_id);

		let materials = null;
		let models = null;
		if (item_appearance_row !== null) {
			materials = [];
			models = [];

			const item_display_info_row = await db2.ItemDisplayInfo.getRow(item_appearance_row.ItemDisplayInfoID);
			if (item_display_info_row !== null) {
				materials.push(...item_display_info_row.ModelMaterialResourcesID);
				models.push(...item_display_info_row.ModelResourcesID);
			}

			const material_res = material_map.get(item_appearance_row.ItemDisplayInfoID);
			if (material_res !== undefined)
				Array.isArray(material_res) ? materials.push(...material_res) : materials.push(material_res);

			materials = materials.filter(e => e !== 0);
			models = models.filter(e => e !== 0);
		}

		items.push(Object.freeze(new Item(item_id, item_row, item_appearance_row, materials, models)));
	}

	if (core.view.config.itemViewerShowAll) {
		const item_db = db2.Item;

		for (const [item_id, item_row] of await item_db.getAllRows()) {
			if (ITEM_SLOTS_IGNORED.includes(item_row.inventoryType))
				continue;

			if (item_sparse_rows.has(item_id))
				continue;

			const item_appearance_id = appearance_map.get(item_id);
			const item_appearance_row = db2.ItemAppearance.getRow(item_appearance_id);

			let materials = null;
			let models = null;
			if (item_appearance_row !== null) {
				materials = [];
				models = [];

				const item_display_info_row = await db2.ItemDisplayInfo.getRow(item_appearance_row.ItemDisplayInfoID);
				if (item_display_info_row !== null) {
					materials.push(...item_display_info_row.ModelMaterialResourcesID);
					models.push(...item_display_info_row.ModelResourcesID);
				}

				const material_res = material_map.get(item_appearance_row.ItemDisplayInfoID);
				if (material_res !== undefined)
					Array.isArray(material_res) ? materials.push(...material_res) : materials.push(material_res);

				materials = materials.filter(e => e !== 0);
				models = models.filter(e => e !== 0);
			}

			items.push(Object.freeze(new Item(item_id, item_row, null, null, null)));
		}
	}
};

const apply_filters = (core) => {
	const type_filter = core.view.itemViewerTypeMask.filter(e => e.checked);
	const type_mask = [];
	type_filter.forEach(e => type_mask.push(...ITEM_SLOTS_MERGED[e.label]));

	const quality_mask = core.view.itemViewerQualityMask.filter(e => e.checked).map(e => e.id);

	const filtered = items.filter(item => type_mask.includes(item.inventoryType) && quality_mask.includes(item.quality));
	core.view.listfileItems = filtered;

	core.view.config.itemViewerEnabledTypes = core.view.itemViewerTypeMask.filter(e => e.checked).map(e => e.label);
	core.view.config.itemViewerEnabledQualities = quality_mask;
};

export default {
	register() {
		this.registerNavButton('Items', 'sword.svg', InstallType.CASC);
	},

	template: `
		<div class="tab" id="tab-items">
			<div class="list-container">
				<component :is="$components.Itemlistbox" id="listbox-items" v-model:selection="$core.view.selectionItems" :items="$core.view.listfileItems" :filter="$core.view.userInputFilterItems" :keyinput="true" :includefilecount="true" unittype="item" @options="$core.view.contextMenus.nodeItem = $event" @equip="equip_item"></component>
				<component :is="$components.ContextMenu" :node="$core.view.contextMenus.nodeItem" v-slot:default="context" @close="$core.view.contextMenus.nodeItem = null">
					<span v-if="context.node.modelCount > 0" @click.self="view_models(context.node)">View related models ({{ context.node.modelCount }})</span>
					<span v-if="context.node.textureCount > 0" @click.self="view_textures(context.node)">View related textures ({{ context.node.textureCount }})</span>
					<span @click.self="copy_to_clipboard(context.node.name)">Copy item name to clipboard</span>
					<span @click.self="copy_to_clipboard(context.node.id)">Copy item ID to clipboard</span>
					<span @click.self="view_on_wowhead(context.node.id)">View item on Wowhead (web)</span>
				</component>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="$core.view.userInputFilterItems" placeholder="Filter items..."/>
			</div>
			<div id="items-sidebar" class="sidebar">
				<span class="header">Item Types</span>
				<div class="sidebar-checklist">
					<div v-for="item in $core.view.itemViewerTypeMask" class="sidebar-checklist-item" :class="{ selected: item.checked }" @click="toggle_checklist_item(item)">
						<input type="checkbox" v-model="item.checked" @click.stop/>
						<span>{{ item.label }}</span>
					</div>
				</div>
				<div class="list-toggles">
					<a @click="$core.view.setAllItemTypes(true)">Enable All</a> / <a @click="$core.view.setAllItemTypes(false)">Disable All</a>
				</div>
				<span class="header">Quality</span>
				<div class="sidebar-checklist">
					<div v-for="item in $core.view.itemViewerQualityMask" class="sidebar-checklist-item" :class="{ selected: item.checked }" @click="toggle_checklist_item(item)">
						<input type="checkbox" v-model="item.checked" :class="'quality-' + item.id" @click.stop/>
						<span>{{ item.label }}</span>
					</div>
				</div>
				<div class="list-toggles">
					<a @click="$core.view.setAllItemQualities(true)">Enable All</a> / <a @click="$core.view.setAllItemQualities(false)">Disable All</a>
				</div>
			</div>
		</div>
	`,

	methods: {
		async initialize() {
			this.$core.showLoadingScreen(2);

			await initialize_items(this.$core);
			this.$core.hideLoadingScreen();

			const enabled_types = this.$core.view.config.itemViewerEnabledTypes;
			const pending_slot = this.$core.view.pendingItemSlotFilter;
			const type_mask = [];

			for (const label of Object.keys(ITEM_SLOTS_MERGED)) {
				if (pending_slot)
					type_mask.push({ label, checked: label === pending_slot });
				else
					type_mask.push({ label, checked: enabled_types.includes(label) });
			}

			this.$core.view.pendingItemSlotFilter = null;

			const enabled_qualities = this.$core.view.config.itemViewerEnabledQualities;
			const quality_mask = ITEM_QUALITIES.map(q => ({
				id: q.id,
				label: q.label,
				checked: enabled_qualities === undefined || enabled_qualities.includes(q.id)
			}));

			this.$core.view.$watch('itemViewerTypeMask', () => apply_filters(this.$core), { deep: true });
			this.$core.view.$watch('itemViewerQualityMask', () => apply_filters(this.$core), { deep: true });

			this.$core.view.itemViewerQualityMask = quality_mask;
			this.$core.view.itemViewerTypeMask = type_mask;
		},

		view_models(item) {
			view_item_models(this.$core, this.$modules, item);
		},

		view_textures(item) {
			view_item_textures(this.$core, this.$modules, item);
		},

		copy_to_clipboard(value) {
			this.$core.view.copyToClipboard(value);
		},

		view_on_wowhead(item_id) {
			ExternalLinks.wowHead_viewItem(item_id);
		},

		toggle_checklist_item(item) {
			item.checked = !item.checked;
		},

		async equip_item(item) {
			const slot_id = await DBItems.getItemSlotId(item.id);
			if (!slot_id) {
				this.$core.setToast('info', 'This item cannot be equipped.', null, 2000);
				return;
			}

			this.$core.view.chrEquippedItems[slot_id] = item.id;
			this.$core.view.chrEquippedItems = { ...this.$core.view.chrEquippedItems };

			const slot_name = get_slot_name(slot_id);
			this.$core.setToast('success', `Equipped ${item.name} to ${slot_name} slot.`, null, 2000);
		}
	},

	async mounted() {
		await this.initialize();
	}
};
