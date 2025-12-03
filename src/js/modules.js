const Vue = require('vue/dist/vue.cjs.js');
const log = require('./log');
const InstallType = require('./install-type');
const constants = require('./constants');

const COMPONENTS = {
	Listbox: require('./components/listbox'),
	ListboxMaps: require('./components/listbox-maps'),
	ListboxZones: require('./components/listbox-zones'),
	Listboxb: require('./components/listboxb'),
	Itemlistbox: require('./components/itemlistbox'),
	Checkboxlist: require('./components/checkboxlist'),
	MenuButton: require('./components/menu-button'),
	FileField: require('./components/file-field'),
	ComboBox: require('./components/combobox'),
	Slider: require('./components/slider'),
	ModelViewerGL: require('./components/model-viewer-gl'),
	MapViewer: require('./components/map-viewer'),
	DataTable: require('./components/data-table'),
	ResizeLayer: require('./components/resize-layer'),
	ContextMenu: require('./components/context-menu'),
	MarkdownContent: require('./components/markdown-content'),
	HomeShowcase: require('./components/home-showcase')
};

const MODULES = {
	module_test_a: require('./modules/module_test_a'),
	module_test_b: require('./modules/module_test_b'),
	source_select: require('./modules/screen_source_select'),
	settings: require('./modules/screen_settings'),
	tab_home: require('./modules/tab_home'),
	tab_maps: require('./modules/tab_maps'),
	tab_zones: require('./modules/tab_zones'),
	tab_data: require('./modules/tab_data'),
	tab_raw: require('./modules/tab_raw'),
	tab_install: require('./modules/tab_install'),
	tab_text: require('./modules/tab_text'),
	tab_fonts: require('./modules/tab_fonts'),
	tab_videos: require('./modules/tab_videos'),
	tab_models: require('./modules/tab_models'),
	tab_audio: require('./modules/tab_audio'),
	tab_items: require('./modules/tab_items'),
	tab_characters: require('./modules/tab_characters'),
	tab_textures: require('./modules/tab_textures'),
	tab_help: require('./modules/tab_help'),
	tab_blender: require('./modules/tab_blender'),
	tab_changelog: require('./modules/tab_changelog'),
	legacy_tab_home: require('./modules/legacy_tab_home'),
	legacy_tab_audio: require('./modules/legacy_tab_audio'),
	legacy_tab_textures: require('./modules/legacy_tab_textures'),
	legacy_tab_fonts: require('./modules/legacy_tab_fonts'),
	legacy_tab_files: require('./modules/legacy_tab_files')
};

const IS_BUNDLED = typeof process.env.BUILD_RELEASE !== 'undefined';

const COMPONENT_PATH_MAP = {
	Listbox: 'listbox',
	ListboxMaps: 'listbox-maps',
	ListboxZones: 'listbox-zones',
	Listboxb: 'listboxb',
	Itemlistbox: 'itemlistbox',
	Checkboxlist: 'checkboxlist',
	MenuButton: 'menu-button',
	FileField: 'file-field',
	ComboBox: 'combobox',
	Slider: 'slider',
	ModelViewerGL: 'model-viewer-gl',
	MapViewer: 'map-viewer',
	DataTable: 'data-table',
	ResizeLayer: 'resize-layer',
	ContextMenu: 'context-menu',
	MarkdownContent: 'markdown-content',
	HomeShowcase: 'home-showcase'
};

let component_cache = {};

// components that should not be reloaded. in an ideal world we would support hot-reloading
// these but it was too much effort at the time, so c'est la vie
const EXCLUDE_FROM_RELOAD = new Set(['ModelViewerGL', 'MapViewer']);

const component_registry = new Proxy({}, {
	get(target, name) {
		if (IS_BUNDLED)
			return COMPONENTS[name];

		if (!component_cache[name]) {
			const file_name = COMPONENT_PATH_MAP[name];
			if (!file_name) {
				log.write('component not found in registry: %s', name);
				return undefined;
			}

			const path = require.resolve('./components/' + file_name);
			delete require.cache[path];

			log.write('hot-reloading component: %s', name);
			component_cache[name] = require('./components/' + file_name);
		}

		return component_cache[name];
	}
});

const modules = {}
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

function unregister_nav_button(module_name) {
	if (module_nav_buttons.delete(module_name)) {
		update_nav_buttons();
		log.write('unregistered nav button for module: %s', module_name);
	}
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

		// items not in order go to end
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
	// inject $modules, $core, and $components into component
	if (!module_def.computed)
		module_def.computed = {};

	module_def.computed.$modules = () => manager;
	module_def.computed.$core = () => core;
	module_def.computed.$components = () => component_registry;

	// call register function if it exists
	if (typeof module_def.register === 'function') {
		const register_context = {
			registerNavButton: (label, icon, install_types) => register_nav_button(module_name, label, icon, install_types),
			registerContextMenuOption: (label, icon) => register_context_menu_option(module_name, label, icon)
		};
		module_def.register.call(register_context);
	}

	return new Proxy(module_def, {
		get(target, prop) {
			if (prop === '__name')
				return module_name;

			if (prop === 'setActive')
				return () => set_active(module_name);

			if (prop === 'reload')
				return () => reload_module(module_name);

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
	manager = module.exports;

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

function setActive(module_key) {
	set_active(module_key);
}

function go_to_landing() {
	if (core.view.installType === 0)
		set_active('source_select');
	else if (core.view.installType === InstallType.MPQ)
		set_active('legacy_tab_home');
	else
		set_active('tab_home');
}

function reload_module(module_key) {
	if (IS_BUNDLED) {
		log.write('cannot reload module %s: not available in production', module_key);
		return;
	}

	if (!modules[module_key]) {
		log.write('cannot reload module %s: not found', module_key);
		return;
	}

	const was_active = active_module === modules[module_key];

	if (was_active) {
		core.view.activeModule = null;
		active_module = null;
	}

	// invalidate component cache so they're re-required on next access
	// preserve excluded components (stateful 3D viewers)
	const preserved = {};
	for (const name of EXCLUDE_FROM_RELOAD) {
		if (component_cache[name])
			preserved[name] = component_cache[name];
	}
	component_cache = preserved;

	unregister_nav_button(module_key);
	unregister_context_menu_option(module_key);
	delete modules[module_key];

	const module_path = require.resolve('./modules/' + module_key);
	delete require.cache[module_path];

	const module_def = Vue.markRaw(require('./modules/' + module_key));
	modules[module_key] = wrap_module(module_key, module_def);

	log.write('reloaded module: %s', module_key);

	if (was_active)
		set_active(module_key);
}

function reload_active_module() {
	if (IS_BUNDLED) {
		log.write('cannot reload active module: not available in production');
		return;
	}

	if (!active_module) {
		log.write('no active module to reload');
		return;
	}

	const module_key = active_module.__name;
	reload_module(module_key);
}

function reload_all_modules() {
	if (IS_BUNDLED) {
		log.write('cannot reload modules: not available in production');
		return;
	}

	const active_module_key = active_module ? active_module.__name : null;

	core.view.activeModule = null;
	active_module = null;

	const module_keys = Object.keys(modules);
	for (const module_key of module_keys) {
		unregister_nav_button(module_key);
		unregister_context_menu_option(module_key);
		delete modules[module_key];
	}

	for (const [name, module_def] of Object.entries(MODULES)) {
		const module_path = require.resolve('./modules/' + name);
		delete require.cache[module_path];

		const fresh_module = Vue.markRaw(require('./modules/' + name));
		modules[name] = wrap_module(name, fresh_module);
	}

	log.write('reloaded all modules: %s', Object.keys(modules).join(', '));

	if (active_module_key && modules[active_module_key])
		set_active(active_module_key);
}

module.exports = new Proxy({ register_components, initialize, set_active, setActive, go_to_landing, reload_module, reloadActiveModule: reload_active_module, reloadAllModules: reload_all_modules, registerContextMenuOption: register_static_context_menu_option, InstallType }, {
	get(target, prop) {
		if (prop in target)
			return target[prop];

		return modules[prop];
	}
});