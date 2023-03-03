<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<script lang="ts" setup>
	import { computed } from 'vue';
	import { state, click } from '../core';
	import { filesize } from '../generics';
	import Constants from '../constants';

	import { LocaleFlags } from '../casc/locale-flags';

	const isEditExportPathConcerning = computed(() => {
		return !!state.configEdit?.exportDirectory?.match(/\s/g);
	});

	const availableLocaleKeys = computed(() => {
		const flags = new Map<string, number>;
		for (const [key, value] of Object.entries(LocaleFlags)) {
			if (Number(key) >= 0)
				continue;

			flags.set(key, Number(value));
		}

		return Array.from(flags.keys()).map(e => {
			return { label: e, value: flags.get(e) };
		});
	});
</script>

<template>
	<div id="config" :class="{ toastgap: state.toast !== null }">
		<div>
			<h1>Export Directory</h1>
			<p>Local directory where files will be exported to.</p>
			<p v-if="isEditExportPathConcerning" class="concern">Warning: Using an export path with spaces may lead to problems in most 3D programs.</p>
			<file-field :value="state.configEdit.exportDirectory" :class="{ concern: isEditExportPathConcerning }"></file-field>
		</div>
		<div>
			<h1>Show File Data IDs</h1>
			<p>If enabled, all capable listfiles will have entries suffixed with their fileDataID.</p>
			<label class="ui-checkbox">
				<input type="checkbox" v-model="state.configEdit.listfileShowFileDataIDs"/>
				<span>Enable</span>
			</label>
		</div>
		<div>
			<h1>Display File Lists in Numerical Order (FileDataID)</h1>
			<p>If enabled, all file lists will be ordered numerically by file ID, otherwise alphabetically by filename.</p>
			<label class="ui-checkbox">
				<input type="checkbox" v-model="state.configEdit.listfileSortByID"/>
				<span>Enable</span>
			</label>
		</div>
		<div>
			<h1>Find Unknown Files (Requires Restart)</h1>
			<p>If enabled, wow.export will use various methods to locate unknown files.</p>
			<label class="ui-checkbox">
				<input type="checkbox" v-model="state.configEdit.enableUnknownFiles"/>
				<span>Enable</span>
			</label>
		</div>
		<div>
			<h1>Load Model Skins (Requires Restart)</h1>
			<p>If enabled, wow.export will parse creature and item skins from data tables for M2 models.</p>
			<p>Disabling this will reduce memory usage and improve loading, but will disable M2 skin functionality.</p>
			<label class="ui-checkbox">
				<input type="checkbox" v-model="state.configEdit.enableM2Skins"/>
				<span>Enable</span>
			</label>
		</div>
		<div>
			<h1>Enable Shared Textures (Recommended)</h1>
			<p>If enabled, exported textures will be exported to their own path rather than with their parent.</p>
			<p>This dramatically reduces disk space used by not duplicating textures.</p>
			<label class="ui-checkbox">
				<input type="checkbox" v-model="state.configEdit.enableSharedTextures"/>
				<span>Enable</span>
			</label>
		</div>
		<div>
			<h1>Enable Shared Children (Recommended)</h1>
			<p>If enabled, exported models on a WMO/ADT will be exported to their own path rather than with their parent.</p>
			<p>This dramatically reduces disk space used by not duplicating models.</p>
			<label class="ui-checkbox">
				<input type="checkbox" v-model="state.configEdit.enableSharedChildren"/>
				<span>Enable</span>
			</label>
		</div>
		<div>
			<h1>Strip Whitespace From Export Paths</h1>
			<p>If enabled, whitespace will be removed from exported paths.</p>
			<p>Enable this option if your 3D software does not support whitespace in paths.</p>
			<label class="ui-checkbox">
				<input type="checkbox" v-model="state.configEdit.removePathSpaces"/>
				<span>Enable</span>
			</label>
		</div>
		<div>
			<h1>Strip Whitespace From Copied Paths</h1>
			<p>If enabled, file paths copied from a listbox (CTRL + C) will have whitespace stripped.</p>
			<label class="ui-checkbox">
				<input type="checkbox" v-model="state.configEdit.removePathSpacesCopy"/>
				<span>Enable</span>
			</label>
		</div>
		<div>
			<h1>Path Separator Format</h1>
			<p>Sets the path separator format used in exported files.</p>
			<ul class="ui-multi-button" id="export-meta-multi">
				<li :class="{ selected: state.configEdit.pathFormat == 'win32' }" @click.stop="state.configEdit.pathFormat = 'win32'">Windows</li>
				<li :class="{ selected: state.configEdit.pathFormat == 'posix' }" @click.stop="state.configEdit.pathFormat = 'posix'">POSIX</li>
			</ul>
		</div>
		<div>
			<h1>Use Absolute MTL Paths</h1>
			<p>If enabled, MTL files will contain absolute textures paths rather than relative ones.</p>
			<p>This will cause issues when sharing exported models between computers.</p>
			<p>Enable this option if you are having issues importing models in Cinema 4D with Shared Textures enabled.</p>
			<label class="ui-checkbox">
				<input type="checkbox" v-model="state.configEdit.enableAbsoluteMTLPaths"/>
				<span>Enable</span>
			</label>
		</div>
		<div>
			<h1>Use Absolute Model Placement Paths</h1>
			<p>If enabled, paths inside model placement files (CSV) will contain absolute paths rather than relative ones.</p>
			<p>This will cause issues when sharing exported models between computers.</p>
			<label class="ui-checkbox">
				<input type="checkbox" v-model="state.configEdit.enableAbsoluteCSVPaths"/>
				<span>Enable</span>
			</label>
		</div>
		<div>
			<h1>CASC Locale</h1>
			<p>Which locale to use for file reading. This only affects game files.</p>
			<p>This should match the locale of your client when using local installations.</p>
			<menu-button class="spaced" :dropdown="true" :options="availableLocaleKeys" :default="state.config.cascLocale" @change="state.configEdit.cascLocale = $event"></menu-button>
		</div>
		<div>
			<h1>Export Model Collision</h1>
			<p>If enabled, M2 models exported as OBJ will also have their collision exported into a .phys.obj file.</p>
			<label class="ui-checkbox">
				<input type="checkbox" v-model="state.configEdit.modelsExportCollision"/>
				<span>Enable</span>
			</label>
		</div>
		<div>
			<h1>Export Additional UV Layers</h1>
			<p>If enabled, additional UV layers will be exported for M2/WMO models, included as non-standard properties (vt2, vt3, etc) in OBJ files.</p>
			<p>Use the wow.export Blender add-on to import OBJ models with additional UV layers.</p>
			<label class="ui-checkbox">
				<input type="checkbox" v-model="state.configEdit.modelsExportUV2"/>
				<span>Enable</span>
			</label>
		</div>
		<div>
			<h1>Export Meta Data</h1>
			<p>If enabled, verbose data will be exported for enabled formats into relative .json files.</p>
			<ul class="ui-multi-button" id="export-meta-multi">
				<li :class="{ selected: state.configEdit.exportM2Meta }" @click.stop="state.configEdit.exportM2Meta = !state.configEdit.exportM2Meta">M2</li>
				<li :class="{ selected: state.configEdit.exportWMOMeta }" @click.stop="state.configEdit.exportWMOMeta = !state.configEdit.exportWMOMeta">WMO</li>
				<li :class="{ selected: state.configEdit.exportBLPMeta }" @click.stop="state.configEdit.exportBLPMeta = !state.configEdit.exportBLPMeta">BLP</li>
				<li :class="{ selected: state.configEdit.exportFoliageMeta }" @click.stop="state.configEdit.exportFoliageMeta = !state.configEdit.exportFoliageMeta">Foliage</li>
			</ul>
		</div>
		<div>
			<h1>Export M2 Bone Data</h1>
			<p>If enabled, bone data will be exported in a relative _bones.json file.</p>
			<label class="ui-checkbox">
				<input type="checkbox" v-model="state.configEdit.exportM2Bones"/>
				<span>Enable</span>
			</label>
		</div>
		<div>
			<h1>Always Overwrite Existing Files (Recommended)</h1>
			<p>When exporting, files will always be written to disk even if they exist.</p>
			<p>Disabling this can speed up exporting, but may lead to issues between versions.</p>
			<label class="ui-checkbox">
				<input type="checkbox" v-model="state.configEdit.overwriteFiles"/>
				<span>Enable</span>
			</label>
		</div>
		<div>
			<h1>Regular Expression Filtering (Advanced)</h1>
			<p>Allows use of regular expressions in filtering lists.</p>
			<label class="ui-checkbox">
				<input type="checkbox" v-model="state.configEdit.regexFilters"/>
				<span>Enable</span>
			</label>
		</div>
		<div>
			<h1>Copy Mode</h1>
			<p>By default, using CTRL + C on a file list will copy the full entry to your clipboard.</p>
			<p>Setting this to Directory will instead only copy the directory of the given entry.</p>
			<p>Setting this to FileDataID will instead only copy the FID of the entry (must have FIDs enabled).</p>
			<ul class="ui-multi-button" id="export-copy-multi">
				<li :class="{ selected: state.configEdit.copyMode == 'FULL' }" @click.stop="state.configEdit.copyMode = 'FULL'">Full</li>
				<li :class="{ selected: state.configEdit.copyMode == 'DIR' }" @click.stop="state.configEdit.copyMode = 'DIR'">Directory</li>
				<li :class="{ selected: state.configEdit.copyMode == 'FID' }" @click.stop="state.configEdit.copyMode = 'FID'">FileDataID</li>
			</ul>
		</div>
		<div>
			<h1>Paste Selection</h1>
			<p>If enabled, using CTRL + V on the model list will attempt to select filenames you paste.</p>
			<label class="ui-checkbox">
				<input type="checkbox" v-model="state.configEdit.pasteSelection"/>
				<span>Enable</span>
			</label>
		</div>
		<div>
			<h1>Split Large Terrain Maps (Recommended)</h1>
			<p>If enabled, exporting baked terrain above 8k will be split into smaller files rather than one large file.</p>
			<label class="ui-checkbox">
				<input type="checkbox" v-model="state.configEdit.splitLargeTerrainBakes"/>
				<span>Enable</span>
			</label>
		</div>
		<div>
			<h1>Split Alpha Maps</h1>
			<p>If enabled, terrain alpha maps will be exported as individual images for each ADT chunk.</p>
			<label class="ui-checkbox">
				<input type="checkbox" v-model="state.configEdit.splitAlphaMaps"/>
				<span>Enable</span>
			</label>
		</div>
		<div>
			<h1>Cache Expiry</h1>
			<p>After how many days of inactivity is cached data deleted. Setting to zero disables cache clean-up (not recommended).</p>
			<input type="number" v-model.number="state.configEdit.cacheExpiry"/>
		</div>
		<div>
			<h1>Manually Clear Cache (Requires Restart)</h1>
			<p>While housekeeping on the cache is mostly automatic, sometimes clearing manually can resolve issues.</p>
			<input type="button" class="spaced" :value="'Clear Cache (' + filesize(state.cacheSize) + ')'" @click="click('cache-clear', $event)" :class="{ disabled: state.isBusy }"/>
		</div>
		<div>
			<h1>Encryption Keys</h1>
			<p>Remote URL used to update keys for encrypted files.</p>
			<input type="text" v-model.trim="state.configEdit.tactKeysURL"/>
		</div>
		<div>
			<h1>Add Encryption Key</h1>
			<p>Manually add a BLTE encryption key.</p>
			<input type="text" width="140" v-model.trim="state.userInputTactKeyName" maxlength="16" placeholder="e.g 8F4098E2470FE0C8"/>
			<input type="text" width="280" v-model.trim="state.userInputTactKey" maxlength="32" placeholder="e.g AA718D1F1A23078D49AD0C606A72F3D5"/>
			<input type="button" value="Add" @click="click('tact-key', $event)"/>
		</div>
		<div>
			<h1>Listfile Source</h1>
			<p>Remote URL or local path used for updating the CASC listfile. (Must use same format)</p>
			<input type="text" v-model.trim="state.configEdit.listfileURL"/>
		</div>
		<div>
			<h1>Listfile Update Frequency</h1>
			<p>How often (in days) the listfile is updated. Set to zero to always re-download the listfile.</p>
			<input type="number" v-model.number="state.configEdit.listfileCacheRefresh"/>
		</div>
		<div>
			<h1>Data Table Definition Repository</h1>
			<p>Remote URL used to update DBD definitions. (Must use same format)</p>
			<input type="text" v-model.trim="state.configEdit.dbdURL"/>
		</div>
		<div>
			<h1>Last Export File Location</h1>
			<p>Override the text file location which export manifest entries are written to.</p>
			<input type="text" v-model.trim="state.configEdit.lastExportFile" :placeholder="Constants.LAST_EXPORT" class="long"/>
		</div>
	</div>
</template>