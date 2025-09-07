/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const util = require('util');
const core = require('@/js/core');
const constants = require('@/js/constants');

const MAP_SIZE = constants.GAME.MAP_SIZE;
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
	selectCache: new Set(),
	requested: new Set(), // Track which tiles have been requested to avoid duplicate requests
	rendered: new Set(), // Track which tiles are currently rendered on the canvas
	prevOffsetX: 0, // Previous offsets to detect panning vs full redraws
	prevOffsetY: 0,
	prevZoomFactor: 2,
	doubleBuffer: null,
	needsFinalPass: false, // Track if we need to run the final pass after queue is empty
	finalPassTimeout: null, // Timeout for delayed final pass execution
	activeTileRequests: 0, // Track number of tiles currently being loaded
	maxConcurrentTiles: 4 // Maximum number of tiles to load concurrently
};

export default {
	/**
	 * loader: Tile loader function.
	 * tileSize: Base size of tiles (before zoom).
	 * map: ID of the current map. We use this to listen for map changes.
	 * zoom: Maxium zoom-out factor allowed.
	 * mask: Chunk mask. Expected MAP_SIZE ^ 2 array.
	 * selection: Array defining selected tiles.
	 */
	props: ['loader', 'tileSize', 'map', 'zoom', 'mask', 'selection'],
	emits: ['update:selection'],

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
		this.context = this.$refs.canvas.getContext('2d', { willReadFrequently: true });
		this.overlayContext = this.$refs.overlayCanvas.getContext('2d');

		state.doubleBuffer ??= document.createElement('canvas');
		this.doubleBufferContext = state.doubleBuffer.getContext('2d');

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

		// Clean up final pass timeout
		if (state.finalPassTimeout) {
			clearTimeout(state.finalPassTimeout);
			state.finalPassTimeout = null;
		}
	},

	watch: {
		/**
		 * Invoked when the map property changes for this component.
		 * This indicates that a new map has been selected for rendering.
		 */
		map: function() {
			// Reset the cache.
			this.clearTileState();

			// Set the map position to a default position.
			// This will trigger a re-render for us too.
			this.setToDefaultPosition();
		},

		/**
		 * Invoked when the tile being hovered over changes.
		 */
		hoverTile: function() {
			this.renderOverlay();
		}
	},

	methods: {
		/**
		 * Clear tile queue, requested set, and rendered set.
		 * Also reset previous tracking to force full redraw.
		 */
		clearTileState: function() {
			state.tileQueue = [];
			state.requested.clear();
			state.rendered.clear();
			state.prevOffsetX = null;
			state.prevOffsetY = null;
			state.prevZoomFactor = null;
			state.needsFinalPass = false;
			state.activeTileRequests = 0;

			if (state.finalPassTimeout) {
				clearTimeout(state.finalPassTimeout);
				state.finalPassTimeout = null;
			}
		},

		/**
		 * Process tiles in the loading queue up to the concurrency limit.
		 */
		checkTileQueue: function() {
			// Process multiple tiles up to the concurrency limit
			while (state.tileQueue.length > 0 && state.activeTileRequests < state.maxConcurrentTiles) {
				const tile = state.tileQueue.shift();
				this.loadTile(tile);
			}

			// Check if we're done processing all tiles
			if (state.tileQueue.length === 0 && state.activeTileRequests === 0) {
				this.awaitingTile = false;
				// Trigger final pass once all tiles are processed, but only if needed
				// Add a small delay to avoid running it too frequently during rapid panning
				if (state.needsFinalPass) {
					state.needsFinalPass = false;
					if (state.finalPassTimeout)
						clearTimeout(state.finalPassTimeout);

					state.finalPassTimeout = setTimeout(() => {
						this.performFinalPass();
						state.finalPassTimeout = null;
					}, 100);
				}
			}
		},

		/**
		 * Perform a final pass to detect and fix tiles with transparency issues.
		 * This addresses seams caused by tiles being clipped but still marked as rendered.
		 */
		performFinalPass: function() {
			// Skip if no map or canvas available
			if (this.map === null || !this.$refs.canvas)
				return;

			const canvas = this.$refs.canvas;
			const ctx = this.context;
			const viewport = this.$el;
			const tileSize = Math.floor(this.tileSize / state.zoomFactor);
			
			// Calculate viewport bounds relative to canvas
			const bufferX = (canvas.width - viewport.clientWidth) / 2;
			const bufferY = (canvas.height - viewport.clientHeight) / 2;
			
			// Calculate visible tile range
			const startX = Math.max(0, Math.floor(-state.offsetX / tileSize));
			const startY = Math.max(0, Math.floor(-state.offsetY / tileSize));
			const endX = Math.min(MAP_SIZE, startX + Math.ceil(canvas.width / tileSize) + 1);
			const endY = Math.min(MAP_SIZE, startY + Math.ceil(canvas.height / tileSize) + 1);

			const tilesNeedingRerender = [];

			// Check each visible tile for transparency issues
			for (let x = startX; x < endX; x++) {
				for (let y = startY; y < endY; y++) {
					const index = (x * MAP_SIZE) + y;
					
					// Skip if not masked or not supposedly rendered
					if (this.mask && this.mask[index] !== 1)
						continue;
					if (!state.rendered.has(index))
						continue;

					const drawX = (x * tileSize) + state.offsetX;
					const drawY = (y * tileSize) + state.offsetY;
					
					// Skip tiles completely outside viewport
					if (drawX + tileSize <= bufferX || drawX >= bufferX + viewport.clientWidth ||
						drawY + tileSize <= bufferY || drawY >= bufferY + viewport.clientHeight)
						continue;

					// Check if this tile has transparency where it shouldn't
					if (this.tileHasUnexpectedTransparency(drawX, drawY, tileSize)) {
						tilesNeedingRerender.push({ x, y, index, tileSize });
						// Remove from rendered set so it can be re-queued
						state.rendered.delete(index);
						state.requested.delete(index);
					}
				}
			}

			// Re-queue tiles that need re-rendering
			for (const tile of tilesNeedingRerender) {
				this.queueTile(tile.x, tile.y, tile.index, tile.tileSize);
			}
		},

		/**
		 * Check if a tile has unexpected transparency (indicating clipping issues).
		 * Uses efficient sampling to detect transparency without checking every pixel.
		 * @param {number} drawX Canvas X position of tile
		 * @param {number} drawY Canvas Y position of tile  
		 * @param {number} tileSize Size of tile
		 * @returns {boolean} True if tile has unexpected transparency
		 */
		tileHasUnexpectedTransparency: function(drawX, drawY, tileSize) {
			const canvas = this.$refs.canvas;
			const ctx = this.context;
			
			// Clamp tile bounds to canvas
			const left = Math.max(0, Math.floor(drawX));
			const top = Math.max(0, Math.floor(drawY));
			const right = Math.min(canvas.width, Math.ceil(drawX + tileSize));
			const bottom = Math.min(canvas.height, Math.ceil(drawY + tileSize));
			
			// Skip if tile is completely outside canvas
			if (left >= right || top >= bottom)
				return false;
			
			const width = right - left;
			const height = bottom - top;
			
			if (width < 4 || height < 4)
				return false;

			try {
				const imageData = ctx.getImageData(left, top, width, height);
				const data = imageData.data;
				
				const samplePoints = [
					[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1], // corners
					[Math.floor(width / 2), 0], [Math.floor(width / 2), height - 1], // top/bottom center
					[0, Math.floor(height / 2)], [width - 1, Math.floor(height / 2)], // left/right center
					[Math.floor(width / 2), Math.floor(height / 2)] // center
				];

				for (const [px, py] of samplePoints) {
					const index = (py * width + px) * 4;
					const alpha = data[index + 3]; // Alpha channel
					
					if (alpha === 0)
						return true;
				}

				return false;
				
			} catch (error) {
				return false;
			}
		},

		/**
		 * Add a tile to the queue to be loaded if not already requested.
		 * @param {number} x 
		 * @param {number} y 
		 * @param {number} index 
		 * @param {number} tileSize 
		 */
		queueTile: function(x, y, index, tileSize) {
			// Skip if already requested
			if (state.requested.has(index))
				return;
				
			state.requested.add(index);
			const node = [x, y, index, tileSize, 'main'];

			if (this.awaitingTile)
				state.tileQueue.push(node);
			else
				this.loadTile(node);
		},

		/**
		 * Add a tile to the queue to be loaded for double-buffer rendering.
		 * @param {number} x 
		 * @param {number} y 
		 * @param {number} index 
		 * @param {number} tileSize 
		 */
		queueTileForDoubleBuffer: function(x, y, index, tileSize) {
			// Skip if already requested
			if (state.requested.has(index))
				return;
				
			state.requested.add(index);
			const node = [x, y, index, tileSize, 'double-buffer'];

			if (this.awaitingTile)
				state.tileQueue.push(node);
			else
				this.loadTile(node);
		},

		/**
		 * Load a given tile and draw it to the appropriate canvas.
		 * Triggers a queue-check once loaded.
		 * @param {Array} tile 
		 */
		loadTile: function(tile) {
			this.awaitingTile = true;
			state.activeTileRequests++;

			const [x, y, index, tileSize, renderTarget = 'main'] = tile;
			const currentZoomFactor = state.zoomFactor;

			this.loader(x, y, tileSize).then(data => {
				// Only draw if tile loaded successfully and zoom hasn't changed
				if (data !== false && data instanceof ImageData && currentZoomFactor === state.zoomFactor) {
					// Calculate draw position
					const drawX = (x * tileSize) + state.offsetX;
					const drawY = (y * tileSize) + state.offsetY;
					
					if (renderTarget === 'double-buffer') {
						// For double-buffer rendering, draw to both the double-buffer and main canvas
						this.doubleBufferContext.putImageData(data, drawX, drawY);
						this.context.putImageData(data, drawX, drawY);
					} else {
						// For main rendering, draw directly to main canvas
						this.context.putImageData(data, drawX, drawY);
					}

					// Mark this tile as rendered
					state.rendered.add(index);
				}

				// Remove from requested set since loading is complete
				state.requested.delete(index);
				state.activeTileRequests--;
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
		 * Update the position of the internal container with double-buffer optimization.
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

				// Force full redraw when canvas size changes
				state.prevOffsetX = null;
				state.prevOffsetY = null;
				state.prevZoomFactor = null;
			}

			// Update double-buffer dimensions to match
			if (state.doubleBuffer.width !== canvasSize.width || state.doubleBuffer.height !== canvasSize.height) {
				state.doubleBuffer.width = canvasSize.width;
				state.doubleBuffer.height = canvasSize.height;
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

			// Check if this is a simple pan (same zoom, only offset changed)
			const isPan = state.prevZoomFactor === state.zoomFactor && 
						  state.prevOffsetX !== null && state.prevOffsetY !== null;

			if (isPan)
				this.renderWithDoubleBuffer(canvas, canvasSize, tileSize);
			else
				this.renderFullRedraw(canvas, canvasSize, tileSize);

			// Mark that we may need a final pass to check for clipping issues
			state.needsFinalPass = true;

			// Update previous state for next render
			state.prevOffsetX = state.offsetX;
			state.prevOffsetY = state.offsetY;
			state.prevZoomFactor = state.zoomFactor;

			// Render overlays after main canvas rendering
			this.renderOverlay();
		},

		/**
		 * Render using double-buffer technique for efficient panning.
		 */
		renderWithDoubleBuffer: function(canvas, canvasSize, tileSize) {
			const ctx = this.context;
			const doubleCtx = this.doubleBufferContext;
			
			// Calculate the offset delta from last render
			const deltaX = state.offsetX - state.prevOffsetX;
			const deltaY = state.offsetY - state.prevOffsetY;

			// Copy current canvas to double-buffer with the new offset applied
			doubleCtx.clearRect(0, 0, canvasSize.width, canvasSize.height);
			doubleCtx.drawImage(canvas, deltaX, deltaY);

			const viewport = this.$el;
			const bufferX = (canvas.width - viewport.clientWidth) / 2;
			const bufferY = (canvas.height - viewport.clientHeight) / 2;

			// Calculate which tiles should be visible in the current view
			const startX = Math.max(0, Math.floor(-state.offsetX / tileSize));
			const startY = Math.max(0, Math.floor(-state.offsetY / tileSize));
			const endX = Math.min(MAP_SIZE, startX + Math.ceil(canvas.width / tileSize) + 1);
			const endY = Math.min(MAP_SIZE, startY + Math.ceil(canvas.height / tileSize) + 1);

			// Track tiles that should be visible but aren't rendered
			const missingTiles = [];
			const trackedTiles = [];

			// Check all tiles in the visible range
			for (let x = startX; x < endX; x++) {
				for (let y = startY; y < endY; y++) {
					const index = (x * MAP_SIZE) + y;

					// Skip if this tile is masked out
					if (this.mask && this.mask[index] !== 1)
						continue;

					const drawX = (x * tileSize) + state.offsetX;
					const drawY = (y * tileSize) + state.offsetY;
					
					// Check if this tile should be visible in viewport
					const isInViewport = !(drawX + tileSize <= bufferX || drawX >= bufferX + viewport.clientWidth ||
											drawY + tileSize <= bufferY || drawY >= bufferY + viewport.clientHeight);

					if (isInViewport) {
						if (!state.rendered.has(index)) {
							missingTiles.push({ x, y, index, drawX, drawY });
							this.queueTileForDoubleBuffer(x, y, index, tileSize);
						} else {
							trackedTiles.push({ x, y, index });
						}
					}
				}
			}

			// Clean up tiles that are no longer visible anywhere on canvas
			const tilesToRemove = [];
			for (const index of state.rendered) {
				const x = Math.floor(index / MAP_SIZE);
				const y = index % MAP_SIZE;
				const drawX = (x * tileSize) + state.offsetX;
				const drawY = (y * tileSize) + state.offsetY;
				
				if (drawX + tileSize <= 0 || drawX >= canvas.width || drawY + tileSize <= 0 || drawY >= canvas.height)
					tilesToRemove.push(index);
			}
			
			for (let i = 0; i < tilesToRemove.length; i++)
				state.rendered.delete(tilesToRemove[i]);


			// Copy double-buffer back to main canvas
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			ctx.drawImage(state.doubleBuffer, 0, 0);
		},

		/**
		 * Render with full redraw (used for zoom changes, map changes, etc.).
		 */
		renderFullRedraw: function(canvas, canvasSize, tileSize) {
			const ctx = this.context;

			// Clear the entire canvas and rendered set
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			state.rendered.clear();

			// Calculate which tiles are visible
			const startX = Math.max(0, Math.floor(-state.offsetX / tileSize));
			const startY = Math.max(0, Math.floor(-state.offsetY / tileSize));
			const endX = Math.min(MAP_SIZE, startX + Math.ceil(canvas.width / tileSize) + 1);
			const endY = Math.min(MAP_SIZE, startY + Math.ceil(canvas.height / tileSize) + 1);

			const viewport = this.$el;
			const bufferX = (canvas.width - viewport.clientWidth) / 2;
			const bufferY = (canvas.height - viewport.clientHeight) / 2;

			// Queue all visible tiles for loading
			for (let x = startX; x < endX; x++) {
				for (let y = startY; y < endY; y++) {
					const drawX = (x * tileSize) + state.offsetX;
					const drawY = (y * tileSize) + state.offsetY;
					
					if (drawX + tileSize <= bufferX || drawX >= bufferX + viewport.clientWidth ||
						drawY + tileSize <= bufferY || drawY >= bufferY + viewport.clientHeight)
						continue;

					const index = (x * MAP_SIZE) + y;

					// Skip if this tile is masked out
					if (this.mask && this.mask[index] !== 1)
						continue;

					// Queue tile for loading
					this.queueTile(x, y, index, tileSize);
				}
			}
		},

		/**
		 * Render only the overlay canvas with selection and hover states.
		 */
		renderOverlay: function() {
			// If no map has been selected, do not render.
			if (this.map === null)
				return;

			// Get overlay canvas reference
			const overlayCanvas = this.$refs.overlayCanvas;
			if (!overlayCanvas)
				return;

			const overlayCtx = this.overlayContext;
			if (!overlayCtx)
				return;

			// Clear the overlay canvas
			overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

			// Calculate current tile size based on zoom factor
			const tileSize = Math.floor(this.tileSize / state.zoomFactor);
			const canvas = this.$refs.canvas;

			// Calculate which tiles might be visible
			const startX = Math.max(0, Math.floor(-state.offsetX / tileSize));
			const startY = Math.max(0, Math.floor(-state.offsetY / tileSize));
			const endX = Math.min(MAP_SIZE, startX + Math.ceil(canvas.width / tileSize) + 1);
			const endY = Math.min(MAP_SIZE, startY + Math.ceil(canvas.height / tileSize) + 1);

			const viewport = this.$el;
			const bufferX = (canvas.width - viewport.clientWidth) / 2;
			const bufferY = (canvas.height - viewport.clientHeight) / 2;

			// Render overlays for visible tiles
			for (let x = startX; x < endX; x++) {
				for (let y = startY; y < endY; y++) {
					const drawX = (x * tileSize) + state.offsetX;
					const drawY = (y * tileSize) + state.offsetY;
					
					if (drawX + tileSize <= bufferX || drawX >= bufferX + viewport.clientWidth ||
						drawY + tileSize <= bufferY || drawY >= bufferY + viewport.clientHeight)
						continue;

					const index = (x * MAP_SIZE) + y;

					// This chunk is masked out, so skip rendering it.
					if (this.mask && this.mask[index] !== 1)
						continue;

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

				const newSelection = [];
				
				// Iterate over all available tiles in the mask and select them.
				for (let i = 0, n = this.mask.length; i < n; i++) {
					if (this.mask[i] === 1)
						newSelection.push(i);
				}

				this.$emit('update:selection', newSelection);

				// Trigger an overlay re-render to show the new selection.
				this.renderOverlay();
				
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
			}

			const check = this.selection.indexOf(index);
			if (isFirst)
				this.selectState = check > -1;

			if (this.selectState && check > -1)
				this.selection.splice(check, 1);
			else if (!this.selectState && check === -1)
				this.selection.push(index);

			// Trigger an overlay re-render to show the selection change.
			this.renderOverlay();
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

			const viewport = this.$el;
			const maxTileSize = this.tileSize;
			state.offsetX = ofsX + (viewport.clientWidth / 2) + maxTileSize;
			state.offsetY = ofsY + (viewport.clientHeight / 2) + maxTileSize;

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
			this.clearTileState();
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
};