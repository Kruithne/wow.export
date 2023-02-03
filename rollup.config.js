import typescript from 'rollup-plugin-typescript2';
import terser from '@rollup/plugin-terser';
import path from 'node:path';
import alias from '@rollup/plugin-alias';
import replace from '@rollup/plugin-replace';
import resolve from '@rollup/plugin-node-resolve';

const config = {
	input: './src/app/app.ts',
	output: {
		file: path.join(process.env.BUILD_DIR, 'src', 'app.js'),
		format: 'cjs'
	},
	plugins: [
		alias({
			entries: [
				// See https://www.npmjs.com/package/vue for distribution versions.
				{ find: 'vue', replacement: 'node_modules/vue/dist/vue.esm-bundler.js' }
			]
		}),
		resolve({
			preferBuiltins: true,
			browser: true,
			moduleDirectories: ['node_modules']
		}),
		replace({
			'__VUE_OPTIONS_API__': true, // See https://link.vuejs.org/feature-flags
			'__VUE_PROD_DEVTOOLS__': false, // See https://link.vuejs.org/feature-flags
			'process.env.NODE_ENV': process.env.BUILD_TYPE === 'release' ? '"production"' : '"development"',
			preventAssignment: true
		}),
		typescript({
			tsconfig: './tsconfig.json'
		})
	]
};

// Only perform minification in release builds.
if (process.env.BUILD_TYPE === 'release') {
	config.plugins.push(terser({
		compress: {
			pure_funcs: [
				'assert.strictEqual',
				'assert.notStrictEqual',
				'assert.fail',
				'assert.throws',
				'assert.doesNotThrow',
				'assert.deepStrictEqual',
				'assert.notDeepStrictEqual'
			]
		}
	}));
}

export default config;