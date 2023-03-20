<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<script lang="ts" setup>
	import { state, click, setScreen } from '../core';
	import { previewTextureByID } from '../ui/tab-textures';
	import * as TextureRibbon from '../ui/texture-ribbon';
	import { setClipboard } from '../system';
	import Listfile from '../casc/listfile';
	import ExportHelper from '../casc/export-helper';

	function setAllWMOGroups(setState: boolean): void {
		if (state.modelViewerWMOGroups) {
			for (const node of state.modelViewerWMOGroups)
				node.checked = setState;
		}
	}

	function setAllGeosets(setState: boolean): void {
		if (state.modelViewerGeosets) {
			for (const node of state.modelViewerGeosets)
				node.checked = setState;
		}
	}

	function goToTexture(fileDataID: number): void {
		setScreen('tab-textures');

		// Directly preview the requested file, even if it's not in the listfile.
		previewTextureByID(fileDataID);

		// Since we're doing a direct preview, we need to reset the users current
		// selection, so if they hit export, they get the expected result.
		state.selectionTextures.splice(0);

		// Despite direct preview, *attempt* to filter for the file as well.
		if (state.config.listfileShowFileDataIDs) {
			// If the user has fileDataIDs shown, filter by that.
			if (state.config.regexFilters)
				state.userInputFilterTextures = '\\[' + fileDataID + '\\]';
			else
				state.userInputFilterTextures = '[' + fileDataID + ']';
		} else {
			// Without fileDataIDs, lookup the texture name and filter by that.
			const fileName = Listfile.getByID(fileDataID);
			if (fileName !== undefined)
				state.userInputFilterTextures = fileName;
			else if (state.config.enableUnknownFiles)
				state.userInputFilterTextures = Listfile.formatUnknownFile(fileDataID, '.blp');
		}
	}
</script>

<template>
	<div class="tab list-tab" id="tab-models">
		<div class="list-container">
			<list-box
				:selection="state.selectionModels"
				:items="state.listfileModels"
				:override="state.overrideModelList"
				:filter="state.userInputFilterModels"
				:keyinput="true"
				:regex="state.config.regexFilters"
				:copymode="state.config.copyMode"
				:pasteselection="state.config.pasteSelection"
				:copytrimwhitespace="state.config.removePathSpacesCopy"
				:includefilecount="true"
				unittype="model"
			></list-box>
		</div>
		<div class="filter">
			<div class="regex-info" v-if="state.config.regexFilters" :title="state.regexTooltip">Regex Enabled</div>
			<input type="text" v-model="state.userInputFilterModels" placeholder="Filter models..."/>
		</div>
		<div class="preview-container">
			<resize-layer @resize="TextureRibbon.onResize" id="texture-ribbon" v-if="state.config.modelViewerShowTextures && state.textureRibbonStack.length > 0">
				<div id="texture-ribbon-prev" v-if="state.textureRibbonPage > 0" @click.self="state.textureRibbonPage--"></div>
				<div v-for="slot in state.textureRibbonDisplay" :title="slot.displayName" :style="{ backgroundImage: 'url(' + slot.src + ')' }" class="slot" @click="state.contextMenus.nodeTextureRibbon = slot"></div>
				<div id="texture-ribbon-next" v-if="state.textureRibbonPage < state.textureRibbonMaxPages - 1" @click.self="state.textureRibbonPage++"></div>
				<context-menu :node="state.contextMenus.nodeTextureRibbon" v-slot="context" @close="state.contextMenus.nodeTextureRibbon = null">
					<span @click.self="click('preview-texture', $event, context.node.fileDataID, context.node.displayName)">Preview {{ context.node.displayName }}</span>
					<span @click.self="goToTexture(context.node.fileDataID)">Go to {{ context.node.displayName }}</span>
					<span @click.self="setClipboard(context.node.fileDataID)">Copy file data ID to clipboard</span>
					<span @click.self="setClipboard(context.node.displayName)">Copy texture name to clipboard</span>
					<span @click.self="setClipboard(context.node.fileName)">Copy file path to clipboard</span>
					<span @click.self="setClipboard(ExportHelper.getExportPath(context.node.fileName))">Copy export path to clipboard</span>
				</context-menu>
			</resize-layer>
			<div id="model-texture-preview" v-if="state.modelTexturePreviewURL.length > 0" class="preview-background">
				<div id="model-texture-preview-toast" @click="state.modelTexturePreviewURL = ''">Previewing {{ state.modelTexturePreviewName }}, click here to return to the model</div>
				<div class="image" :style="{ 'max-width': state.modelTexturePreviewWidth + 'px', 'max-height': state.modelTexturePreviewHeight + 'px' }">
					<div class="image" :style="{ 'background-image': 'url(' + state.modelTexturePreviewURL + ')' }"></div>
				</div>
			</div>
			<div class="preview-background" id="model-preview">
				<model-viewer :context="state.modelViewerContext"></model-viewer>
			</div>
		</div>
		<div class="preview-controls">
			<menu-button :options="state.menuButtonModels" :default="state.config.exportModelFormat" @change="state.config.exportModelFormat = $event" class="upward" :disabled="state.isBusy" @click="click('export-model', $event)"></menu-button>
		</div>
		<div id="model-sidebar" class="sidebar">
			<span class="header">Listing</span>
			<label class="ui-checkbox" title="Include M2 objects in the list">
				<input type="checkbox" v-model="state.config.modelsShowM2"/>
				<span>Show M2</span>
			</label>
			<label class="ui-checkbox" title="Include WMO objects in the list">
				<input type="checkbox" v-model="state.config.modelsShowWMO"/>
				<span>Show WMO</span>
			</label>
			<span class="header">Preview</span>
			<label class="ui-checkbox" title="Automatically preview a model when selecting it">
				<input type="checkbox" v-model="state.config.modelsAutoPreview"/>
				<span>Auto Preview</span>
			</label>
			<label class="ui-checkbox" title="Automatically adjust camera when selecting a new model">
				<input type="checkbox" v-model="state.modelViewerAutoAdjust"/>
				<span>Auto Camera</span>
			</label>
			<label class="ui-checkbox" title="Show a grid in the 3D viewport">
				<input type="checkbox" v-model="state.config.modelViewerShowGrid"/>
				<span>Show Grid</span>
			</label>
			<label class="ui-checkbox" title="Render the preview model as a wireframe">
				<input type="checkbox" v-model="state.config.modelViewerWireframe"/>
				<span>Show Wireframe</span>
			</label>
			<label class="ui-checkbox" title="Show model textures in the preview pane">
				<input type="checkbox" v-model="state.config.modelViewerShowTextures"/>
				<span>Show Textures</span>
			</label>
			<span class="header">Export</span>
			<label class="ui-checkbox" title="Include textures when exporting models">
				<input type="checkbox" v-model="state.config.modelsExportTextures"/>
				<span>Textures</span>
			</label>
			<label v-if="state.config.modelsExportTextures" class="ui-checkbox" title="Include alpha channel in exported model textures">
				<input type="checkbox" v-model="state.config.modelsExportAlpha"/>
				<span>Texture Alpha</span>
			</label>
			<template v-if="state.config.exportModelFormat === 'RAW'">
				<label class="ui-checkbox" title="Export raw .skin files with M2 exports">
					<input type="checkbox" v-model="state.config.modelsExportSkin"/>
					<span>M2 .skin Files</span>
				</label>
				<label class="ui-checkbox" title="Export raw .skel files with M2 exports">
					<input type="checkbox" v-model="state.config.modelsExportSkel"/>
					<span>M2 .skel Files</span>
				</label>
				<label class="ui-checkbox" title="Export raw .bone files with M2 exports">
					<input type="checkbox" v-model="state.config.modelsExportBone"/>
					<span>M2 .bone Files</span>
				</label>
				<label class="ui-checkbox" title="Export raw .anim files with M2 exports">
					<input type="checkbox" v-model="state.config.modelsExportAnim"/>
					<span>M2 .anim files</span>
				</label>
				<label class="ui-checkbox" title="Export WMO group files">
					<input type="checkbox" v-model="state.config.modelsExportWMOGroups"/>
					<span>WMO Groups</span>
				</label>
			</template>
			<template v-if="state.modelViewerActiveType === 'm2'">
				<span class="header">Geosets</span>
				<checkbox-list :items="state.modelViewerGeosets"></checkbox-list>
				<div class="list-toggles">
					<a @click="setAllGeosets(true)">Enable All</a> / <a @click="setAllGeosets(false)">Disable All</a>
				</div>
				<template v-if="state.config.modelsExportTextures">
					<span class="header">Skins</span>
					<list-box-b :items="state.modelViewerSkins" :selection="state.modelViewerSkinsSelection" :single="true"></list-box-b>
				</template>
			</template>
			<template v-if="state.modelViewerActiveType === 'wmo'">
				<span class="header">WMO Groups</span>
				<checkbox-list :items="state.modelViewerWMOGroups"></checkbox-list>
				<div class="list-toggles">
					<a @click="setAllWMOGroups(true)">Enable All</a> / <a @click="setAllWMOGroups(false)">Disable All</a>
				</div>
				<span class="header">Doodad Sets</span>
				<checkbox-list :items="state.modelViewerWMOSets"></checkbox-list>
			</template>
		</div>
	</div>
</template>