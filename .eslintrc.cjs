module.exports = {
	'root': true,
	'ignorePatterns': ['src/app/3D/lib', 'bin/', '*.js'],
	'parser': 'vue-eslint-parser',
	'parserOptions': {
		'parser': '@typescript-eslint/parser',
		'ecmaVersion': 'latest',
		'sourceType': 'module'
	},

	'env': {
		'node': true,
		'es2020': true,
		'browser': true
	},

	'rules': {
		'@typescript-eslint/no-explicit-any': ['warn', { 'ignoreRestArgs': true }],
		'@typescript-eslint/no-inferrable-types': 'off',
		'@typescript-eslint/type-annotation-spacing': 'warn',
		'@typescript-eslint/space-infix-ops': 'warn',
		'@typescript-eslint/explicit-function-return-type': 'warn',
		'no-debugger': 'warn',
		'indent': ['error', 'tab', { 'SwitchCase': 1 }],
		'linebreak-style': ['error', process.platform === 'win32' ? 'windows' : 'unix'],
		'quotes': ['error', 'single'],
		'semi': ['error', 'always'],
		'space-before-blocks': 'error',
		'brace-style': ['error', '1tbs'],
		'curly': [2, 'multi-or-nest', 'consistent'],
		'no-trailing-spaces': 'error',
		'keyword-spacing': 'error',
		'vue/no-mutating-props': 'off'
	},

	overrides: [
		{
			files: ['*.vue'],
			rules: {
				'indent': 'off',
				'vue/html-indent': ['error', 'tab'],
				'vue/script-indent': ['error', 'tab', { 'baseIndent': 1 }],
				'vue/max-attributes-per-line': 'off',
				'vue/html-self-closing': 'off',
				'vue/attributes-order': 'off',
				'vue/singleline-html-element-content-newline': 'off',
				'vue/require-v-for-key': 'off',
			}
		}
	],

	'plugins': [
		'vue',
		'jest',
		'@typescript-eslint'
	],

	'extends': [
		'eslint:recommended',
		'plugin:@typescript-eslint/recommended',
		'plugin:vue/vue3-recommended'
	]
};