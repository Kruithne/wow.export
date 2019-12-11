Vue.component('map-viewer', {
	/**
	 * loader: Tile loader function.
	 * tileSize: Base size of tiles (before zoom).
	 * mapSize: Maximum tile index of the map.
	 * map: ID of the current map. We use this to listen for map changes.
	 */
	props: ['loader', 'tileSize', 'mapSize', 'map'],

	data: function() {
		return {
			offsetX: 0,
			offsetY: 0
		}
	},

	/**
	 * Invoked when this component is mounted in the DOM.
	 */
	mounted: function() {
		// Store a local reference to the canvas context for faster rendering.
		this.context = this.$refs.canvas.getContext('2d');

		// Create a new local cache for map tiles.
		this.initializeCache();

		// Create anonymous pass-through functions for our event handlers
		// to maintain context. We store them so we can unregister them later.
		this.onMouseMove = event => this.handleMouseMove(event);
		this.onMouseUp = event => this.handleMouseUp(event);

		// Mouse move/up events are registered onto the document so we can
		// still handle them if the user moves off the component while dragging.
		document.addEventListener('mousemove', this.onMouseMove);
		document.addEventListener('mouseup', this.onMouseUp);

		// Register a resize listener onto the window so we can adjust.
		// We use an anonymous function to maintain context, and store it
		// on the instance so we can unregister later.
		this.onResize = () => this.render();
		window.addEventListener('resize', this.onResize);

		// We need to also monitor for size changes to the canvas itself so we
		// can keep it relatively positioned.
		this.observer = new ResizeObserver(() => this.onResize());
		this.observer.observe(this.$el);

		// Manually trigger an initial render.
		this.render();
	},

	/**
	 * Invoked when this component is about to be destroyed.
	 */
	beforeDestory: function() {
		// Unregister window resize listener.
		window.removeEventListener('resize', this.onResize);

		// Unregister mouse listeners applied to document.
		document.removeEventListener('mousemove', this.onMouseMove);
		document.removeEventListener('mouseup', this.onMouseUp);

		// Disconnect the resize observer for the canvas.
		this.observer.disconnect();
	},

	watch: {
		/**
		 * Invoked when the map property changes for this component.
		 * This indicates that a new map has been selected for rendering.
		 */
		map: function() {
			// Reset the current panning position of the viewer.
			this.offsetX = 0;
			this.offsetY = 0;

			// Reset the cache.
			this.initializeCache();

			// Trigger a re-render.
			this.render();
		}
	},

	methods: {
		/**
		 * Initialize a fresh cache array.
		 */
		initializeCache: function() {
			this.cache = new Array(this.$props.mapSize * this.$props.mapSize);
		},

		/**
		 * Update the position of the internal container.
		 */
		render: function() {
			// If no map has been selected, do not render.
			if (this.$props.map === null)
				return;

			// No canvas reference? Component likely dismounting.
			const canvas = this.$refs.canvas;
			if (!canvas)
				return;

			// Update the internal canvas dimensions to match the element.
			canvas.width = canvas.offsetWidth;
			canvas.height = canvas.offsetHeight;

			// Viewport width/height defines what is visible to the user.
			const viewport = this.$el;
			const viewportWidth = viewport.clientWidth;
			const viewportHeight = viewport.clientHeight;

			// Calculate which tiles will appear within the viewer.
			const maxTile = this.$props.mapSize;
			const tileSize = this.$props.tileSize;

			// Get local reference to the canvas context.
			const ctx = this.context;

			// drawOfsX/drawOfsY offset the the render to make the map centered.
			// Additionally, the current panning offsets are also factored in here.
			const drawOfsX = -((maxTile * tileSize) / 2) + (viewportWidth / 2) + this.offsetX;
			const drawOfsY = -((maxTile * tileSize) / 2) + (viewportHeight / 2) + this.offsetY;

			// We need to use a local reference to the cache so that async callbacks
			// for tile loading don't overwrite the most current cache if they resolve
			// after a new map has been selected. 
			const cache = this.cache;

			// Iterate over all possible tiles in a map and render as needed.
			const loaderFunc = this.$props.loader;
			for (let x = 0; x < maxTile; x++) {
				for (let y = 0; y < maxTile; y++) {
					// drawX/drawY is the absolute position to draw this tile.
					const drawX = (x * tileSize) + drawOfsX;
					const drawY = (y * tileSize) + drawOfsY;

					// Cache is a one-dimensional array, calculate the index as such.
					const index = (x * maxTile) + y;
					const cached = cache[index];

					// Skip tiles that are not in (or around) the viewport.
					if (drawX > (viewportWidth + tileSize) || drawY > (viewportHeight + tileSize) || drawX + tileSize < -tileSize || drawY + tileSize < -tileSize) {
						// Clear out cache entries for tiles no longer in viewport.
						if (cache[index] !== undefined) {
							ctx.clearRect(drawX, drawY, tileSize, tileSize);
							cache[index] = undefined;
						}

						continue;
					}

					// No cache, request it (async) then skip.
					if (cached === undefined) {
						// Set the tile cache to 'true' so it is skipped while loading.
						this.cache[index] = true;

						// Request the new tile.
						loaderFunc(x, y, tileSize).then(data => {
							cache[index] = data;
							this.render();
						});
						continue;
					}

					// Check if the tile is renderable.
					if (cached instanceof ImageData)
						ctx.putImageData(cached, drawX, drawY);
				}
			}
		},

		/**
		 * Invoked on mousemove events captured on the document.
		 * @param {MouseEvent} event
		 */
		handleMouseMove: function(event) {
			if (this.isPanning) {
				// Calculate the distance from our mousesdown event.
				const deltaX = this.mouseBaseX - event.clientX;
				const deltaY = this.mouseBaseY - event.clientY;

				// Update the offset based on our pan base.
				this.offsetX = this.panBaseX - deltaX;
				this.offsetY = this.panBaseY - deltaY;

				// Offsets are not reactive, manually trigger an update.
				this.render();
			}
		},

		/**
		 * Invoked on mouseup events captured on the document.
		 * @param {MouseEvent} event
		 */
		handleMouseUp: function(event) {
			if (this.isPanning)
				this.isPanning = false;
		},

		/**
		 * Invoked on mousedown events captured on the container element.
		 * @param {MouseEvent} event
		 */
		handleMouseDown: function(event) {
			if (!this.isPanning) {
				this.isPanning = true;

				// Store the X/Y of the mouse event to calculate drag deltas.
				this.mouseBaseX = event.clientX;
				this.mouseBaseY = event.clientY;

				// Store the current offsetX/offsetY used for relative panning
				// as the user drags the component.
				this.panBaseX = this.offsetX;
				this.panBaseY = this.offsetY;
			}
		}
	},

	/**
	 * HTML mark-up to render for this component.
	 */
	template: `<div class="ui-map-viewer" @mousedown="handleMouseDown">
		<canvas ref="canvas"></canvas>
	</div>`
});