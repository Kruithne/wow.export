module.exports = {
	template: `
		<div class="tab" id="tab-home">
			<HomeShowcase />
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
		}
	}
};
