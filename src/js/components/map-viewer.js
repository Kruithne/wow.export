const util = require('util');

const MAP_SIZE = 64;
const MAP_COORD_BASE = 51200 / 3;
const MAP_CHUNK_WEIGHT = (MAP_COORD_BASE * 2) / 64;

Vue.component('map-viewer', {
	/**
	 * loader: Tile loader function.
	 * tileSize: Base size of tiles (before zoom).
	 * map: ID of the current map. We use this to listen for map changes.
	 * zoom: Maxium zoom-out factor allowed.
	 */
	props: ['loader', 'tileSize', 'map', 'zoom'],

	data: function() {
		return {
			offsetX: 0,
			offsetY: 0,
			zoomFactor: 1,
			tileQueue: [],
			hoverInfo: ''
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
			// Reset the cache.
			this.initializeCache();

			// Set the map position to 0, 0 which will be centered.
			// This will trigger a re-render for us too.
			this.setMapPosition(0, 0);
		},

		/**
		 * Invoked when the zoomFactor property changes for this component.
		 * This indicates that the user has scrolled in/out.
		 */
		zoomFactor: function() {
			// Invalidate the cache so that tiles are re-rendered.
			this.initializeCache();

			// Manually trigger a re-render.
			this.render();
		}
	},

	methods: {
		/**
		 * Initialize a fresh cache array.
		 */
		initializeCache: function() {
			this.tileQueue = [];
			this.cache = new Array(MAP_SIZE * MAP_SIZE);
		},

		/**
		 * Process the next tile in the loading queue.
		 */
		checkTileQueue: function() {
			const tile = this.tileQueue.shift();
			if (tile)
				this.loadTile(tile);
			else
				this.awaitingTile = false;
		},

		/**
		 * Add a tile to the queue to be loaded.
		 * @param {number} x 
		 * @param {number} y 
		 * @param {number} index 
		 * @param {number} tileSize 
		 */
		queueTile: function(x, y, index, tileSize) {
			const node = [x, y, index, tileSize];

			if (this.awaitingTile)
				this.tileQueue.push(node);
			else
				this.loadTile(node);
		},

		/**
		 * Load a given tile into the cache.
		 * Triggers a re-render and queue-check once loaded.
		 * @param {Array} tile 
		 */
		loadTile: function(tile) {
			this.awaitingTile = true;

			const [x, y, index, tileSize] = tile;

			// We need to use a local reference to the cache so that async callbacks
			// for tile loading don't overwrite the most current cache if they resolve
			// after a new map has been selected. 
			const cache = this.cache;

			this.$props.loader(x, y, tileSize).then(data => {
				cache[index] = data;

				if (data !== false)
					this.render();

				this.checkTileQueue();
			});
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
			const tileSize = Math.floor(this.$props.tileSize / this.zoomFactor);

			// Get local reference to the canvas context.
			const ctx = this.context;

			// We need to use a local reference to the cache so that async callbacks
			// for tile loading don't overwrite the most current cache if they resolve
			// after a new map has been selected. 
			const cache = this.cache;

			// Iterate over all possible tiles in a map and render as needed.
			//const loaderFunc = this.$props.loader;
			for (let x = 0; x < MAP_SIZE; x++) {
				for (let y = 0; y < MAP_SIZE; y++) {
					// drawX/drawY is the absolute position to draw this tile.
					const drawX = (x * tileSize) + this.offsetX;
					const drawY = (y * tileSize) + this.offsetY;

					// Cache is a one-dimensional array, calculate the index as such.
					const index = (x * MAP_SIZE) + y;
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

						// Add this tile to the loading queue.
						this.queueTile(x, y, index, tileSize);
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
		},

		/**
		 * Convert an absolute client point (such as cursor position) to a relative
		 * position on the map. Returns { tileX, tileY posX, posY }
		 * @param {number} x 
		 * @param {number} y 
		 */
		mapPositionFromClientPoint: function(x, y) {
			const viewport = this.$el.getBoundingClientRect();
			
			const viewOfsX = (x - viewport.x) - this.offsetX;
			const viewOfsY = (y - viewport.y) - this.offsetY;

			const tileSize = Math.floor(this.$props.tileSize / this.zoomFactor);

			const tileX = viewOfsX / tileSize;
			const tileY = viewOfsY / tileSize;

			const posX = MAP_COORD_BASE - (MAP_CHUNK_WEIGHT * tileX);
			const posY = MAP_COORD_BASE - (MAP_CHUNK_WEIGHT * tileY);

			return { tileX: Math.floor(tileX), tileY: Math.floor(tileY), posX, posY };
		},

		/**
		 * Centers the map on a given X, Y in-game position.
		 * @param {number} x 
		 * @param {number} y 
		 */
		setMapPosition: function(x, y) {
			const tileSize = Math.floor(this.$props.tileSize / this.zoomFactor);

			const ofsX = -(((x + MAP_COORD_BASE) / MAP_CHUNK_WEIGHT) * tileSize);
			const ofsY = -(((y + MAP_COORD_BASE) / MAP_CHUNK_WEIGHT) * tileSize);

			const viewport = this.$el;
			this.offsetX = ofsX + (viewport.clientWidth / 2);
			this.offsetY = ofsY + (viewport.clientHeight / 2);

			this.render();
		},

		/**
		 * Invoked when the mouse is moved over the component.
		 * @param {MouseEvent} event 
		 */
		handleMouseOver: function(event) {
			const point = this.mapPositionFromClientPoint(event.clientX, event.clientY);
			this.hoverInfo = util.format('%d %d (%d %d)', Math.floor(point.posX), Math.floor(point.posY), point.tileX, point.tileY);
		},

		/**
		 * Invoked on mousewheel events captured on the container element.
		 * @param {WheelEvent} event 
		 */
		handleMouseWheel: function(event) {
			const delta = event.deltaY > 0 ? 1 : -1;
			const newZoom = Math.max(1, Math.min(this.$props.zoom, this.zoomFactor + delta));

			// Setting the new zoom factor even if it hasn't changed would have no effect due to
			// the zoomFactor watcher being reactive, but we still check it here so that we only
			// pan the map to the new zoom point if we're actually zooming.
			if (newZoom !== this.zoomFactor) {
				// Offset the map to where the user zoomed in. This doesn't re-render automatically.
				//this.centerOnClientPoint(event.clientX, event.clientY);

				// Set the new zoom factor, this will trigger a re-render.
				this.zoomFactor = newZoom;
			}
		}
	},

	/**
	 * HTML mark-up to render for this component.
	 */
	template: `<div class="ui-map-viewer" @mousedown="handleMouseDown" @wheel="handleMouseWheel" @mousemove="handleMouseOver">
		<div class="hover-info">{{ hoverInfo }}</div>
		<canvas ref="canvas"></canvas>
	</div>`
});