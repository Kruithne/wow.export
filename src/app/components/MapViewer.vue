<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<template>
	<div ref="root" class="ui-map-viewer" @mousedown="handleMouseDown" @wheel="handleMouseWheel" @mousemove="handleMouseOver" @mouseout="handleMouseOut">
		<div class="info">
			<span>Navigate: Click + Drag</span>
			<span>Select Tile: Shift + Click</span>
			<span>Zoom: Mouse Wheel</span>
			<span>Select All: Control + A</span>
		</div>
		<div class="hover-info">{{ hoverInfo }}</div>
		<canvas ref="canvas"></canvas>
	</div>
</template>

<script lang="ts" setup>
	import util from 'node:util';
	import Constants from '../constants';
	import { setToast } from '../core';
	import { ref, reactive, watch, onMounted, onBeforeUnmount } from 'vue';

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

	let offsetX = 0;
	let offsetY = 0;
	let mouseBaseX = 0;
	let mouseBaseY = 0;
	let panBaseX = 0;
	let panBaseY = 0;
	let zoomFactor = 2;

	const tileQueue = ref<MapTile[]>([]);
	const selectCache = reactive(new Set<number>());
	const cache = ref<MapTile[] | boolean>([]);

	const canvas = ref<HTMLCanvasElement>();
	const root = ref<HTMLDivElement>();
	let ctx: CanvasRenderingContext2D;

	const hoverInfo = ref('');
	const hoverTile = ref<number | null>(null);

	let isHovering = false;
	let isPanning = false;
	let isSelecting = false;
	let isAwaitingTile = false;
	let selectState = true;

	const observer = new ResizeObserver(render);

	const props = defineProps({
		/** Tile loader function */
		'loader': { type: Function, required: true },

		/** Base size of tiles (before zoom) */
		'tileSize': { type: Number, required: true },

		/** ID of the current map. We use this to listen for map changes */
		'map': { type: [Number, null], required: true },

		/** Maximum zoom-out factor allowed */
		'zoom': { type: Number, required: true },

		/** Chunk mask. Expected MAP_SIZE ^ 2 array */
		'mask': { type: [Array<number>, null], required: true },

		/** Array defining selected tiles */
		'selection': { type: Array<number>, required: true }
	});

	/** Initialize a fresh cache array. */
	function initializeCache(): void {
		tileQueue.value = new Array<MapTile>();
		cache.value = new Array<MapTile>(Constants.GAME.MAP_SIZE_SQ);
	}

	/** Process the next tile in the loading queue. */
	function checkTileQueue(): void {
		const tile = tileQueue.value.shift();
		tile ? loadTile(tile) : isAwaitingTile = false;
	}

	/** Add a tile to the queue to be loaded. */
	function queueTile(x: number, y: number, index: number, tileSize: number): void {
		const node = { x, y, index, tileSize };
		isAwaitingTile ? tileQueue.value.push(node) : loadTile(node);
	}

	/** Load a given tile into the cache. Triggers a re-render and queue-check once loaded. */
	function loadTile(tile: MapTile): void {
		isAwaitingTile = true;

		// We need to use a local reference to the cache so that async callbacks
		// for tile loading don't overwrite the most current cache if they resolve
		// after a new map has been selected.
		const _cache = cache.value;

		props.loader(tile.x, tile.y, tile.tileSize).then(data => {
			_cache[tile.index] = data;

			if (data !== false)
				render();

			checkTileQueue();
		});
	}

	/**
		* Set the map to a sensible default position. For most maps this will be centered
		* on 0, 0. For maps without a chunk at 0, 0 it will center on the first chunk that
		* is activated in the mask (providing one is set).
		*/
	function setToDefaultPosition(): void {
		let posX = 0, posY = 0;

		// We can only search for a chunk if we have a mask set.
		if (props.mask) {
			// Check if we have a center chunk, if so we can leave the default as 0,0.
			const center = Math.floor(Constants.GAME.MAP_COORD_BASE / Constants.GAME.TILE_SIZE);
			const centerIndex = props.mask[(center * Constants.GAME.MAP_SIZE) + center];

			// No center chunk, find first chunk available.
			if (centerIndex !== 1) {
				const index = props.mask.findIndex((e: number) => e === 1);

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

		setMapPosition(posX, posY);
	}

	/** Update the position of the internal container. */
	function render(): void {
		// If no map has been selected, do not render.
		if (props.map === null)
			return;

		// Update the internal canvas dimensions to match the element.
		canvas.value.width = canvas.value.offsetWidth;
		canvas.value.height = canvas.value.offsetHeight;

		// Viewport width/height defines what is visible to the user.
		const viewportWidth = root.value.clientWidth;
		const viewportHeight = root.value.clientHeight;

		// Calculate which tiles will appear within the viewer.
		const tileSize = Math.floor(props.tileSize / zoomFactor);

		// We need to use a local reference to the cache so that async callbacks
		// for tile loading don't overwrite the most current cache if they resolve
		// after a new map has been selected.
		const _cache = cache.value;

		// Iterate over all possible tiles in a map and render as needed.
		for (let x = 0; x < Constants.GAME.MAP_SIZE; x++) {
			for (let y = 0; y < Constants.GAME.MAP_SIZE; y++) {
				// drawX/drawY is the absolute position to draw this tile.
				const drawX = (x * tileSize) + offsetX;
				const drawY = (y * tileSize) + offsetY;

				// Cache is a one-dimensional array, calculate the index as such.
				const index = (x * Constants.GAME.MAP_SIZE) + y;
				const cached = _cache[index];

				// This chunk is masked out, so skip rendering it.
				if (props.mask && props.mask[index] !== 1)
					continue;

				// Skip tiles that are not in (or around) the viewport.
				if (drawX > (viewportWidth + tileSize) || drawY > (viewportHeight + tileSize) || drawX + tileSize < -tileSize || drawY + tileSize < -tileSize) {
					// Clear out cache entries for tiles no longer in viewport.
					if (cached !== undefined) {
						ctx.clearRect(drawX, drawY, tileSize, tileSize);
						_cache[index] = undefined;
					}

					continue;
				}

				// No cache, request it (async) then skip.
				if (cached === undefined) {
					// Set the tile cache to 'true' so it is skipped while loading.
					_cache[index] = true;

					// Add this tile to the loading queue.
					queueTile(x, y, index, tileSize);
				} else if (cached instanceof ImageData) {
					// If the tile is renderable, render it.
					ctx.putImageData(cached, drawX, drawY);
				}

				// Draw the selection overlay if this tile is selected.
				if (props.selection.includes(index)) {
					ctx.fillStyle = 'rgba(159, 241, 161, 0.5)';
					ctx.fillRect(drawX, drawY, tileSize, tileSize);
				}

				// Draw the hover overlay if this tile is hovered over.
				if (hoverTile.value === index) {
					ctx.fillStyle = 'rgba(87, 175, 226, 0.5)';
					ctx.fillRect(drawX, drawY, tileSize, tileSize);
				}
			}
		}
	}

	/** Invoked when a key press event is fired on the document. */
	function handleKeyPress(event: KeyboardEvent): void {
		// Check if the user cursor is over the map viewer.
		if (isHovering === false)
			return;

		if (event.ctrlKey === true && event.key === 'a') {
			// Without a WDT mask, we can't reliably select everything.
			if (!props.mask) {
				setToast('error', 'Unable to perform Select All operation on this map (Missing WDT)', null, -1);
				return;
			}

			props.selection.length = 0; // Reset the selection array.

			// Iterate over all available tiles in the mask and select them.
			for (let i = 0, n = props.mask.length; i < n; i++) {
				if (props.mask[i] === 1)
					props.selection.push(i);
			}

			// Trigger a re-render to show the new selection.
			render();

			// Absorb this event preventing further action.
			event.preventDefault();
			event.stopPropagation();
		}
	}

	/**
		* @param event - The mouse event that triggered this interaction.
		* @param isFirst - Whether this is the first tile in a selection.
		*/
	function handleTileInteraction(event: MouseEvent, isFirst: boolean = false): void {
		// Calculate which chunk we shift-clicked on.
		const point = mapPositionFromClientPoint(event.clientX, event.clientY);
		const index = (point.tileX * Constants.GAME.MAP_SIZE) + point.tileY;

		// Prevent toggling a tile that we've already touched during this selection.
		if (selectCache.has(index))
			return;

		selectCache.add(index);

		if (props.mask) {
			// If we have a WDT, and this tile is not defined, disallow selection.
			if (props.mask[index] !== 1)
				return;
		} else {
			// No WDT, disallow selection if tile is not rendered.
			if (typeof cache.value[index] !== 'object')
				return;
		}

		const check = props.selection.indexOf(index);
		if (isFirst)
			selectState = check > -1;

		if (selectState && check > -1)
			props.selection.splice(check, 1);
		else if (!selectState && check === -1)
			props.selection.push(index);

		// Trigger a re-render so the overlay updates.
		render();
	}

	/** Invoked on mousemove events captured on the document. */
	function handleMouseMove(event: MouseEvent): void {
		if (isSelecting) {
			handleTileInteraction(event, false);
		} else if (isPanning) {
			// Calculate the distance from our mousedown event.
			const deltaX = mouseBaseX - event.clientX;
			const deltaY = mouseBaseY - event.clientY;

			// Update the offset based on our pan base.
			offsetX = panBaseX - deltaX;
			offsetY = panBaseY - deltaY;

			// Offsets are not reactive, manually trigger an update.
			render();
		}
	}

	/**Invoked on mouseup events captured on the document. */
	function handleMouseUp(): void {
		if (isPanning)
			isPanning = false;

		if (isSelecting) {
			isSelecting = false;
			selectCache.clear();
		}
	}

	/** Invoked on mousedown events captured on the container element. */
	function handleMouseDown(event: MouseEvent): void {
		if (event.shiftKey) {
			handleTileInteraction(event, true);
			isSelecting = true;
		} else if (!isPanning) {
			isPanning = true;

			// Store the X/Y of the mouse event to calculate drag deltas.
			mouseBaseX = event.clientX;
			mouseBaseY = event.clientY;

			// Store the current offsetX/offsetY used for relative panning
			// as the user drags the component.
			panBaseX = offsetX;
			panBaseY = offsetY;
		}
	}

	/**
		* Convert an absolute client point (such as cursor position) to a relative
		* position on the map. Returns { tileX, tileY posX, posY }
		*/
	function mapPositionFromClientPoint(x: number, y: number): MapPosition {
		const viewport = root.value.getBoundingClientRect();

		const viewOfsX = (x - viewport.x) - offsetX;
		const viewOfsY = (y - viewport.y) - offsetY;

		const tileSize = Math.floor(props.tileSize / zoomFactor);

		const tileX = viewOfsX / tileSize;
		const tileY = viewOfsY / tileSize;

		const posX = Constants.GAME.MAP_COORD_BASE - (Constants.GAME.TILE_SIZE * tileX);
		const posY = Constants.GAME.MAP_COORD_BASE - (Constants.GAME.TILE_SIZE * tileY);

		return { tileX: Math.floor(tileX), tileY: Math.floor(tileY), posX: posY, posY: posX };
	}

	/** Centers the map on a given X, Y in-game position. */
	function setMapPosition(x: number, y: number): void {
		// Translate to WoW co-ordinates.
		const tileSize = Math.floor(props.tileSize / zoomFactor);

		const ofsX = (((y - Constants.GAME.MAP_COORD_BASE) / Constants.GAME.TILE_SIZE) * tileSize);
		const ofsY = (((x - Constants.GAME.MAP_COORD_BASE) / Constants.GAME.TILE_SIZE) * tileSize);

		offsetX = ofsX + (root.value.clientWidth / 2);
		offsetY = ofsY + (root.value.clientHeight / 2);

		render();
	}

	/** Set the zoom factor. Invalidates cache, does not re-render the preview. */
	function setZoomFactor(factor: number): void {
		zoomFactor = factor;
		initializeCache(); // Invalidate the cache so that tiles are re-rendered.
	}

	/** Invoked when the mouse is moved over the component. */
	function handleMouseOver(event: MouseEvent): void {
		isHovering = true;

		const point = mapPositionFromClientPoint(event.clientX, event.clientY);
		hoverInfo.value = util.format('%d %d (%d %d)', Math.floor(point.posX), Math.floor(point.posY), point.tileX, point.tileY);

		// If we're not panning, highlight the current tile.
		if (!isPanning)
			hoverTile.value = (point.tileX * Constants.GAME.MAP_SIZE) + point.tileY;
	}

	/** Invoked when the mouse leaves the component. */
	function handleMouseOut(): void {
		isHovering = false;
		hoverTile.value = null;
	}

	/** Invoked on mousewheel events captured on the container element. */
	function handleMouseWheel(event: WheelEvent): void {
		const delta = event.deltaY > 0 ? 1 : -1;
		const newZoom = Math.max(1, Math.min(props.zoom, zoomFactor + delta));

		// Setting the new zoom factor even if it hasn't changed would have no effect due to
		// the zoomFactor watcher being reactive, but we still check it here so that we only
		// pan the map to the new zoom point if we're actually zooming.
		if (newZoom !== zoomFactor) {
			// Get the in-game position of the mouse cursor.
			const point = mapPositionFromClientPoint(event.clientX, event.clientY);

			setZoomFactor(newZoom); // Does not trigger re-render.
			setMapPosition(point.posX, point.posY);
		}
	}

	onMounted(() => {
		// Store a local reference to the canvas context for faster rendering.
		ctx = canvas.value.getContext('2d');

		// Mouse move/up events are registered onto the document so we can
		// still handle them if the user moves off the component while dragging.
		document.addEventListener('mousemove', handleMouseMove);
		document.addEventListener('mouseup', handleMouseUp);

		// Listen for key press evetns to handle Select All function.
		document.addEventListener('keydown', handleKeyPress);

		// Register a resize listener onto the window so we can adjust.
		window.addEventListener('resize', render);

		// We need to also monitor for size changes to the canvas itself so we
		// can keep it relatively positioned.
		observer.observe(root.value);

		// Manually trigger an initial render.
		render();
	});

	onBeforeUnmount(() => {
		// Unregister window resize listener.
		window.removeEventListener('resize', render);

		// Unregister mouse listeners applied to document.
		document.removeEventListener('mousemove', handleMouseMove);
		document.removeEventListener('mouseup', handleMouseUp);

		// Unregister key listener.
		document.removeEventListener('keydown', handleKeyPress);

		// Disconnect the resize observer for the canvas.
		observer.disconnect();
	});

	watch(() => props.map, () => {
		// Reset the cache.
		initializeCache();

		// Set the map position to a default position.
		// This will trigger a re-render for us too.
		setToDefaultPosition();
	});

	watch(hoverTile, () => render());
</script>