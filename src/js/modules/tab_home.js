module.exports = {
	template: `
		<div class="tab" id="tab-home">
			<div id="home-buttons" class="home-button-tray">
				<div @click="navigate('tab_models')">
					<b>3D Models</b>
					<span>View and export 3D models to common formats.</span>
				</div>
				<div @click="navigate('tab_characters')">
					<b>Characters</b>
					<span>Customize and export playable characters.</span>
				</div>
				<div @click="navigate('tab_items')">
					<b>Items</b>
					<span>Browse in-game items and find associated models/textures.</span>
				</div>
				<div @click="navigate('tab_textures')">
					<b>Textures</b>
					<span>View and export textures to common formats.</span>
				</div>
				<div @click="navigate('tab_audio')">
					<b>Audio</b>
					<span>Play and export in-game sound effects, music and dialog.</span>
				</div>
				<div @click="navigate('tab_videos')">
					<b>Videos</b>
					<span>Export pre-rendered cinematics.</span>
				</div>
				<div @click="navigate('tab_maps')">
					<b>Maps</b>
					<span>Explore and export terrain with buildings, foliage, liquid and more.</span>
				</div>
				<div @click="navigate('tab_zones')">
					<b>Zones</b>
					<span>Search and export in-game maps for all available zones.</span>
				</div>
				<div @click="navigate('tab_text')">
					<b>Text</b>
					<span>Inspect text tables, scripts, XML and more.</span>
				</div>
				<div @click="navigate('tab_data')">
					<b>Data</b>
					<span>Search and export records across all known data tables.</span>
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
		}
	}
};
