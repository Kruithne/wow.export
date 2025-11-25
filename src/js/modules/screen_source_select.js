const util = require('util');
const constants = require('../constants');
const generics = require('../generics');
const log = require('../log');
const ExternalLinks = require('../external-links');
const InstallType = require('../install-type');

const CASCLocal = require('../casc/casc-source-local');
const CASCRemote = require('../casc/casc-source-remote');
const cdnResolver = require('../casc/cdn-resolver');
const { MPQInstall } = require('../mpq/mpq-install');

let casc_source = null;
let local_selector = null;
let legacy_selector = null;

module.exports = {
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
					<context-menu @close="$core.view.contextMenus.stateCDNRegion = false" :node="$core.view.contextMenus.stateCDNRegion" id="menu-cdn-region">
						<span v-for="region in $core.view.cdnRegions" @click.self="set_selected_cdn(region)">
							{{ region.name }}
							<span v-if="region.delay !== null" style="opacity: 0.7; font-size: 12px;">{{ region.delay < 0 ? 'N/A' : region.delay + 'ms' }}</span>
						</span>
					</context-menu>
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
					<input v-for="(build, i) in ($core.view.availableLocalBuilds || $core.view.availableRemoteBuilds)" @click="click_source_build(i)" :class="['expansion-icon-bg-' + build.expansionId, { disabled: $core.view.isBusy }]" type="button" :value="build.label"/>
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
			cdnResolver.startPreResolution(region.tag);
		},

		async load_install(index) {
			this.$core.view.availableLocalBuilds = null;
			this.$core.view.availableRemoteBuilds = null;

			if (casc_source instanceof CASCLocal) {
				const recent_local = this.$core.view.config.recentLocal;
				const install_path = casc_source.dir;
				const build = casc_source.builds[index];
				const pre_index = recent_local.findIndex(e => e.path === install_path && e.product === build.Product);

				if (pre_index > -1) {
					if (pre_index > 0)
						recent_local.unshift(recent_local.splice(pre_index, 1)[0]);
				} else {
					recent_local.unshift({ path: install_path, product: build.Product });
				}

				if (recent_local.length > constants.MAX_RECENT_LOCAL)
					recent_local.splice(constants.MAX_RECENT_LOCAL, recent_local.length - constants.MAX_RECENT_LOCAL);
			}

			try {
				await casc_source.load(index);
				this.$core.view.installType = InstallType.CASC;
				this.$modules.tab_home.setActive();
			} catch (e) {
				log.write('Failed to load CASC: %o', e);
				this.$core.setToast('error', 'Unable to initialize CASC. Try repairing your game installation, or seek support.', {
					'View Log': () => log.openRuntimeLog(),
					'Visit Support Discord': () => ExternalLinks.open('::DISCORD')
				}, -1);
				this.$modules.source_select.setActive();
			}
		},

		async open_local_install(install_path, product) {
			this.$core.hideToast();

			const recent_local = this.$core.view.config.recentLocal;

			try {
				casc_source = new CASCLocal(install_path);
				await casc_source.init();

				if (product) {
					this.load_install(casc_source.builds.findIndex(build => build.Product === product));
				} else {
					this.$core.view.availableLocalBuilds = casc_source.getProductList();
					this.$core.view.sourceSelectShowBuildSelect = true;
				}
			} catch (e) {
				this.$core.setToast('error', util.format('It looks like %s is not a valid World of Warcraft installation.', install_path), null, -1);
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
				this.$core.view.mpq = new MPQInstall(install_path);

				this.$core.showLoadingScreen(2, 'Loading Legacy Installation');
				await this.$core.view.mpq.loadInstall();

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
				this.$core.setToast('error', util.format('Failed to load legacy installation from %s', install_path), null, -1);
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
				let cdn_url = util.format(constants.PATCH.HOST, region.tag);
				if (region.tag === 'cn')
					cdn_url = constants.PATCH.HOST_CHINA;

				const node = { tag: region.tag, name: region.name, url: cdn_url, delay: null };
				regions.push(node);

				if (region.tag === user_region || (typeof user_region !== 'string' && region.tag === constants.PATCH.DEFAULT_REGION)) {
					this.$core.view.selectedCDNRegion = node;
					cdnResolver.startPreResolution(region.tag);
				}

				pings.push(generics.ping(cdn_url).then(ms => node.delay = ms).catch(e => {
					node.delay = -1;
					log.write('Failed ping to %s: %s', cdn_url, e.message);
				}).finally(() => {
					this.$core.view.cdnRegions = [...regions];
				}));
			}

			Promise.all(pings).then(() => {
				if (this.$core.view.lockCDNRegion)
					return;

				let selected_region = this.$core.view.selectedCDNRegion;
				for (const region of regions) {
					if (region.delay === null || region.delay < 0)
						continue;

					if (region.delay < selected_region.delay) {
						this.$core.view.selectedCDNRegion = region;
						cdnResolver.startPreResolution(region.tag);
					}
				}
			});
		},

		click_source_local() {
			if (this.$core.view.isBusy)
				return;

			local_selector.value = '';
			local_selector.click();
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
				casc_source = new CASCRemote(tag);
				await casc_source.init();

				if (casc_source.builds.length === 0)
					throw new Error('No builds available.');

				this.$core.view.availableRemoteBuilds = casc_source.getProductList();
				this.$core.view.sourceSelectShowBuildSelect = true;
			} catch (e) {
				this.$core.setToast('error', util.format('There was an error connecting to Blizzard\'s %s CDN, try another region!', tag.toUpperCase()), null, -1);
				log.write('Failed to initialize remote CASC source: %s', e.message);
			}
		},

		click_source_legacy() {
			if (this.$core.view.isBusy)
				return;

			legacy_selector.value = '';
			legacy_selector.click();
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
		// init recent local/legacy arrays if needed
		if (!Array.isArray(this.$core.view.config.recentLocal))
			this.$core.view.config.recentLocal = [];

		if (!Array.isArray(this.$core.view.config.recentLegacy))
			this.$core.view.config.recentLegacy = [];

		// create file selectors
		local_selector = document.createElement('input');
		local_selector.setAttribute('type', 'file');
		local_selector.setAttribute('nwdirectory', true);
		local_selector.setAttribute('nwdirectorydesc', 'Select World of Warcraft Installation');
		local_selector.onchange = () => this.open_local_install(local_selector.value);

		legacy_selector = document.createElement('input');
		legacy_selector.setAttribute('type', 'file');
		legacy_selector.setAttribute('nwdirectory', true);
		legacy_selector.setAttribute('nwdirectorydesc', 'Select Legacy MPQ Installation');
		legacy_selector.onchange = () => this.open_legacy_install(legacy_selector.value);

		// init cdn pings
		this.init_cdn_pings();
	}
};
