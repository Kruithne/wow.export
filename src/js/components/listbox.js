Vue.component('listbox', {
	props: ['items'],
	data: function() {
		return {
			scroll: 0,
			scrollRel: 0,
			isScrolling: false,
			slotCount: 1
		}
	},

	mounted: function() {
		document.addEventListener('mousemove', e => this.moveMouse(e));
		document.addEventListener('mouseup', e => this.stopMouse(e));

		new ResizeObserver(() => this.resize()).observe(this.$el);
	},

	computed: {
		scrollOffset: function() {
			return (this.scroll) + 'px';
		},

		scrollIndex: function() {
			return Math.floor((this.$props.items.length - this.slotCount) * this.scrollRel);
		},

		filteredItems: function() {
			return this.$props.items.slice(this.scrollIndex, this.scrollIndex + this.slotCount);
		},

		itemWeight: function() {
			return 1 / this.$props.items.length;
		}
	},

	methods: {
		resize: function() {
			const max = this.$el.clientHeight - (this.$refs.scroller.clientHeight);
			this.scroll = max * this.scrollRel;

			if (!this.childHeight) {
				const child = this.$el.querySelector('.item');
				if (child !== null) {
					// Items already exist in list, use height of first.
					this.childHeight = child.clientHeight;
				} else {
					// No items in list, create temporary to measure.
					const temp = document.createElement('div');
					this.$el.appendChild(temp);
					this.childHeight = temp.clientHeight;
					temp.remove();
				}
			}

			this.slotCount = Math.ceil(this.$el.clientHeight / this.childHeight);
		},

		recalculateBounds: function() {
			const max = this.$el.clientHeight - (this.$refs.scroller.clientHeight);
			this.scroll = Math.min(max, Math.max(0, this.scroll));
			this.scrollRel = this.scroll / max;
		},

		startMouse: function(e) {
			this.scrollStartY = e.clientY;
			this.scrollStart = this.scroll;
			this.isScrolling = true;
		},

		moveMouse: function(e) {
			if (this.isScrolling) {
				this.scroll = this.scrollStart + (e.clientY - this.scrollStartY);
				this.recalculateBounds();
			}
		},

		stopMouse: function(e) {
			this.isScrolling = false;
		},

		wheelMouse: function(e) {
			const weight = this.$el.clientHeight - (this.$refs.scroller.clientHeight);
			this.scroll += ((e.deltaY / 10) * this.itemWeight) * weight;
			this.recalculateBounds();
		}
	},

	template: `<div class="ui-listbox" @wheel="wheelMouse">
		<div class="scroller" ref="scroller" @mousedown="startMouse" :class="{ using: isScrolling }" :style="{ top: scrollOffset }"><div></div></div>
		<div v-for="item in filteredItems" class="item">{{ item }}</div>
	</div>`
});