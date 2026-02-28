import constants from '../constants.js';
import generics from '../generics.js';
import log from '../log.js';
import ExternalLinks from '../external-links.js';
import InstallType from '../install-type.js';
import BufferWrapper from '../buffer.js';
import { casc, listfile, mpq, platform } from '../../views/main/rpc.js';

let casc_type = null;
let casc_install_path = null;
let casc_builds = null;

export default {
	template: `
		<div id="source-select" v-if="!$core.view.sourceSelectShowBuildSelect">
			<div id="source-local" @click="click_source_local">
				<div class="source-icon"></div>
				<div class="source-content">
					<div class="source-title">Open Local Installation (Recommended)</div>
					<div class="source-subtitle">Explore a locally installed World of Warcraft installation on your machine</div>
					<div v-if="$core.view.config.recentLocal && $core.view.config.recentLocal.length > 0" class="source-last-opened">
						Last Opened: <span class="link" @click.stop="click_source_local_recent($core.view.config.recentLocal[0])">{{ $core.view.config.recentLocal[0].path }} ({{ get_product_tag($core.view.config.recentLocal[0].product) }})</span>
					</div>
				</div>
			</div>
			<div id="source-remote" @click="click_source_remote">
				<div class="source-icon"></div>
				<div class="source-content">
					<div class="source-title">Use Battle.net CDN</div>
					<div class="source-subtitle">Explore available builds without installation directly from the Battle.net servers</div>
					<div class="source-cdn-region" v-if="$core.view.selectedCDNRegion">
						Region: {{ $core.view.selectedCDNRegion.name }} <span class="link" @click.stop="$core.view.contextMenus.stateCDNRegion = true">(<span>Change</span>)</span>
					</div>
					<component :is="$components.ContextMenu" @close="$core.view.contextMenus.stateCDNRegion = false" :node="$core.view.contextMenus.stateCDNRegion" id="menu-cdn-region">
						<span v-for="region in $core.view.cdnRegions" @click.self="set_selected_cdn(region)">
							{{ region.name }}
							<span v-if="region.delay !== null" style="opacity: 0.7; font-size: 12px;">{{ region.delay < 0 ? 'N/A' : region.delay + 'ms' }}</span>
						</span>
					</component>
				</div>
			</div>
			<div id="source-legacy" @click="click_source_legacy">
				<div class="source-icon"></div>
				<div class="source-content">
					<div class="source-title">Open Legacy Installation</div>
					<div class="source-subtitle">Explore a legacy MPQ-based installation on your machine</div>
					<div v-if="$core.view.config.recentLegacy && $core.view.config.recentLegacy.length > 0" class="source-last-opened">
						Last Opened: <span class="link" @click.stop="click_source_legacy_recent($core.view.config.recentLegacy[0])">{{ $core.view.config.recentLegacy[0].path }}</span>
					</div>
				</div>
			</div>
		</div>
		<div id="build-select" v-else>
			<div class="build-select-content">
				<div class="build-select-title">Select Build</div>
				<div class="build-select-buttons">
					<input v-for="(build, i) in ($core.view.availableLocalBuilds || $core.view.availableRemoteBuilds)" @click="click_source_build(build.buildIndex)" :class="['expansion-icon-bg-' + build.expansionId, { disabled: $core.view.isBusy }]" type="button" :value="build.label"/>
				</div>
				<span @click="click_return_to_source_select" class="link build-select-return">Return to Installations</span>
			</div>
		</div>
	`,

	data() {
		return {};
	},

	methods: {
		get_product_tag(product) {
			const entry = constants.PRODUCTS.find(e => e.product === product);
			return entry ? entry.tag : 'Unknown';
		},

		set_selected_cdn(region) {
			this.$core.view.selectedCDNRegion = region;
			this.$core.view.lockCDNRegion = true;
			this.$core.view.config.sourceSelectUserRegion = region.tag;
			casc.start_pre_resolution(region.tag);
		},

		async load_listfile_data() {
			const [textures, sounds, text, fonts, models] = await Promise.all([
				listfile.get_prefilter('textures'),
				listfile.get_prefilter('sounds'),
				listfile.get_prefilter('text'),
				listfile.get_prefilter('fonts'),
				listfile.get_prefilter('models'),
			]);

			this.$core.view.listfileTextures = textures;
			this.$core.view.listfileSounds = sounds;
			this.$core.view.listfileText = text;
			this.$core.view.listfileFonts = fonts;
			this.$core.view.listfileModels = models;
		},

		setup_casc_adapter() {
			this.$core.view.casc = {
				getFile: async (id) => BufferWrapper.from(await casc.get_file(id)),
				getFileByName: async (name) => BufferWrapper.from(await casc.get_file_by_name(name)),
				getFilePartial: async (id, ofs, len) => BufferWrapper.from(await casc.get_file_partial(id, ofs, len)),
				getFileEncodingInfo: (id) => casc.get_file_encoding_info(id),
				getInstallManifest: () => casc.get_install_manifest(),
				getValidRootEntries: () => casc.get_valid_root_entries(),
				fileExists: (id) => casc.file_exists(id),

				getFileByContentKey: async (key) => {
					const data = await casc.get_file_by_content_key(key);
					if (data === null)
						return null;

					return BufferWrapper.from(data);
				},
			};
		},

		async load_install(index) {
			this.$core.view.availableLocalBuilds = null;
			this.$core.view.availableRemoteBuilds = null;
			this.$core.view.sourceSelectShowBuildSelect = false;
			this.$core.showLoadingScreen(1, 'Connecting...');

			if (casc_type === 'local' && casc_builds) {
				const recent_local = this.$core.view.config.recentLocal;
				const build = casc_builds[index];
				const pre_index = recent_local.findIndex(e => e.path === casc_install_path && e.product === build.Product);

				if (pre_index > -1) {
					if (pre_index > 0)
						recent_local.unshift(recent_local.splice(pre_index, 1)[0]);
				} else {
					recent_local.unshift({ path: casc_install_path, product: build.Product });
				}

				if (recent_local.length > constants.MAX_RECENT_LOCAL)
					recent_local.splice(constants.MAX_RECENT_LOCAL, recent_local.length - constants.MAX_RECENT_LOCAL);
			}

			try {
				const cdn_region = this.$core.view.selectedCDNRegion?.tag;
				await casc.load(index, cdn_region);
				this.setup_casc_adapter();
				await this.load_listfile_data();
				this.$core.view.installType = InstallType.CASC;
				this.$modules.tab_home.setActive();
			} catch (e) {
				this.$core.hideLoadingScreen();
				log.write('Failed to load CASC: %o', e);
				this.$core.setToast('error', 'Unable to initialize CASC. Try repairing your game installation, or seek support.', {
					'View Log': () => log.openRuntimeLog(),
					'Visit Support Discord': () => ExternalLinks.open('::DISCORD')
				}, -1);
				this.$core.view.sourceSelectShowBuildSelect = false;
				this.$modules.source_select.setActive();
			}
		},

		async open_local_install(install_path, product) {
			this.$core.hideToast();

			const recent_local = this.$core.view.config.recentLocal;

			try {
				const result = await casc.init_local(install_path);
				casc_type = 'local';
				casc_install_path = install_path;
				casc_builds = result.builds;

				if (product) {
					const build_index = casc_builds.findIndex(build => build.Product === product);
					this.load_install(build_index);
				} else {
					this.$core.view.availableLocalBuilds = casc_builds;
					this.$core.view.sourceSelectShowBuildSelect = true;
				}
			} catch (e) {
				this.$core.setToast('error', `It looks like ${install_path} is not a valid World of Warcraft installation.`, null, -1);
				log.write('Failed to initialize local CASC source: %s', e.message);

				for (let i = recent_local.length - 1; i >= 0; i--) {
					const entry = recent_local[i];
					if (entry.path === install_path && (!product || entry.product === product))
						recent_local.splice(i, 1);
				}
			}
		},

		async open_legacy_install(install_path) {
			this.$core.hideToast();

			try {
				this.$core.showLoadingScreen(2, 'Loading Legacy Installation');
				const result = await mpq.init(install_path);

				this.$core.view.mpq = {
					build_id: result.build_id,
					getFile: (path) => mpq.get_file(path),
					getFilesByExtension: (ext) => mpq.get_files_by_extension(ext),
					getAllFiles: () => mpq.get_all_files(),
					close: () => mpq.close(),
				};

				const pre_index = this.$core.view.config.recentLegacy.findIndex(e => e.path === install_path);
				if (pre_index > -1) {
					if (pre_index > 0)
						this.$core.view.config.recentLegacy.unshift(this.$core.view.config.recentLegacy.splice(pre_index, 1)[0]);
				} else {
					this.$core.view.config.recentLegacy.unshift({ path: install_path });
				}

				if (this.$core.view.config.recentLegacy.length > constants.MAX_RECENT_LOCAL)
					this.$core.view.config.recentLegacy.splice(constants.MAX_RECENT_LOCAL, this.$core.view.config.recentLegacy.length - constants.MAX_RECENT_LOCAL);

				this.$core.view.installType = InstallType.MPQ;
				this.$modules.legacy_tab_home.setActive();
				this.$core.hideLoadingScreen();
			} catch (e) {
				this.$core.hideLoadingScreen();
				this.$core.setToast('error', `Failed to load legacy installation from ${install_path}`, null, -1);
				log.write('Failed to initialize legacy MPQ source: %s', e.message);

				for (let i = this.$core.view.config.recentLegacy.length - 1; i >= 0; i--) {
					if (this.$core.view.config.recentLegacy[i].path === install_path)
						this.$core.view.config.recentLegacy.splice(i, 1);
				}

				this.$modules.source_select.setActive();
			}
		},

		init_cdn_pings() {
			const pings = [];
			const regions = this.$core.view.cdnRegions;
			const user_region = this.$core.view.config.sourceSelectUserRegion;

			if (typeof user_region === 'string')
				this.$core.view.lockCDNRegion = true;

			for (const region of constants.PATCH.REGIONS) {
				let cdn_url = region.tag === 'cn'
					? constants.PATCH.HOST_CHINA
					: constants.PATCH.HOST.replace('%s', region.tag);

				const node = { tag: region.tag, name: region.name, url: cdn_url, delay: null };
				regions.push(node);

				if (region.tag === user_region || (typeof user_region !== 'string' && region.tag === constants.PATCH.DEFAULT_REGION))
					this.$core.view.selectedCDNRegion = node;

				pings.push(generics.ping(cdn_url).then(ms => node.delay = ms).catch(e => {
					node.delay = -1;
					log.write('Failed ping to %s: %s', cdn_url, e.message);
				}).finally(() => {
					this.$core.view.cdnRegions = [...regions];
				}));
			}

			if (this.$core.view.selectedCDNRegion)
				casc.start_pre_resolution(this.$core.view.selectedCDNRegion.tag);

			Promise.all(pings).then(() => {
				if (this.$core.view.lockCDNRegion)
					return;

				let selected_region = this.$core.view.selectedCDNRegion;
				for (const region of regions) {
					if (region.delay === null || region.delay < 0)
						continue;

					if (region.delay < selected_region.delay)
						this.$core.view.selectedCDNRegion = region;
				}

				if (this.$core.view.selectedCDNRegion !== selected_region)
					casc.start_pre_resolution(this.$core.view.selectedCDNRegion.tag);
			});
		},

		async click_source_local() {
			if (this.$core.view.isBusy)
				return;

			try {
				const result = await platform.show_open_dialog({ directory: true, title: 'Select World of Warcraft Installation' });
				if (result)
					this.open_local_install(result);
			} catch (e) {
				log.write('Failed to open directory dialog: %s', e.message);
			}
		},

		click_source_local_recent(entry) {
			if (this.$core.view.isBusy)
				return;

			this.open_local_install(entry.path, entry.product);
		},

		async click_source_remote() {
			if (this.$core.view.isBusy)
				return;

			using _lock = this.$core.create_busy_lock();
			const tag = this.$core.view.selectedCDNRegion.tag;

			try {
				const result = await casc.init_remote(tag);
				casc_type = 'remote';
				casc_install_path = null;
				casc_builds = result.builds;

				if (casc_builds.length === 0)
					throw new Error('No builds available.');

				this.$core.view.availableRemoteBuilds = casc_builds;
				this.$core.view.sourceSelectShowBuildSelect = true;
			} catch (e) {
				this.$core.setToast('error', `There was an error connecting to Blizzard's ${tag.toUpperCase()} CDN, try another region!`, null, -1);
				log.write('Failed to initialize remote CASC source: %s', e.message);
			}
		},

		async click_source_legacy() {
			if (this.$core.view.isBusy)
				return;

			try {
				const result = await platform.show_open_dialog({ directory: true, title: 'Select Legacy MPQ Installation' });
				if (result)
					this.open_legacy_install(result);
			} catch (e) {
				log.write('Failed to open directory dialog: %s', e.message);
			}
		},

		click_source_legacy_recent(entry) {
			if (this.$core.view.isBusy)
				return;

			this.open_legacy_install(entry.path);
		},

		click_source_build(index) {
			if (this.$core.view.isBusy)
				return;

			this.load_install(index);
		},

		click_return_to_source_select() {
			this.$core.view.availableLocalBuilds = null;
			this.$core.view.availableRemoteBuilds = null;
			this.$core.view.sourceSelectShowBuildSelect = false;
		}
	},

	mounted() {
		if (!Array.isArray(this.$core.view.config.recentLocal))
			this.$core.view.config.recentLocal = [];

		if (!Array.isArray(this.$core.view.config.recentLegacy))
			this.$core.view.config.recentLegacy = [];

		this.init_cdn_pings();
	}
};
