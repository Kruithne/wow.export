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
		},

		views: {
			main: {
				entrypoint: 'src/views/main/index.js',
			},
		},

		copy: {
			'src/views/main/index.html': 'views/main/index.html',
			'src/views/main/index.css': 'views/main/index.css',
		},

		win: {
			bundleCEF: true,
			defaultRenderer: 'cef',
		},

		mac: {
			bundleCEF: true,
			defaultRenderer: 'cef',
		},

		linux: {
			bundleCEF: true,
			defaultRenderer: 'cef',
		},
	},
} satisfies ElectrobunConfig;
