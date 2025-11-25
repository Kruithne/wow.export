const Vue = require('vue/dist/vue.cjs.js');
const log = require('./log');
const InstallType = require('./install-type');

const MODULES = {
	module_test_a: require('./modules/module_test_a'),
	module_test_b: require('./modules/module_test_b'),
	tab_home: require('./modules/tab_home'),
	tab_maps: require('./modules/tab_maps'),
	tab_zones: require('./modules/tab_zones'),
	tab_data: require('./modules/tab_data'),
	tab_text: require('./modules/tab_text'),
	tab_videos: require('./modules/tab_videos'),
	tab_models: require('./modules/tab_models'),
	tab_audio: require('./modules/tab_audio'),
	tab_items: require('./modules/tab_items'),
	tab_characters: require('./modules/tab_characters'),
	tab_textures: require('./modules/tab_textures'),
	legacy_tab_home: require('./modules/legacy_tab_home'),
	legacy_tab_audio: require('./modules/legacy_tab_audio'),
	legacy_tab_textures: require('./modules/legacy_tab_textures')
};

const IS_BUNDLED = typeof process.env.BUILD_RELEASE !== 'undefined';

const modules = {}
const module_nav_buttons = new Map();

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
	core.view.modNavButtons = Array.from(module_nav_buttons.values());
}

function wrap_module(module_name, module_def) {
	// inject $modules and $core into component
	if (!module_def.computed)
		module_def.computed = {};

	module_def.computed.$modules = () => manager;
	module_def.computed.$core = () => core;

	// call register function if it exists
	if (typeof module_def.register === 'function') {
		const register_context = {
			registerNavButton: (label, icon, install_types) => register_nav_button(module_name, label, icon, install_types)
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

async function initialize(core_instance) {
	log.write('initializing modules');

	core = core_instance;
	manager = module.exports;

	for (const [name, module_def] of Object.entries(MODULES))
		modules[name] = wrap_module(name, Vue.markRaw(module_def));

	log.write('modules loaded: %s', Object.keys(modules).join(', '));
}

function set_active(module_key) {
	if (active_module) {
		core.view.activeModule = null;
		active_module = null;
	}

	if (module_key && modules[module_key]) {
		active_module = modules[module_key];
		core.view.activeModule = active_module;
		core.view.screenStack[0] = null;
		log.write('set active module: %s', module_key);
	}
}

function setActive(module_key) {
	set_active(module_key);
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

	unregister_nav_button(module_key);
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

module.exports = new Proxy({ initialize, set_active, setActive, reload_module, reloadActiveModule: reload_active_module, reloadAllModules: reload_all_modules, InstallType }, {
	get(target, prop) {
		if (prop in target)
			return target[prop];

		return modules[prop];
	}
});