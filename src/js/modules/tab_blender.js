const blender = require('../blender');

module.exports = {
	register() {
		this.registerContextMenuOption('Install Blender Add-on', '../images/blender.png');
	},

	template: `
		<div id="blender-info">
			<div id="blender-info-header">
				<h1>Installing the wow.export Add-on for Blender 2.8+</h1>
				<p>Blender users can make use of our special importer add-on which makes importing advanced objects as simple as a single click. WMO objects are imported with any exported doodad sets included. ADT map tiles are imported complete with all WMOs and doodads positioned as they would be in-game.</p>
			</div>
			<div id="blender-info-buttons">
				<input type="button" value="Install Automatically (Recommended)" @click="install_auto" :class="{ disabled: $core.view.isBusy }"/>
				<input type="button" value="Install Manually (Advanced)" @click="install_manual"/>
				<input type="button" value="Go Back" @click="go_back"/>
			</div>
		</div>
	`,

	methods: {
		install_auto() {
			blender.startAutomaticInstall();
		},

		install_manual() {
			blender.openAddonDirectory();
		},

		go_back() {
			this.$modules.tab_home.setActive();
		}
	}
};
