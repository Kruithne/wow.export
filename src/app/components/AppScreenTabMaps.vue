<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<script lang="ts" setup>
	import { state, click } from '../core';
</script>

<template>
	<div class="tab list-tab" id="tab-maps">
		<div class="list-container">
			<list-box id="listbox-maps" :selection="state.selectionMaps" :items="state.mapViewerMaps" :filter="state.userInputFilterMaps" :keyinput="true" :single="true" :regex="state.config.regexFilters" :copymode="state.config.copyMode" :pasteselection="state.config.pasteSelection" :copytrimwhitespace="state.config.removePathSpacesCopy" :includefilecount="true" unittype="map"></list-box>
		</div>
		<div class="filter">
			<div class="regex-info" v-if="state.config.regexFilters" :title="state.regexTooltip">Regex Enabled</div>
			<input type="text" v-model="state.userInputFilterMaps" placeholder="Filter maps..."/>
		</div>
		<map-viewer :map="state.mapViewerSelectedMap" :loader="state.mapViewerTileLoader" :tile-size="512" :zoom="10" :mask="state.mapViewerChunkMask" :selection="state.mapViewerSelection"></map-viewer>
		<div class="spaced-preview-controls">
			<input type="button" value="Export Global WMO" @click="click('export-map-wmo', $event)" :class="{ disabled: state.isBusy || !state.mapViewerHasWorldModel }"/>
			<input type="button" :value="state.mapViewerSelection.length > 0 ? ('Export ' + state.mapViewerSelection.length + ' Tiles') : 'Export Tiles'" @click="click('export-map', $event)" :class="{ disabled: state.isBusy}"/>
		</div>

		<div id="maps-sidebar" class="sidebar">
			<span class="header">Export Options</span>
			<label class="ui-checkbox" title="Export raw files">
				<input type="checkbox" v-model="state.config.mapsExportRaw"/>
				<span>Export Raw</span>
			</label>
			<label class="ui-checkbox" title="Include WMO objects (large objects such as buildings)">
				<input type="checkbox" v-model="state.config.mapsIncludeWMO"/>
				<span>Export WMO</span>
			</label>
			<label class="ui-checkbox" v-if="state.config.mapsIncludeWMO" title="Include objects inside WMOs (interior decorations)">
				<input type="checkbox" v-model="state.config.mapsIncludeWMOSets"/>
				<span>Export WMO Sets</span>
			</label>
			<label class="ui-checkbox" title="Export M2 objects on this tile (smaller objects such as trees)">
				<input type="checkbox" v-model="state.config.mapsIncludeM2"/>
				<span>Export M2</span>
			</label>
			<label class="ui-checkbox" title="Export foliage used on this tile (grass, etc)">
				<input type="checkbox" v-model="state.config.mapsIncludeFoliage"/>
				<span>Export Foliage</span>
			</label>
			<label v-if="!state.config.mapsExportRaw" class="ui-checkbox" title="Export raw liquid data (water, lava, etc)">
				<input type="checkbox" v-model="state.config.mapsIncludeLiquid"/>
				<span>Export Liquids</span>
			</label>
			<label class="ui-checkbox" title="Export client-side interactable objects (signs, banners, etc)">
				<input type="checkbox" v-model="state.config.mapsIncludeGameObjects"/>
				<span>Export G-Objects</span>
			</label>
			<label v-if="!state.config.mapsExportRaw" class="ui-checkbox" title="Include terrain holes for WMOs">
				<input type="checkbox" v-model="state.config.mapsIncludeHoles"/>
				<span>Include Holes</span>
			</label>
			<span class="header">Model Textures</span>
			<label class="ui-checkbox" title="Include textures when exporting models">
				<input type="checkbox" v-model="state.config.modelsExportTextures"/>
				<span>Textures</span>
			</label>
			<label v-if="state.config.modelsExportTextures" class="ui-checkbox" title="Include alpha channel in exported model textures">
				<input type="checkbox" v-model="state.config.modelsExportAlpha"/>
				<span>Texture Alpha</span>
			</label>
			<template v-if="!state.config.mapsExportRaw">
				<span class="header">Terrain Texture Quality</span>
				<menu-button :options="state.menuButtonTextureQuality" :default="state.config.exportMapQuality" @change="state.config.exportMapQuality = $event" :disabled="state.isBusy" :dropdown="true"></menu-button>
			</template>
		</div>
	</div>
</template>