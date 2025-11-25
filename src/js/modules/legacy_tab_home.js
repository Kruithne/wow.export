module.exports = {
	template: `
		<div class="tab" id="legacy-tab-home">
			<div id="home-buttons" class="home-button-tray">
				<div @click="navigate('legacy_tab_textures')">
					<b>Textures</b>
					<span>View and export textures to common formats.</span>
				</div>
				<div @click="navigate('legacy_tab_audio')">
					<b>Sounds</b>
					<span>Play and export in-game sound effects, music and dialog.</span>
				</div>
				<div @click="navigate_screen('legacy-tab-files')">
					<b>Files</b>
					<span>Browse and export all raw files from MPQ archives.</span>
				</div>
			</div>
			<div id="home-changes">
				<div v-html="$core.view.whatsNewHTML"></div>
			</div>
			<div id="home-help-buttons">
				<div data-external="::DISCORD">
					<b>Stuck? Need Help?</b>
					<span>Join our Discord community for support!</span>
				</div>
				<div data-external="::GITHUB">
					<b>Gnomish Heritage?</b>
					<span>wow.export is open-source, tinkerers are welcome!</span>
				</div>
				<div data-external="::PATREON">
					<b>Support Us!</b>
					<span>Support development of wow.export through Patreon!</span>
				</div>
			</div>
		</div>
	`,

	methods: {
		navigate(module_name) {
			this.$modules[module_name].setActive();
		},

		navigate_screen(screen_id) {
			this.$core.view.setScreen(screen_id);
		}
	}
};
