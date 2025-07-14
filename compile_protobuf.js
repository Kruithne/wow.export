#!/usr/bin/env bun

import { spawn } from 'bun';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

async function compile_protobuf() {
	console.log('Compiling protobuf schemas...');
	
	const project_root = process.cwd();
	const proto_dir = join(project_root, 'proto');
	const proto_file = join(proto_dir, 'messages.proto');
	
	const gui_proto_dir = join(project_root, 'gui', 'src', 'proto');
	
	if (!existsSync(gui_proto_dir))
		mkdirSync(gui_proto_dir, { recursive: true });
	
	console.log('Generating JavaScript protobuf classes using protobufjs...');
	
	// Generate JavaScript using pbjs
	const pbjs_result = spawn({
		cmd: [
			'bun', 'x', 'pbjs',
			'--es6', join(gui_proto_dir, 'messages.js'),
			proto_file
		],
		cwd: project_root,
		stdio: ['inherit', 'inherit', 'inherit']
	});
	
	const pbjs_exit_code = await pbjs_result.exited;
	if (pbjs_exit_code !== 0) {
		console.error('JavaScript protobuf compilation failed with exit code:', pbjs_exit_code);
		process.exit(pbjs_exit_code);
	}
	
	const pbts_result = spawn({
		cmd: [
			'bun', 'x', 'pbjs',
			'--ts', join(gui_proto_dir, 'messages.d.ts'),
			proto_file
		],
		cwd: project_root,
		stdio: ['inherit', 'inherit', 'inherit']
	});
	
	const pbts_exit_code = await pbts_result.exited;
	if (pbts_exit_code !== 0) {
		console.error('TypeScript definitions generation failed with exit code:', pbts_exit_code);
		process.exit(pbts_exit_code);
	}
	
	console.log('✓ Protobuf schemas compiled successfully');
}

if (import.meta.main) {
	compile_protobuf().catch((error) => {
		console.error('Protobuf compilation failed:', error.message);
		process.exit(1);
	});
}

export { compile_protobuf };