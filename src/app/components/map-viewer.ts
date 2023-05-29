/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import util from 'node:util';
import Constants from '../constants';
import State from '../state';
import { defineComponent } from 'vue';

type MapTile = {
	x: number;
	y: number;
	index: number;
	tileSize: number;
};

type MapPosition = {
	tileX: number;
	tileY: number;
	posX: number;
	posY: number;
};

// Persisted state for the map-viewer component. This generally goes against the
// principals of reactive instanced components, but unfortunately nothing else worked
// for maintaining state. This just means we can only have one map-viewer component.
const state = {
	offsetX: 0,
	offsetY: 0,
	zoomFactor: 2,
	tileQueue: [],
	selectCache: new Set(),
	cache: [],
};

export default defineComponent({
	props: {
		/** Tile loader function. */
		'loader': Function,

		/** Base size of tiles (before zoom). */
		'tileSize': Number,

		/** ID of the current map. We use this to listen for map changes. */
		'map': [String, Number],

		/** Maximum zoom-out factor allowed. */
		'zoom': Number,

		/** Chunk mask. Expected MAP_SIZE ^ 2 array. */
		'mask': Array,

		/** Array defining selected tiles. */
		'selection': Array
	},

	data: function() {
		return {
			hoverInfo: '',
			hoverTile: null,
			isHovering: false,
			isPanning: false,
			isSelecting: false,
			selectState: true
		};
	},

	/**
	 * Invoked when this component is mounted in the DOM.
	 */
	mounted: function(): void {
		// Store a local reference to the canvas context for faster rendering.
		this.context = this.$refs.canvas.getContext('2d');

		// Create anonymous pass-through functions for our event handlers
		// to maintain context. We store them so we can unregister them later.
		this.onMouseMove = (event: MouseEvent): void => this.handleMouseMove(event);
		this.onMouseUp = (event: MouseEvent): void => this.handleMouseUp(event);

		// Mouse move/up events are registered onto the document so we can
		// still handle them if the user moves off the component while dragging.
		document.addEventListener('mousemove', this.onMouseMove);
		document.addEventListener('mouseup', this.onMouseUp);

		// Listen for key press evetns to handle Select All function.
		this.onKeyPress = (event: KeyboardEvent): void => this.handleKeyPress(event);
		document.addEventListener('keydown', this.onKeyPress);

		// Register a resize listener onto the window so we can adjust.
		// We use an anonymous function to maintain context, and store it
		// on the instance so we can unregister later.
		this.onResize = (): void => this.render();
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
	beforeDestory: function(): void {
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
		map: function(): void {
			// Reset the cache.
			this.initializeCache();

			// Set the map position to a default position.
			// This will trigger a re-render for us too.
			this.setToDefaultPosition();
		},

		/**
		 * Invoked when the tile being hovered over changes.
		 */
		hoverTile: function(): void {
			this.render();
		}
	},

	methods: {
		/**
		 * Initialize a fresh cache array.
		 */
		initializeCache: function(): void {
			state.tileQueue = [];
			state.cache = new Array(Constants.GAME.MAP_SIZE_SQ);
		},

		/**
		 * Process the next tile in the loading queue.
		 */
		checkTileQueue: function(): void {
			const tile = state.tileQueue.shift();
			if (tile)
				this.loadTile(tile);
			else
				this.awaitingTile = false;
		},

		/**
		 * Add a tile to the queue to be loaded.
		 * @param x
		 * @param y
		 * @param index
		 * @param tileSize
		 */
		queueTile: function(x: number, y: number, index: number, tileSize: number): void {
			const node = { x, y, index, tileSize };

			if (this.awaitingTile)
				state.tileQueue.push(node);
			else
				this.loadTile(node);
		},

		/**
		 * Load a given tile into the cache.
		 * Triggers a re-render and queue-check once loaded.
		 * @param tile
		 */
		loadTile: function(tile: MapTile): void {
			this.awaitingTile = true;

			// We need to use a local reference to the cache so that async callbacks
			// for tile loading don't overwrite the most current cache if they resolve
			// after a new map has been selected.
			const cache = state.cache;

			this.loader(tile.x, tile.y, tile.tileSize).then(data => {
				cache[tile.index] = data;

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
		setToDefaultPosition: function(): void {
			let posX = 0, posY = 0;

			// We can only search for a chunk if we have a mask set.
			if (this.mask) {
				// Check if we have a center chunk, if so we can leave the default as 0,0.
				const center = Math.floor(Constants.GAME.MAP_COORD_BASE / Constants.GAME.TILE_SIZE);
				const centerIndex = this.mask[(center * Constants.GAME.MAP_SIZE) + center];

				// No center chunk, find first chunk available.
				if (centerIndex !== 1) {
					const index = this.mask.findIndex((e: number) => e === 1);

					if (index > -1) {
						// Translate the index into chunk co-ordinates, expand those to in-game co-ordinates
						// and then offset by half a chunk so that we are centered on the chunk.
						const chunkX = index % Constants.GAME.MAP_SIZE;
						const chunkY = Math.floor(index / Constants.GAME.MAP_SIZE);
						posX = ((chunkX - 32) * Constants.GAME.TILE_SIZE) * -1;
						posY = ((chunkY - 32) * Constants.GAME.TILE_SIZE) * -1;
					}
				}
			}

			this.setMapPosition(posX, posY);
		},

		/**
		 * Update the position of the internal container.
		 */
		render: function(): void {
			// If no map has been selected, do not render.
			if (this.map === null)
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
			const tileSize = Math.floor(this.tileSize / state.zoomFactor);

			// Get local reference to the canvas context.
			const ctx = this.context;

			// We need to use a local reference to the cache so that async callbacks
			// for tile loading don't overwrite the most current cache if they resolve
			// after a new map has been selected.
			const cache = state.cache;

			// Iterate over all possible tiles in a map and render as needed.
			for (let x = 0; x < Constants.GAME.MAP_SIZE; x++) {
				for (let y = 0; y < Constants.GAME.MAP_SIZE; y++) {
					// drawX/drawY is the absolute position to draw this tile.
					const drawX = (x * tileSize) + state.offsetX;
					const drawY = (y * tileSize) + state.offsetY;

					// Cache is a one-dimensional array, calculate the index as such.
					const index = (x * Constants.GAME.MAP_SIZE) + y;
					const cached = cache[index];

					// This chunk is masked out, so skip rendering it.
					if (this.mask && this.mask[index] !== 1)
						continue;

					// Skip tiles that are not in (or around) the viewport.
					if (drawX > (viewportWidth + tileSize) || drawY > (viewportHeight + tileSize) || drawX + tileSize < -tileSize || drawY + tileSize < -tileSize) {
						// Clear out cache entries for tiles no longer in viewport.
						if (cached !== undefined) {
							ctx.clearRect(drawX, drawY, tileSize, tileSize);
							cache[index] = undefined;
						}

						continue;
					}

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

					// Draw the selection overlay if this tile is selected.
					if (this.selection.includes(index)) {
						ctx.fillStyle = 'rgba(159, 241, 161, 0.5)';
						ctx.fillRect(drawX, drawY, tileSize, tileSize);
					}

					// Draw the hover overlay if this tile is hovered over.
					if (this.hoverTile === index) {
						ctx.fillStyle = 'rgba(87, 175, 226, 0.5)';
						ctx.fillRect(drawX, drawY, tileSize, tileSize);
					}
				}
			}
		},

		/**
		 * Invoked when a key press event is fired on the document.
		 * @param event
		 */
		handleKeyPress: function(event: KeyboardEvent): void {
			// Check if the user cursor is over the map viewer.
			if (this.isHovering === false)
				return;

			if (event.ctrlKey === true && event.key === 'a') {
				// Without a WDT mask, we can't reliably select everything.
				if (!this.mask) {
					State.state.setToast('error', 'Unable to perform Select All operation on this map (Missing WDT)', null, -1);
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
		 * @param event - The mouse event that triggered this interaction.
		 * @param isFirst - Whether this is the first tile in a selection.
		 */
		handleTileInteraction: function(event: MouseEvent, isFirst: boolean = false): void {
			// Calculate which chunk we shift-clicked on.
			const point = this.mapPositionFromClientPoint(event.clientX, event.clientY);
			const index = (point.tileX * Constants.GAME.MAP_SIZE) + point.tileY;

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
		 * @param event - The mouse event that triggered this interaction.
		 */
		handleMouseMove: function(event: MouseEvent): void {
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

		/**Invoked on mouseup events captured on the document. */
		handleMouseUp: function(): void {
			if (this.isPanning)
				this.isPanning = false;

			if (this.isSelecting) {
				this.isSelecting = false;
				state.selectCache.clear();
			}
		},

		/**
		 * Invoked on mousedown events captured on the container element.
		 * @param event - The mouse event that triggered this interaction.
		 */
		handleMouseDown: function(event: MouseEvent): void {
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
		 * @param x
		 * @param y
		 */
		mapPositionFromClientPoint: function(x: number, y: number): MapPosition {
			const viewport = this.$el.getBoundingClientRect();

			const viewOfsX = (x - viewport.x) - state.offsetX;
			const viewOfsY = (y - viewport.y) - state.offsetY;

			const tileSize = Math.floor(this.tileSize / state.zoomFactor);

			const tileX = viewOfsX / tileSize;
			const tileY = viewOfsY / tileSize;

			const posX = Constants.GAME.MAP_COORD_BASE - (Constants.GAME.TILE_SIZE * tileX);
			const posY = Constants.GAME.MAP_COORD_BASE - (Constants.GAME.TILE_SIZE * tileY);

			return { tileX: Math.floor(tileX), tileY: Math.floor(tileY), posX: posY, posY: posX };
		},

		/**
		 * Centers the map on a given X, Y in-game position.
		 * @param x
		 * @param y
		 */
		setMapPosition: function(x: number, y: number): void {
			// Translate to WoW co-ordinates.
			const posX = y;
			const posY = x;

			const tileSize = Math.floor(this.tileSize / state.zoomFactor);

			const ofsX = (((posX - Constants.GAME.MAP_COORD_BASE) / Constants.GAME.TILE_SIZE) * tileSize);
			const ofsY = (((posY - Constants.GAME.MAP_COORD_BASE) / Constants.GAME.TILE_SIZE) * tileSize);

			const viewport = this.$el;
			state.offsetX = ofsX + (viewport.clientWidth / 2);
			state.offsetY = ofsY + (viewport.clientHeight / 2);

			this.render();
		},

		/**
		 * Set the zoom factor. This will invalidate the cache.
		 * This function will not re-render the preview.
		 * @param factor
		 */
		setZoomFactor: function(factor: number): void {
			state.zoomFactor = factor;

			// Invalidate the cache so that tiles are re-rendered.
			this.initializeCache();
		},

		/**
		 * Invoked when the mouse is moved over the component.
		 * @param event - The mouse event that triggered this interaction.
		 */
		handleMouseOver: function(event: MouseEvent): void {
			this.isHovering = true;

			const point = this.mapPositionFromClientPoint(event.clientX, event.clientY);
			this.hoverInfo = util.format('%d %d (%d %d)', Math.floor(point.posX), Math.floor(point.posY), point.tileX, point.tileY);

			// If we're not panning, highlight the current tile.
			if (!this.isPanning)
				this.hoverTile = (point.tileX * Constants.GAME.MAP_SIZE) + point.tileY;
		},

		/**
		 * Invoked when the mouse leaves the component.
		 */
		handleMouseOut: function(): void {
			this.isHovering = false;

			// Remove the current hover overlay.
			this.hoverTile = null;
		},

		/**
		 * Invoked on mousewheel events captured on the container element.
		 * @param event
		 */
		handleMouseWheel: function(event: WheelEvent): void {
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
	</div>`
});