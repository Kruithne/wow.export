import * as Vue from 'vue';
import log from './log.js';
import InstallType from './install-type.js';
import constants from './constants.js';

import Listbox from './components/listbox.js';
import ListboxMaps from './components/listbox-maps.js';
import ListboxZones from './components/listbox-zones.js';
import Listboxb from './components/listboxb.js';
import Itemlistbox from './components/itemlistbox.js';
import Checkboxlist from './components/checkboxlist.js';
import MenuButton from './components/menu-button.js';
import FileField from './components/file-field.js';
import ComboBox from './components/combobox.js';
import Slider from './components/slider.js';
import ModelViewerGL from './components/model-viewer-gl.js';
import MapViewer from './components/map-viewer.js';
import DataTable from './components/data-table.js';
import ResizeLayer from './components/resize-layer.js';
import ContextMenu from './components/context-menu.js';
import MarkdownContent from './components/markdown-content.js';
import HomeShowcase from './components/home-showcase.js';

import module_test_a from './modules/module_test_a.js';
import module_test_b from './modules/module_test_b.js';
import source_select from './modules/screen_source_select.js';
import settings from './modules/screen_settings.js';
import tab_home from './modules/tab_home.js';
import tab_maps from './modules/tab_maps.js';
import tab_zones from './modules/tab_zones.js';
import tab_data from './modules/tab_data.js';
import tab_raw from './modules/tab_raw.js';
import tab_install from './modules/tab_install.js';
import tab_text from './modules/tab_text.js';
import tab_fonts from './modules/tab_fonts.js';
import tab_videos from './modules/tab_videos.js';
import tab_models from './modules/tab_models.js';
import tab_creatures from './modules/tab_creatures.js';
import tab_decor from './modules/tab_decor.js';
import tab_audio from './modules/tab_audio.js';
import tab_items from './modules/tab_items.js';
import tab_item_sets from './modules/tab_item_sets.js';
import tab_characters from './modules/tab_characters.js';
import tab_textures from './modules/tab_textures.js';
import tab_help from './modules/tab_help.js';
import tab_blender from './modules/tab_blender.js';
import tab_changelog from './modules/tab_changelog.js';
import legacy_tab_home from './modules/legacy_tab_home.js';
import legacy_tab_audio from './modules/legacy_tab_audio.js';
import legacy_tab_textures from './modules/legacy_tab_textures.js';
import legacy_tab_fonts from './modules/legacy_tab_fonts.js';
import legacy_tab_files from './modules/legacy_tab_files.js';
import legacy_tab_data from './modules/legacy_tab_data.js';
import tab_models_legacy from './modules/tab_models_legacy.js';

const COMPONENTS = {
	Listbox, ListboxMaps, ListboxZones, Listboxb, Itemlistbox,
	Checkboxlist, MenuButton, FileField, ComboBox, Slider,
	ModelViewerGL, MapViewer, DataTable, ResizeLayer,
	ContextMenu, MarkdownContent, HomeShowcase
};

const MODULES = {
	module_test_a, module_test_b,
	source_select, settings,
	tab_home, tab_maps, tab_zones, tab_data, tab_raw, tab_install,
	tab_text, tab_fonts, tab_videos, tab_models, tab_creatures, tab_decor,
	tab_audio, tab_items, tab_item_sets, tab_characters, tab_textures,
	tab_help, tab_blender, tab_changelog,
	legacy_tab_home, legacy_tab_audio, legacy_tab_textures,
	legacy_tab_fonts, legacy_tab_files, legacy_tab_data,
	tab_models_legacy
};

const component_registry = COMPONENTS;

const modules = {};
const module_nav_buttons = new Map();
const module_context_menu_options = new Map();

let active_module = null;
let core = null;
let manager = null;

function register_nav_button(module_name, label, icon, install_types) {
	const button = {
		module: module_name,
		label,
		icon,
		installTypes: install_types
	};

	module_nav_buttons.set(module_name, button);
	update_nav_buttons();
	log.write('registered nav button for module: %s', module_name);
}

function update_nav_buttons() {
	const order = constants.NAV_BUTTON_ORDER;
	const buttons = Array.from(module_nav_buttons.values());

	buttons.sort((a, b) => {
		const idx_a = order.indexOf(a.module);
		const idx_b = order.indexOf(b.module);

		if (idx_a === -1 && idx_b === -1)
			return 0;

		if (idx_a === -1)
			return 1;

		if (idx_b === -1)
			return -1;

		return idx_a - idx_b;
	});

	core.view.modNavButtons = buttons;
}

function register_context_menu_option(id, label, icon, action = null) {
	const option = { id, label, icon, action };
	module_context_menu_options.set(id, option);
	update_context_menu_options();
	log.write('registered context menu option: %s', id);
}

function unregister_context_menu_option(id) {
	if (module_context_menu_options.delete(id)) {
		update_context_menu_options();
		log.write('unregistered context menu option: %s', id);
	}
}

function update_context_menu_options() {
	const order = constants.CONTEXT_MENU_ORDER;
	const options = Array.from(module_context_menu_options.values());

	options.sort((a, b) => {
		const idx_a = order.indexOf(a.id);
		const idx_b = order.indexOf(b.id);

		if (idx_a === -1 && idx_b === -1)
			return 0;

		if (idx_a === -1)
			return 1;

		if (idx_b === -1)
			return -1;

		return idx_a - idx_b;
	});

	core.view.modContextMenuOptions = options;
}

function wrap_module(module_name, module_def) {
	if (!module_def.computed)
		module_def.computed = {};

	module_def.computed.$modules = () => manager;
	module_def.computed.$core = () => core;
	module_def.computed.$components = () => component_registry;

	let display_label = module_name;

	if (typeof module_def.register === 'function') {
		const register_context = {
			registerNavButton: (label, icon, install_types) => {
				display_label = label;
				register_nav_button(module_name, label, icon, install_types);
			},
			registerContextMenuOption: (label, icon) => register_context_menu_option(module_name, label, icon)
		};
		module_def.register.call(register_context);
	}

	if (module_def.methods?.initialize) {
		const original_initialize = module_def.methods.initialize;

		module_def.methods.initialize = async function() {
			if (this._tab_initialized || this._tab_initializing)
				return;

			this._tab_initializing = true;

			try {
				await original_initialize.call(this);
				this._tab_initialized = true;
			} catch (error) {
				this.$core.hideLoadingScreen();
				log.write('Failed to initialize %s tab: %o', display_label, error);
				this.$core.setToast('error', 'Failed to initialize ' + display_label + ' tab. Check the log for details.', { 'View Log': () => log.openRuntimeLog() }, -1);
				this.$modules.go_to_landing();
			} finally {
				this._tab_initializing = false;
			}
		};

		const original_activated = module_def.activated;
		module_def.activated = function() {
			if (!this._tab_initialized && !this._tab_initializing)
				this.initialize();

			if (original_activated)
				original_activated.call(this);
		};
	}

	return new Proxy(module_def, {
		get(target, prop) {
			if (prop === '__name')
				return module_name;

			if (prop === 'setActive')
				return () => set_active(module_name);

			return target[prop];
		}
	});
}

function register_components(app) {
	for (const [name, def] of Object.entries(COMPONENTS))
		app.component(name, def);

	log.write('components loaded: %s', Object.keys(COMPONENTS).join(', '));
}

async function initialize(core_instance) {
	log.write('initializing modules');

	core = core_instance;
	manager = exported;

	for (const [name, module_def] of Object.entries(MODULES))
		modules[name] = wrap_module(name, Vue.markRaw(module_def));

	log.write('modules loaded: %s', Object.keys(modules).join(', '));
}

function register_static_context_menu_option(id, label, icon, action, dev_only = false) {
	register_context_menu_option(id, label, icon, { handler: action, dev_only });
}

function set_active(module_key) {
	if (active_module) {
		core.view.activeModule = null;
		active_module = null;
	}

	if (module_key && modules[module_key]) {
		active_module = modules[module_key];
		core.view.activeModule = active_module;
		log.write('set active module: %s', module_key);
	}
}

function go_to_landing() {
	if (core.view.installType === 0)
		set_active('source_select');
	else if (core.view.installType === InstallType.MPQ)
		set_active('legacy_tab_home');
	else
		set_active('tab_home');
}

const exported = new Proxy({
	register_components,
	initialize,
	set_active,
	setActive: set_active,
	go_to_landing,
	registerContextMenuOption: register_static_context_menu_option,
	InstallType
}, {
	get(target, prop) {
		if (prop in target)
			return target[prop];

		return modules[prop];
	}
});

export default exported;
