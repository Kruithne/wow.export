import typescript from 'rollup-plugin-typescript2';
import terser from '@rollup/plugin-terser';
import path from 'node:path';

const config = {
	input: './src/app.ts',
	output: {
		file: path.join(process.env.BUILD_DIR, 'src', 'app.js'),
		format: 'esm'
	},
	plugins: [
		typescript({
			tsconfig: './tsconfig.json'
		})
	]
};

// Only perform minification in release builds.
if (process.env.BUILD_TYPE === 'release') {
	config.plugins.push(terser({
		'compress': {
			'global_defs': {
				// Set the build type as a global definition so that it's computed at build time
				// instead of at runtime, allowing the minifier to remove the dead code.
				'process.env.BUILD_TYPE': process.env.BUILD_TYPE
			}
		}
	}));
}

export default config;