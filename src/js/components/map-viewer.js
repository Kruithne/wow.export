/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const util = require('util');
const core = require('../core');
const constants = require('../constants');

const MAP_SIZE = constants.GAME.MAP_SIZE;
const MAP_SIZE_SQ = constants.GAME.MAP_SIZE_SQ;
const MAP_COORD_BASE = constants.GAME.MAP_COORD_BASE;
const TILE_SIZE = constants.GAME.TILE_SIZE;

// Persisted state for the map-viewer component. This generally goes against the
// principals of reactive instanced components, but unfortunately nothing else worked
// for maintaining state. This just means we can only have one map-viewer component.
const state = {
	offsetX: 0,
	offsetY: 0,
	zoomFactor: 2,
	tileQueue: [],
	selectCache: new Set()
};

Vue.component('map-viewer', {
	/**
	 * loader: Tile loader function.
	 * tileSize: Base size of tiles (before zoom).
	 * map: ID of the current map. We use this to listen for map changes.
	 * zoom: Maxium zoom-out factor allowed.
	 * mask: Chunk mask. Expected MAP_SIZE ^ 2 array.
	 * selection: Array defining selected tiles.
	 */
	props: ['loader', 'tileSize', 'map', 'zoom', 'mask', 'selection'],

	data: function() {
		return {
			hoverInfo: '',
			hoverTile: null,
			isHovering: false,
			isPanning: false,
			isSelecting: false,
			selectState: true
		}
	},

	/**
	 * Invoked when this component is mounted in the DOM.
	 */
	mounted: function() {
		// Store a local reference to the canvas context for faster rendering.
		this.context = this.$refs.canvas.getContext('2d');
		this.overlayContext = this.$refs.overlayCanvas.getContext('2d');

		// Create anonymous pass-through functions for our event handlers
		// to maintain context. We store them so we can unregister them later.
		this.onMouseMove = event => this.handleMouseMove(event);
		this.onMouseUp = event => this.handleMouseUp(event);

		// Mouse move/up events are registered onto the document so we can
		// still handle them if the user moves off the component while dragging.
		document.addEventListener('mousemove', this.onMouseMove);
		document.addEventListener('mouseup', this.onMouseUp);

		// Listen for key press evetns to handle Select All function.
		this.onKeyPress = event => this.handleKeyPress(event);
		document.addEventListener('keydown', this.onKeyPress);

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

		// Unregister key listener.
		document.removeEventListener('keydown', this.onKeyPress);

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

			// Set the map position to a default position.
			// This will trigger a re-render for us too.
			this.setToDefaultPosition();
		},

		/**
		 * Invoked when the tile being hovered over changes.
		 */
		hoverTile: function() {
			this.render();
		}
	},

	methods: {
		/**
		 * Initialize a fresh cache array.
		 */
		initializeCache: function() {
			state.tileQueue = [];
			state.cache = new Array(MAP_SIZE_SQ);
		},

		/**
		 * Process the next tile in the loading queue.
		 */
		checkTileQueue: function() {
			const tile = state.tileQueue.shift();
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
				state.tileQueue.push(node);
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
			const cache = state.cache;

			this.loader(x, y, tileSize).then(data => {
				cache[index] = data;

				if (data !== false)
					this.render();

				this.checkTileQueue();
			});
		},

		/**
		 * Set the map to a sensible default position. For most maps this will be centered
		 * on 0, 0. For maps without a chunk at 0, 0 it will center on the first chunk that
		 * is activated in the mask (providing one is set).
		 */
		setToDefaultPosition: function() {
			let posX = 0, posY = 0;

			// We can only search for a chunk if we have a mask set.
			if (this.mask) {
				// Check if we have a center chunk, if so we can leave the default as 0,0.
				const center = Math.floor(MAP_COORD_BASE / TILE_SIZE);
				const centerIndex = this.mask[(center * MAP_SIZE) + center];
				
				// No center chunk, find first chunk available.
				if (centerIndex !== 1) {
					const index = this.mask.findIndex(e => e === 1);

					if (index > -1) {
						// Translate the index into chunk co-ordinates, expand those to in-game co-ordinates
						// and then offset by half a chunk so that we are centered on the chunk.
						const chunkX = index % MAP_SIZE;
						const chunkY = Math.floor(index / MAP_SIZE);
						posX = ((chunkX - 32) * TILE_SIZE) * -1;
						posY = ((chunkY - 32) * TILE_SIZE) * -1;
					}
				}
			}

			this.setMapPosition(posX, posY);
		},


		/**
		 * Calculate optimal canvas dimensions based on tile size and zoom levels.
		 * Canvas is sized to accommodate full tiles with a buffer zone that ensures
		 * tiles are never rendered partially at any zoom level.
		 */
		calculateCanvasSize: function() {
			const viewport = this.$el;
			const viewportWidth = viewport.clientWidth;
			const viewportHeight = viewport.clientHeight;

			// Buffer must be large enough for the largest possible tile (zoom factor = 1)
			const maxTileSize = this.tileSize; // At zoom factor 1 (most zoomed in)
			
			// Canvas needs to be viewport size + buffer on all sides to ensure full tiles
			return {
				width: viewportWidth + (maxTileSize * 2), // +1 tile buffer on each side
				height: viewportHeight + (maxTileSize * 2) // +1 tile buffer on each side
			};
		},

		/**
		 * Update the position of the internal container.
		 */
		render: function() {
			// If no map has been selected, do not render.
			if (this.map === null)
				return;

			// No canvas reference? Component likely dismounting.
			const canvas = this.$refs.canvas;
			if (!canvas)
				return;

			// Calculate optimal canvas size
			const canvasSize = this.calculateCanvasSize();
			
			// Update canvas dimensions only if they've changed to avoid unnecessary redraws
			if (canvas.width !== canvasSize.width || canvas.height !== canvasSize.height) {
				canvas.width = canvasSize.width;
				canvas.height = canvasSize.height;
			}

			// Update overlay canvas dimensions to match
			const overlayCanvas = this.$refs.overlayCanvas;
			if (overlayCanvas) {
				if (overlayCanvas.width !== canvasSize.width || overlayCanvas.height !== canvasSize.height) {
					overlayCanvas.width = canvasSize.width;
					overlayCanvas.height = canvasSize.height;
				}
			}

			// Calculate current tile size based on zoom factor
			const tileSize = Math.floor(this.tileSize / state.zoomFactor);

			// Get local reference to the canvas context.
			const ctx = this.context;

			// Clear the entire canvas before redrawing
			ctx.clearRect(0, 0, canvas.width, canvas.height);

			// Get local reference to the overlay canvas context and clear it
			const overlayCtx = overlayCanvas ? this.overlayContext : null;
			overlayCtx?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

			// We need to use a local reference to the cache so that async callbacks
			// for tile loading don't overwrite the most current cache if they resolve
			// after a new map has been selected. 
			const cache = state.cache;

			// Calculate which tiles are visible in the canvas area
			const startX = Math.max(0, Math.floor(-state.offsetX / tileSize));
			const startY = Math.max(0, Math.floor(-state.offsetY / tileSize));
			const endX = Math.min(MAP_SIZE, startX + Math.ceil(canvas.width / tileSize) + 1);
			const endY = Math.min(MAP_SIZE, startY + Math.ceil(canvas.height / tileSize) + 1);

			// Iterate only over tiles that might be visible in the canvas
			for (let x = startX; x < endX; x++) {
				for (let y = startY; y < endY; y++) {
					// drawX/drawY is the position to draw this tile on the canvas
					const drawX = (x * tileSize) + state.offsetX;
					const drawY = (y * tileSize) + state.offsetY;

					// Only render tiles that fit COMPLETELY within canvas bounds
					if (drawX < 0 || drawY < 0 || drawX + tileSize > canvas.width || drawY + tileSize > canvas.height)
						continue;

					// Cache is a one-dimensional array, calculate the index as such.
					const index = (x * MAP_SIZE) + y;
					const cached = cache[index];

					// This chunk is masked out, so skip rendering it.
					if (this.mask && this.mask[index] !== 1)
						continue;

					// No cache, request it (async) then skip.
					if (cached === undefined) {
						// Set the tile cache to 'true' so it is skipped while loading.
						cache[index] = true;

						// Add this tile to the loading queue.
						this.queueTile(x, y, index, tileSize);
					} else if (cached instanceof ImageData) {
						// If the tile is renderable, render it.
						ctx.putImageData(cached, drawX, drawY);
					}

					// Render overlays for this tile if overlay canvas exists
					if (overlayCtx) {
						// Draw the selection overlay if this tile is selected.
						if (this.selection.includes(index)) {
							overlayCtx.fillStyle = 'rgba(159, 241, 161, 0.5)';
							overlayCtx.fillRect(drawX, drawY, tileSize, tileSize);	
						}

						// Draw the hover overlay if this tile is hovered over.
						if (this.hoverTile === index) {
							overlayCtx.fillStyle = 'rgba(87, 175, 226, 0.5)';
							overlayCtx.fillRect(drawX, drawY, tileSize, tileSize);
						}
					}
				}
			}

		},

		/**
		 * Invoked when a key press event is fired on the document.
		 * @param {KeyboardEvent} event 
		 */
		handleKeyPress: function(event) {
			// Check if the user cursor is over the map viewer.
			if (this.isHovering === false)
				return;

			if (event.ctrlKey === true && event.key === 'a') {
				// Without a WDT mask, we can't reliably select everything.
				if (!this.mask) {
					core.setToast('error', 'Unable to perform Select All operation on this map (Missing WDT)', null, -1);
					return;
				}

				this.selection.length = 0; // Reset the selection array.
				
				// Iterate over all available tiles in the mask and select them.
				for (let i = 0, n = this.mask.length; i < n; i++) {
					if (this.mask[i] === 1)
						this.selection.push(i);
				}

				// Trigger a re-render to show the new selection.
				this.render();
				
				// Absorb this event preventing further action.
				event.preventDefault();
				event.stopPropagation();
			}
		},

		/**
		 * @param {MouseEvent} event 
		 * @returns 
		 */
		handleTileInteraction: function(event, isFirst = false) {
			// Calculate which chunk we shift-clicked on.
			const point = this.mapPositionFromClientPoint(event.clientX, event.clientY);
			const index = (point.tileX * MAP_SIZE) + point.tileY;

			// Prevent toggling a tile that we've already touched during this selection.
			if (state.selectCache.has(index))
				return;

			state.selectCache.add(index);

			if (this.mask) {
				// If we have a WDT, and this tile is not defined, disallow selection.
				if (this.mask[index] !== 1)
					return;
			} else {
				// No WDT, disallow selection if tile is not rendered.
				if (typeof state.cache[index] !== 'object')
					return;
			}

			const check = this.selection.indexOf(index);
			if (isFirst)
				this.selectState = check > -1;

			if (this.selectState && check > -1)
				this.selection.splice(check, 1);
			else if (!this.selectState && check === -1)
				this.selection.push(index);

			// Trigger a re-render so the overlay updates.
			this.render();
		},

		/**
		 * Invoked on mousemove events captured on the document.
		 * @param {MouseEvent} event
		 */
		handleMouseMove: function(event) {
			if (this.isSelecting) {
				this.handleTileInteraction(event, false);
			} else if (this.isPanning) {
				// Calculate the distance from our mousedown event.
				const deltaX = this.mouseBaseX - event.clientX;
				const deltaY = this.mouseBaseY - event.clientY;

				// Update the offset based on our pan base.
				state.offsetX = this.panBaseX - deltaX;
				state.offsetY = this.panBaseY - deltaY;

				// Offsets are not reactive, manually trigger an update.
				this.render();
			}
		},

		/**
		 * Invoked on mouseup events captured on the document.
		 */
		handleMouseUp: function() {
			if (this.isPanning)
				this.isPanning = false;

			if (this.isSelecting) {
				this.isSelecting = false;
				state.selectCache.clear();
			}
		},

		/**
		 * Invoked on mousedown events captured on the container element.
		 * @param {MouseEvent} event
		 */
		handleMouseDown: function(event) {
			if (event.shiftKey) {
				this.handleTileInteraction(event, true);
				this.isSelecting = true;
			} else if (!this.isPanning) {
				this.isPanning = true;

				// Store the X/Y of the mouse event to calculate drag deltas.
				this.mouseBaseX = event.clientX;
				this.mouseBaseY = event.clientY;

				// Store the current offsetX/offsetY used for relative panning
				// as the user drags the component.
				this.panBaseX = state.offsetX;
				this.panBaseY = state.offsetY;
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
			const canvas = this.$refs.canvas;
			
			// Calculate canvas position relative to viewport (centered)
			const canvasOffsetX = (viewport.width - canvas.width) / 2;
			const canvasOffsetY = (viewport.height - canvas.height) / 2;
			
			// Convert client coordinates to canvas coordinates
			const viewOfsX = (x - viewport.x - canvasOffsetX) - state.offsetX;
			const viewOfsY = (y - viewport.y - canvasOffsetY) - state.offsetY;

			const tileSize = Math.floor(this.tileSize / state.zoomFactor);

			const tileX = viewOfsX / tileSize;
			const tileY = viewOfsY / tileSize;

			const posX = MAP_COORD_BASE - (TILE_SIZE * tileX);
			const posY = MAP_COORD_BASE - (TILE_SIZE * tileY);

			return { tileX: Math.floor(tileX), tileY: Math.floor(tileY), posX: posY, posY: posX };
		},

		/**
		 * Centers the map on a given X, Y in-game position.
		 * @param {number} x 
		 * @param {number} y 
		 */
		setMapPosition: function(x, y) {
			// Translate to WoW co-ordinates.
			const posX = y;
			const posY = x;

			const tileSize = Math.floor(this.tileSize / state.zoomFactor);

			const ofsX = (((posX - MAP_COORD_BASE) / TILE_SIZE) * tileSize);
			const ofsY = (((posY - MAP_COORD_BASE) / TILE_SIZE) * tileSize);

			const canvas = this.$refs.canvas;
			// Center the position on the canvas (canvas is now larger than viewport and centered)
			state.offsetX = ofsX + (canvas.width / 2);
			state.offsetY = ofsY + (canvas.height / 2);

			this.render();
		},

		/**
		 * Set the zoom factor. This will invalidate the cache.
		 * This function will not re-render the preview.
		 * @param {number} factor 
		 */
		setZoomFactor: function(factor) {
			state.zoomFactor = factor;

			// Invalidate the cache so that tiles are re-rendered.
			this.initializeCache();
		},

		/**
		 * Invoked when the mouse is moved over the component.
		 * @param {MouseEvent} event 
		 */
		handleMouseOver: function(event) {
			this.isHovering = true;

			const point = this.mapPositionFromClientPoint(event.clientX, event.clientY);
			this.hoverInfo = util.format('%d %d (%d %d)', Math.floor(point.posX), Math.floor(point.posY), point.tileX, point.tileY);

			// If we're not panning, highlight the current tile.
			if (!this.isPanning)
				this.hoverTile = (point.tileX * MAP_SIZE) + point.tileY;
		},

		/**
		 * Invoked when the mouse leaves the component.
		 */
		handleMouseOut: function() {
			this.isHovering = false;

			// Remove the current hover overlay.
			this.hoverTile = null;
		},

		/**
		 * Invoked on mousewheel events captured on the container element.
		 * @param {WheelEvent} event 
		 */
		handleMouseWheel: function(event) {
			const delta = event.deltaY > 0 ? 1 : -1;
			const newZoom = Math.max(1, Math.min(this.zoom, state.zoomFactor + delta));

			// Setting the new zoom factor even if it hasn't changed would have no effect due to
			// the zoomFactor watcher being reactive, but we still check it here so that we only
			// pan the map to the new zoom point if we're actually zooming.
			if (newZoom !== state.zoomFactor) {
				// Get the in-game position of the mouse cursor.
				const point = this.mapPositionFromClientPoint(event.clientX, event.clientY);

				// Set the new zoom factor. This will not trigger a re-render.
				this.setZoomFactor(newZoom);

				// Pan the map to the cursor position.
				this.setMapPosition(point.posX, point.posY);
			}
		}
	},

	/**
	 * HTML mark-up to render for this component.
	 */
	template: `<div class="ui-map-viewer" @mousedown="handleMouseDown" @wheel="handleMouseWheel" @mousemove="handleMouseOver" @mouseout="handleMouseOut">
		<div class="info">
			<span>Navigate: Click + Drag</span>
			<span>Select Tile: Shift + Click</span>
			<span>Zoom: Mouse Wheel</span>
			<span>Select All: Control + A</span>
		</div>
		<div class="hover-info">{{ hoverInfo }}</div>
		<canvas ref="canvas"></canvas>
		<canvas ref="overlayCanvas" class="overlay-canvas"></canvas>
	</div>`
});