const ExternalLinks = require('../external-links');
const InstallType = require('../install-type');
const DBItemList = require('../db/caches/DBItemList');
const { equip_item } = require('../wow/equip-item');

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

const view_item_models = (core, modules, item) => {
	modules.tab_models.setActive();

	const list = DBItemList.getItemModels(item);
	core.view.userInputFilterModels = '';
	core.view.overrideModelList = list;
	core.view.selectionModels = list;
	core.view.overrideModelName = item.name;
};

const view_item_textures = async (core, modules, item) => {
	modules.tab_textures.setActive();

	const list = await DBItemList.getItemTextures(item);
	core.view.userInputFilterTextures = '';
	core.view.overrideTextureList = list;
	core.view.selectionTextures = list;
	core.view.overrideTextureName = item.name;
};

const apply_filters = (core) => {
	const items = DBItemList.getItems();
	const type_filter = core.view.itemViewerTypeMask.filter(e => e.checked);
	const type_mask = [];
	type_filter.forEach(e => type_mask.push(...ITEM_SLOTS_MERGED[e.label]));

	const quality_mask = core.view.itemViewerQualityMask.filter(e => e.checked).map(e => e.id);

	const filtered = items.filter(item => type_mask.includes(item.inventoryType) && quality_mask.includes(item.quality));
	core.view.listfileItems = filtered;

	core.view.config.itemViewerEnabledTypes = core.view.itemViewerTypeMask.filter(e => e.checked).map(e => e.label);
	core.view.config.itemViewerEnabledQualities = quality_mask;
};

module.exports = {
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

			await DBItemList.initialize((msg) => this.$core.progressLoadingScreen(msg));

			if (this.$core.view.config.itemViewerShowAll)
				await DBItemList.loadShowAllItems();

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

		equip_item(item) {
			const pending_slot = this.$core.view.chrPendingEquipSlot;
			this.$core.view.chrPendingEquipSlot = null;

			if (!equip_item(this.$core, item, pending_slot))
				this.$core.setToast('info', 'This item cannot be equipped.', null, 2000);
		}
	},

	async mounted() {
		await this.initialize();
	}
};
