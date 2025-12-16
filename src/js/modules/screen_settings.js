const generics = require('../generics');
const constants = require('../constants');
const tactKeys = require('../casc/tact-keys');
const tab_characters = require('./tab_characters');

let default_config = null;

const load_default_config = async () => {
	if (default_config === null)
		default_config = await generics.readJSON(constants.CONFIG.DEFAULT_PATH, true) || {};

	return default_config;
};

module.exports = {
	register() {
		this.registerContextMenuOption('Manage Settings', 'gear.svg');
	},

	template: `
		<div id="config-wrapper">
		<div id="config" :class="{ toastgap: $core.view.toast !== null }">
			<div>
				<h1>Export Directory</h1>
				<p>Local directory where files will be exported to.</p>
				<p v-if="is_edit_export_path_concerning" class="concern">Warning: Using an export path with spaces may lead to problems in most 3D programs.</p>
				<component :is="$components.FileField" v-model="$core.view.configEdit.exportDirectory" :class="{ concern: is_edit_export_path_concerning }"></component>
			</div>
			<div>
				<h1>Character Save Directory</h1>
				<p>Local directory where saved characters are stored. Leave empty to use the default location.</p>
				<component :is="$components.FileField" v-model="$core.view.configEdit.characterExportPath" :placeholder="default_character_path"></component>
			</div>
			<div>
				<h1>Scroll Speed</h1>
				<p>How many lines at a time you scroll down in the results view (leave at 0 for default scroll amount)</p>
				<input type="number" v-model.number="$core.view.configEdit.scrollSpeed"/>
			</div>
			<div>
				<h1>Display File Lists in Numerical Order (FileDataID)</h1>
				<p>If enabled, all file lists will be ordered numerically by file ID, otherwise alphabetically by filename.</p>
				<label class="ui-checkbox">
				<input type="checkbox" v-model="$core.view.configEdit.listfileSortByID"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Find Unknown Files (Requires Restart)</h1>
				<p>If enabled, wow.export will use various methods to locate unknown files.</p>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.configEdit.enableUnknownFiles"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Load Model Skins (Requires Restart)</h1>
				<p>If enabled, wow.export will parse creature and item skins from data tables for M2 models.</p>
				<p>Disabling this will reduce memory usage and improve loading, but will disable M2 skin functionality.</p>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.configEdit.enableM2Skins"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Include Bone Prefixes</h1>
				<p>If enabled, wow.export will Include _p Bone prefixes in model skeleton/armature.</p>
				<p>Disabling this will break backwards compatibility with previous glTF model and animation exports.</p>
				<label class="ui-checkbox" title="">
					<input type="checkbox" v-model="$core.view.configEdit.modelsExportWithBonePrefix"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Enable Shared Textures (Recommended)</h1>
				<p>If enabled, exported textures will be exported to their own path rather than with their parent.</p>
				<p>This dramatically reduces disk space used by not duplicating textures.</p>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.configEdit.enableSharedTextures"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Enable Shared Children (Recommended)</h1>
				<p>If enabled, exported models on a WMO/ADT will be exported to their own path rather than with their parent.</p>
				<p>This dramatically reduces disk space used by not duplicating models.</p>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.configEdit.enableSharedChildren"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Strip Whitespace From Export Paths</h1>
				<p>If enabled, whitespace will be removed from exported paths.</p>
				<p>Enable this option if your 3D software does not support whitespace in paths.</p>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.configEdit.removePathSpaces"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Strip Whitespace From Copied Paths</h1>
				<p>If enabled, file paths copied from a listbox (CTRL + C) will have whitespace stripped.</p>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.configEdit.removePathSpacesCopy"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Path Separator Format</h1>
				<p>Sets the path separator format used in exported files.</p>
				<ul class="ui-multi-button" id="export-meta-multi">
					<li :class="{ selected: $core.view.configEdit.pathFormat == 'win32' }" @click.stop="$core.view.configEdit.pathFormat = 'win32'">Windows</li>
					<li :class="{ selected: $core.view.configEdit.pathFormat == 'posix' }" @click.stop="$core.view.configEdit.pathFormat = 'posix'">POSIX</li>
				</ul>
			</div>
			<div>
				<h1>Use Absolute MTL Texture Paths</h1>
				<p>If enabled, MTL files will contain absolute textures paths rather than relative ones.</p>
				<p>This will cause issues when sharing exported models between computers.</p>
				<p>Enable this option if you are having issues importing OBJ models with Shared Textures enabled.</p>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.configEdit.enableAbsoluteMTLPaths"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Use Absolute glTF Texture Paths</h1>
				<p>If enabled, glTF files will contain absolute textures paths rather than relative ones.</p>
				<p>This will cause issues when sharing exported models between computers.</p>
				<p>Enable this option if you are having issues importing glTF models with Shared Textures enabled.</p>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.configEdit.enableAbsoluteGLTFPaths"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Use Absolute Model Placement Paths</h1>
				<p>If enabled, paths inside model placement files (CSV) will contain absolute paths rather than relative ones.</p>
				<p>This will cause issues when sharing exported models between computers.</p>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.configEdit.enableAbsoluteCSVPaths"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>CASC Locale</h1>
				<p>Which locale to use for file reading. This only affects game files.</p>
				<p>This should match the locale of your client when using local installations.</p>
				<div style="width: 150px">
					<component :is="$components.MenuButton" class="spaced" :dropdown="true" :options="available_locale_keys" :default="selected_locale_key" @change="$core.view.configEdit.cascLocale = $core.view.availableLocale.flags[$event]"></component>
				</div>
			</div>
			<div>
				<h1>WebP Quality</h1>
				<p>Quality setting for WebP exports. Range is 1-100 (100 is lossless)</p>
				<input type="number" min="1" max="100" v-model.number="$core.view.configEdit.exportWebPQuality"/>
			</div>
			<div>
				<h1>Export Model Collision</h1>
				<p>If enabled, M2 models exported as OBJ will also have their collision exported into a .phys.obj file.</p>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.configEdit.modelsExportCollision"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Export Additional UV Layers</h1>
				<p>If enabled, additional UV layers will be exported for M2/WMO models, included as non-standard properties (vt2, vt3, etc) in OBJ files.</p>
				<p>Use the wow.export Blender add-on to import OBJ models with additional UV layers.</p>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.configEdit.modelsExportUV2"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Export Meta Data</h1>
				<p>If enabled, verbose data will be exported for enabled formats into relative .json files.</p>
				<ul class="ui-multi-button" id="export-meta-multi">
					<li :class="{ selected: $core.view.configEdit.exportM2Meta }" @click.stop="$core.view.configEdit.exportM2Meta = !$core.view.configEdit.exportM2Meta">M2</li>
					<li :class="{ selected: $core.view.configEdit.exportWMOMeta }" @click.stop="$core.view.configEdit.exportWMOMeta = !$core.view.configEdit.exportWMOMeta">WMO</li>
					<li :class="{ selected: $core.view.configEdit.exportBLPMeta }" @click.stop="$core.view.configEdit.exportBLPMeta = !$core.view.configEdit.exportBLPMeta">BLP</li>
					<li :class="{ selected: $core.view.configEdit.exportFoliageMeta }" @click.stop="$core.view.configEdit.exportFoliageMeta = !$core.view.configEdit.exportFoliageMeta">Foliage</li>
				</ul>
			</div>
			<div>
				<h1>Export M2 Bone Data</h1>
				<p>If enabled, bone data will be exported in a relative _bones.json file.</p>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.configEdit.exportM2Bones"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Always Overwrite Existing Files (Recommended)</h1>
				<p>When exporting, files will always be written to disk even if they exist.</p>
				<p>Disabling this can speed up exporting, but may lead to issues between versions.</p>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.configEdit.overwriteFiles"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Name Exported Files</h1>
				<p>When enabled, files are exported using their listfile names (e.g., "ability_stealth.png").</p>
				<p>When disabled, files are exported using their fileDataID numbers (e.g., "12345.png").</p>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.configEdit.exportNamedFiles"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Prevent 3D Preview Overwrites</h1>
				<p>If enabled, 3D preview exports will add increments to prevent overwriting existing files.</p>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.configEdit.modelsExportPngIncrements"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Regular Expression Filtering (Advanced)</h1>
				<p>Allows use of regular expressions in filtering lists.</p>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.configEdit.regexFilters"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Copy Mode</h1>
				<p>By default, using CTRL + C on a file list will copy the full entry to your clipboard.</p>
				<p>Setting this to Directory will instead only copy the directory of the given entry.</p>
				<p>Setting this to FileDataID will instead only copy the FID of the entry (must have FIDs enabled).</p>
				<ul class="ui-multi-button" id="export-copy-multi">
					<li :class="{ selected: $core.view.configEdit.copyMode == 'FULL' }" @click.stop="$core.view.configEdit.copyMode = 'FULL'">Full</li>
					<li :class="{ selected: $core.view.configEdit.copyMode == 'DIR' }" @click.stop="$core.view.configEdit.copyMode = 'DIR'">Directory</li>
					<li :class="{ selected: $core.view.configEdit.copyMode == 'FID' }" @click.stop="$core.view.configEdit.copyMode = 'FID'">FileDataID</li>
				</ul>
			</div>
			<div>
				<h1>Paste Selection</h1>
				<p>If enabled, using CTRL + V on the model list will attempt to select filenames you paste.</p>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.configEdit.pasteSelection"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Split Large Terrain Maps (Recommended)</h1>
				<p>If enabled, exporting baked terrain above 8k will be split into smaller files rather than one large file.</p>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.configEdit.splitLargeTerrainBakes"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Split Alpha Maps</h1>
				<p>If enabled, terrain alpha maps will be exported as individual images for each ADT chunk.</p>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.configEdit.splitAlphaMaps"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Show unknown items</h1>
				<p>When enabled, wow.export will list all items in the items tab, even those without a name.</p>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.configEdit.itemViewerShowAll"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Cache Expiry</h1>
				<p>After how many days of inactivity is cached data deleted. Setting to zero disables cache clean-up (not recommended).</p>
				<input type="number" v-model.number="$core.view.configEdit.cacheExpiry"/>
			</div>
			<div>
				<h1>Manually Clear Cache (Requires Restart)</h1>
				<p>While housekeeping on the cache is mostly automatic, sometimes clearing manually can resolve issues.</p>
				<input type="button" class="spaced" :value="'Clear Cache (' + cache_size_formatted + ')'" @click="handle_cache_clear" :class="{ disabled: $core.view.isBusy }"/>
			</div>
			<div>
				<h1>Encryption Keys</h1>
				<p>Remote URL used to update keys for encrypted files.</p>
				<p>Primary <input type="text" class="long" v-model.trim="$core.view.configEdit.tactKeysURL"/></p>
				<p>Fallback <input type="text" class="long" v-model.trim="$core.view.configEdit.tactKeysFallbackURL"/></p>
			</div>
			<div>
				<h1>Add Encryption Key</h1>
				<p>Manually add a BLTE encryption key.</p>
				<input type="text" width="140" v-model.trim="$core.view.userInputTactKeyName" maxlength="16" placeholder="e.g 8F4098E2470FE0C8"/>
				<input type="text" width="280" v-model.trim="$core.view.userInputTactKey" maxlength="32" placeholder="e.g AA718D1F1A23078D49AD0C606A72F3D5"/>
				<input type="button" value="Add" @click="handle_tact_key"/>
			</div>
			<div>
				<h1>Realm List Source</h1>
				<p>Remote URL used for retrieving the realm list. (Must use same format)</p>
				<p><input type="text" class="long" v-model.trim="$core.view.configEdit.realmListURL"/></p>
			</div>
			<div>
				<h1>Character Appearance API Endpoint</h1>
				<p>Remote URL used for retrieving data from the Battle.net Character Appearance API. (Must use same format)</p>
				<p><input type="text" class="long" v-model.trim="$core.view.configEdit.armoryURL"/></p>
			</div>
			<div>
				<h1>Use Binary Listfile Format (Requires Restart)</h1>
				<p>If enabled, wow.export will use the optimized binary listfile format instead of the legacy CSV format.</p>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.configEdit.enableBinaryListfile"/>
					<span>Enable</span>
				</label>
			</div>
			<div>
				<h1>Listfile Binary Source</h1>
				<p>Remote URL used for downloading the optimized binary listfile format. (Must use same format)</p>
				<p><input type="text" class="long" v-model.trim="$core.view.configEdit.listfileBinarySource"/></p>
			</div>
			<div>
				<h1>Listfile Source (Legacy)</h1>
				<p>Remote URL or local path used for updating the CASC listfile. (Must use same format)</p>
				<p>Primary <input type="text" class="long" v-model.trim="$core.view.configEdit.listfileURL"/></p>
				<p>Fallback <input type="text" class="long" v-model.trim="$core.view.configEdit.listfileFallbackURL" /></p>
			</div>
			<div>
				<h1>Listfile Update Frequency</h1>
				<p>How often (in days) the listfile is updated. Set to zero to always re-download the listfile.</p>
				<input type="number" v-model.number="$core.view.configEdit.listfileCacheRefresh"/>
			</div>
			<div>
				<h1>Data Table Definition Repository</h1>
				<p>Remote URL used to update DBD definitions. (Must use same format)</p>
				<p>Primary <input type="text" class="long" v-model.trim="$core.view.configEdit.dbdURL"/></p>
				<p>Fallback <input type="text" class="long" v-model.trim="$core.view.configEdit.dbdFallbackURL" /></p>
			</div>
			<div>
				<h1>DBD Manifest Repository</h1>
				<p>Remote URL used to obtain DBD manifest information. (Must use same format)</p>
				<p>Primary <input type="text" class="long" v-model.trim="$core.view.configEdit.dbdFilenameURL"/></p>
				<p>Fallback <input type="text" class="long" v-model.trim="$core.view.configEdit.dbdFilenameFallbackURL" /></p>
			</div>
		</div>
		<div id="config-buttons">
			<input type="button" value="Discard" :class="{ disabled: $core.view.isBusy }" @click="handle_discard"/>
			<input type="button" value="Apply" :class="{ disabled: $core.view.isBusy }" @click="handle_apply"/>
			<input type="button" id="config-reset" value="Reset to Defaults" :class="{ disabled: $core.view.isBusy }" @click="handle_reset"/>
		</div>
		</div>
	`,

	data() {
		return {
			default_config: null
		};
	},

	computed: {
		is_edit_export_path_concerning() {
			return !!this.$core.view.configEdit?.exportDirectory?.match(/\s/g);
		},

		default_character_path() {
			return tab_characters.get_default_characters_dir();
		},

		cache_size_formatted() {
			return generics.filesize(this.$core.view.cacheSize);
		},

		available_locale_keys() {
			return Object.keys(this.$core.view.availableLocale.flags).map(e => { return { value: e }});
		},

		selected_locale_key() {
			for (const [key, flag] of Object.entries(this.$core.view.availableLocale.flags)) {
				if (flag === this.$core.view.config.cascLocale)
					return key;
			}

			return 'unUN';
		}
	},

	methods: {
		handle_cache_clear(event) {
			if (!event.target.classList.contains('disabled'))
				this.$core.events.emit('click-cache-clear');
		},

		handle_tact_key() {
			if (tactKeys.addKey(this.$core.view.userInputTactKeyName, this.$core.view.userInputTactKey))
				this.$core.setToast('success', 'Successfully added decryption key.');
			else
				this.$core.setToast('error', 'Invalid encryption key.', null, -1);
		},

		go_home() {
			this.$modules.go_to_landing();
		},

		handle_discard() {
			if (this.$core.view.isBusy)
				return;

			this.go_home();
		},

		async handle_apply() {
			if (this.$core.view.isBusy)
				return;

			const cfg = this.$core.view.configEdit;
			const defaults = await load_default_config();

			if (cfg.exportDirectory.length === 0)
				return this.$core.setToast('error', 'A valid export directory must be provided', null, -1);

			if (cfg.realmListURL.length === 0 || !cfg.realmListURL.startsWith('http'))
				return this.$core.setToast('error', 'A valid realm list URL or path is required.', { 'Use Default': () => cfg.realmListURL = defaults.realmListURL }, -1);

			if (cfg.listfileURL.length === 0)
				return this.$core.setToast('error', 'A valid listfile URL or path is required.', { 'Use Default': () => cfg.listfileURL = defaults.listfileURL }, -1);

			if (cfg.armoryURL.length === 0 || !cfg.armoryURL.startsWith('http'))
				return this.$core.setToast('error', 'A valid URL is required for the Character Appearance API.', { 'Use Default': () => cfg.armoryURL = defaults.armoryURL }, -1);

			if (cfg.tactKeysURL.length === 0 || !cfg.tactKeysURL.startsWith('http'))
				return this.$core.setToast('error', 'A valid URL is required for encryption key updates.', { 'Use Default': () => cfg.tactKeysURL = defaults.tactKeysURL }, -1);

			if (cfg.dbdURL.length === 0 || !cfg.dbdURL.startsWith('http'))
				return this.$core.setToast('error', 'A valid URL is required for DBD updates.', { 'Use Default': () => cfg.dbdURL = defaults.dbdURL }, -1);

			if (cfg.dbdFilenameURL.length === 0 || !cfg.dbdFilenameURL.startsWith('http'))
				return this.$core.setToast('error', 'A valid URL is required for DBD manfiest.', { 'Use Default': () => cfg.dbdFilenameURL = defaults.dbdFilenameURL }, -1);

			this.$core.view.config = cfg;
			this.go_home();
			this.$core.setToast('success', 'Changes to your configuration have been saved!');
		},

		async handle_reset() {
			if (this.$core.view.isBusy)
				return;

			const defaults = await load_default_config();
			this.$core.view.configEdit = JSON.parse(JSON.stringify(defaults));
		}
	},

	mounted() {
		this.$core.view.configEdit = Object.assign({}, this.$core.view.config);
	}
};
