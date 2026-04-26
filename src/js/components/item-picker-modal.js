const core = require('../core');
const IconRender = require('../icon-render');
const DBItemList = require('../db/caches/DBItemList');
const { equip_item } = require('../wow/equip-item');

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

module.exports = {
	props: ['slot_id', 'slot_filter'],

	emits: ['close', 'open-items-tab'],

	data() {
		return {
			filter_text: '',
			scroll_offset: 0,
			is_loading: false,
			load_error: false,
			items_loaded: DBItemList.getItems().length > 0
		};
	},

	computed: {
		all_items() {
			if (!this.items_loaded)
				return [];

			return DBItemList.getItems();
		},

		type_filtered_items() {
			if (!this.slot_filter || this.all_items.length === 0)
				return this.all_items;

			const type_ids = ITEM_SLOTS_MERGED[this.slot_filter];
			if (!type_ids)
				return this.all_items;

			return this.all_items.filter(item => type_ids.includes(item.inventoryType));
		},

		filtered_items() {
			const text = this.filter_text.trim().toLowerCase();
			if (text.length === 0)
				return this.type_filtered_items;

			return this.type_filtered_items.filter(item => item.displayName.toLowerCase().includes(text));
		},

		display_items() {
			return this.filtered_items.slice(this.scroll_offset, this.scroll_offset + 10);
		},

		can_scroll_up() {
			return this.scroll_offset > 0;
		},

		can_scroll_down() {
			return this.scroll_offset + 10 < this.filtered_items.length;
		},

		result_count() {
			return this.filtered_items.length;
		}
	},

	watch: {
		display_items: {
			immediate: true,
			handler() {
				for (const item of this.display_items)
					IconRender.loadIcon(item.icon);
			}
		},

		filter_text() {
			this.scroll_offset = 0;
		},

		slot_id: {
			immediate: true,
			async handler(val) {
				if (val === null)
					return;

				this.filter_text = '';
				this.scroll_offset = 0;

				if (this.all_items.length === 0) {
					this.is_loading = true;
					this.load_error = false;

					try {
						await DBItemList.initialize();
						this.items_loaded = true;
					} catch (e) {
						this.load_error = true;
					}

					this.is_loading = false;
				}
			}
		}
	},

	methods: {
		select_item(item) {
			const success = equip_item(core, item, this.slot_id);
			if (success)
				this.$emit('close');
		},

		on_wheel(e) {
			if (e.deltaY > 0 && this.can_scroll_down)
				this.scroll_offset = Math.min(this.scroll_offset + 3, this.filtered_items.length - 10);
			else if (e.deltaY < 0 && this.can_scroll_up)
				this.scroll_offset = Math.max(this.scroll_offset - 3, 0);
		},

		on_key(e) {
			if (e.key === 'Escape')
				this.$emit('close');
		},

		open_items_tab() {
			this.$emit('open-items-tab');
		}
	},

	mounted() {
		this._key_handler = (e) => this.on_key(e);
		document.addEventListener('keydown', this._key_handler);

		this.$nextTick(() => {
			this.$refs.filter_input?.focus();
		});
	},

	beforeUnmount() {
		document.removeEventListener('keydown', this._key_handler);
	},

	template: `<div class="item-picker-overlay" @click.self="$emit('close')">
		<div class="item-picker-modal">
			<div class="item-picker-header">
				<span class="item-picker-title">Select Item</span>
				<span class="item-picker-count">{{ result_count }} items</span>
			</div>
			<input ref="filter_input" type="text" class="item-picker-filter" v-model="filter_text" placeholder="Search items..." />
			<div v-if="is_loading" class="item-picker-loading">Loading items...</div>
			<div v-else-if="load_error" class="item-picker-loading">Failed to load items.</div>
			<div v-else class="item-picker-list" @wheel.prevent="on_wheel">
				<div v-for="item in display_items" :key="item.id" class="item-picker-item" @click="select_item(item)">
					<div :class="['item-icon', 'icon-' + item.icon]"></div>
					<span :class="['item-picker-name', 'item-quality-' + item.quality]">{{ item.name }}</span>
					<span class="item-picker-id">({{ item.id }})</span>
				</div>
				<div v-if="!is_loading && filtered_items.length === 0" class="item-picker-empty">No items found.</div>
			</div>
			<div class="item-picker-footer">
				<span class="item-picker-link" @click="open_items_tab">Search in Items Tab</span>
				<input type="button" class="ui-button" value="Cancel" @click="$emit('close')" />
			</div>
		</div>
	</div>`
};
