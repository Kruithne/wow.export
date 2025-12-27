const path = require('path');
const util = require('util');
const fsp = require('fs').promises;

const constants = require('../constants');
const generics = require('../generics');
const core = require('../core');
const log = require('../log');

const PATTERN_ADDON_VER = /"version": \((\d+), (\d+), (\d+)\),/;
const PATTERN_BLENDER_VER = /\d+\.\d+\w?/;

const parse_manifest_version = async (file) => {
	try {
		const data = await fsp.readFile(file, 'utf8');
		const match = data.match(PATTERN_ADDON_VER);

		if (match)
			return util.format('%d.%d.%d', match[1], match[2], match[3]);

		return { error: 'version_pattern_mismatch' };
	} catch (err) {
		if (err.code === 'ENOENT')
			return { error: 'file_not_found' };

		return { error: 'read_error', message: err.message };
	}
};

const get_blender_installations = async () => {
	const installs = [];

	try {
		const entries = await fsp.readdir(constants.BLENDER.DIR, { withFileTypes: true });

		for (const entry of entries) {
			if (!entry.isDirectory())
				continue;

			if (!entry.name.match(PATTERN_BLENDER_VER)) {
				log.write('Skipping invalid Blender installation dir: %s', entry.name);
				continue;
			}

			installs.push(entry.name);
		}
	} catch {
		// no blender installation or cannot access
	}

	return installs;
};

let module_ref = null;

module.exports = {
	register() {
		this.registerContextMenuOption('Install Blender Add-on', '../images/blender.png');
		module_ref = this;
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
			module_ref.startAutomaticInstall();
		},

		install_manual() {
			module_ref.openAddonDirectory();
		},

		go_back() {
			this.$modules.go_to_landing();
		}
	},

	openAddonDirectory() {
		nw.Shell.openItem(constants.BLENDER.LOCAL_DIR);
	},

	async checkLocalVersion() {
		log.write('Checking local Blender add-on version...');

		const versions = await get_blender_installations();
		if (versions.length === 0) {
			log.write('Error: User does not have any Blender installations.');
			return;
		}

		log.write('Available Blender installations: %s', versions.length > 0 ? versions.join(', ') : 'None');
		const blender_version = versions.sort().pop();

		if (blender_version < constants.BLENDER.MIN_VER) {
			log.write('Latest Blender install does not meet minimum requirements (%s < %s)', blender_version, constants.BLENDER.MIN_VER);
			return;
		}

		const latest_manifest = path.join(constants.BLENDER.LOCAL_DIR, constants.BLENDER.ADDON_ENTRY);
		const latest_addon_version = await parse_manifest_version(latest_manifest);

		if (typeof latest_addon_version === 'object') {
			if (latest_addon_version.error === 'file_not_found')
				log.write('Error: Add-on entry file not found: %s', latest_manifest);
			else if (latest_addon_version.error === 'version_pattern_mismatch')
				log.write('Error: Add-on entry file does not contain valid version pattern: %s', latest_manifest);
			else
				log.write('Error: Failed to read add-on entry file (%s): %s', latest_manifest, latest_addon_version.message);

			return;
		}

		const blender_manifest = path.join(constants.BLENDER.DIR, blender_version, constants.BLENDER.ADDON_DIR, constants.BLENDER.ADDON_ENTRY);
		const blender_addon_version = await parse_manifest_version(blender_manifest);

		log.write('Latest add-on version: %s, Blender add-on version: %s', latest_addon_version, blender_addon_version);

		if (latest_addon_version > blender_addon_version) {
			log.write('Prompting user for Blender add-on update...');
			core.setToast('info', 'A newer version of the Blender add-on is available for you.', {
				'Install': () => module_ref.setActive(),
				'Maybe Later': () => false
			}, -1, false);
		}
	},

	async startAutomaticInstall() {
		using _lock = core.create_busy_lock();
		core.setToast('progress', 'Installing Blender add-on, please wait...', null, -1, false);
		log.write('Starting automatic installation of Blender add-on...');

		try {
			const versions = await get_blender_installations();
			let installed = false;

			for (const version of versions) {
				if (version >= constants.BLENDER.MIN_VER) {
					const addon_path = path.join(constants.BLENDER.DIR, version, constants.BLENDER.ADDON_DIR);
					log.write('Targeting Blender version %s (%s)', version, addon_path);

					await generics.deleteDirectory(addon_path);
					await generics.createDirectory(addon_path);

					const files = await fsp.readdir(constants.BLENDER.LOCAL_DIR, { withFileTypes: true });
					for (const file of files) {
						if (file.isDirectory())
							continue;

						const src_path = path.join(constants.BLENDER.LOCAL_DIR, file.name);
						const dest_path = path.join(addon_path, file.name);

						log.write('%s -> %s', src_path, dest_path);
						await fsp.copyFile(src_path, dest_path);
					}

					installed = true;
				}
			}

			if (installed)
				core.setToast('success', 'The latest add-on version has been installed! (You will need to restart Blender)');
			else {
				log.write('No valid Blender installation found, add-on install failed.');
				core.setToast('error', 'Sorry, a valid Blender 2.8+ installation was not be detected on your system.', null, -1);
			}
		} catch (e) {
			log.write('Installation failed due to exception: %s', e.message);
			core.setToast('error', 'Sorry, an unexpected error occurred trying to install the add-on.', null, -1);
		}
	}
};
