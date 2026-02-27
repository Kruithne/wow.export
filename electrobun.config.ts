import type { ElectrobunConfig } from 'electrobun';

export default {
	app: {
		name: 'wow.export',
		identifier: 'net.kruithne.wowexport',
		version: '0.2.14',
		description: 'Export Toolkit for World of Warcraft',
	},

	build: {
		bun: {
			entrypoint: 'src/bun/index.js',
			define: {
				'BUILD_RELEASE': '"true"',
			},
		},

		views: {
			main: {
				entrypoint: 'src/views/main/index.js',
				define: {
					'BUILD_RELEASE': '"true"',
					'global': 'globalThis',
					'kCustomPromisifiedSymbol': 'Symbol.for("nodejs.util.promisify.custom")',
					'__VUE_OPTIONS_API__': 'true',
					'__VUE_PROD_DEVTOOLS__': 'false',
					'__VUE_PROD_HYDRATION_MISMATCH_DETAILS__': 'false',
				},
			},
		},

		copy: {
			'src/views/main/index.html': 'views/main/index.html',
			'src/app.css': 'views/main/index.css',
			'src/images': 'views/main/images',
			'src/fonts': 'views/main/fonts',
			'src/fa-icons': 'views/main/fa-icons',
			'src/shaders': 'views/main/shaders',
			'src/help_docs': 'views/main/help_docs',
			'src/whats-new.html': 'views/main/whats-new.html',
			'addons/blender/io_scene_wowobj': 'addon/io_scene_wowobj',
			'src/default_config.jsonc': 'default_config.jsonc',
			'CHANGELOG.md': 'CHANGELOG.md',
			'LEGAL': 'license/LEGAL',
		},

		win: {
			bundleCEF: true,
			defaultRenderer: 'cef',
			icon: 'resources/icon.ico',
			chromiumFlags: {
				'ignore-gpu-blocklist': true,
				'enable-gpu': true,
				'in-process-gpu': true,
			},
		},

		mac: {
			bundleCEF: true,
			defaultRenderer: 'cef',
		},

		linux: {
			bundleCEF: true,
			defaultRenderer: 'cef',
			icon: 'resources/icon.png',
		},
	},

	release: {
		baseUrl: 'https://www.kruithne.net/wow.export/update/',
		generatePatch: true,
	},

	runtime: {
		exitOnLastWindowClosed: true,
	},
} satisfies ElectrobunConfig;
