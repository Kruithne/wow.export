module.exports = {
	'root': true,
	'ignorePatterns': ['lib/', 'src/js/3D/lib/', 'bin/'],
	'parserOptions': {
		'ecmaVersion': 'latest',
		'sourceType': 'module'
	},
	'globals': {
		'Vue': true,
		'THREE': true,
		'nw': true,
		'BUILD_RELEASE': true,
		'chrome': true,
		'crash': true,
		'getErrorDump': true
	},
	'env': {
		'node': true,
		'es2021': true
	},
	'rules': {
		'indent': [ 'error', 'tab' ],
		'linebreak-style': [ 'error', process.platform === 'win32' ? 'windows' : 'unix' ],
		'quotes': [ 'error', 'single' ],
		'semi': [ 'error', 'always' ],
		'space-before-blocks': 'error',
		'curly': [ 2, 'multi-or-nest', 'consistent' ],
		'no-trailing-spaces': 'error',
		'keyword-spacing': 'error'
	},
	'plugins': [
		'vue',
		'jest',
		'@typescript-eslint'
	],
	'extends': [
		'eslint:recommended',
		'plugin:@typescript-eslint/recommended',
		'plugin:vue/base'
	]
}