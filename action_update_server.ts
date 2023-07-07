// This script is run automatically by .github/workflows/update_server.yml

import util from 'node:util';
import { get_git_head } from './server/util';

async function get_remote_head(deploy_key: string): Promise<string> {
	const res = await fetch('https://wowexport.net/services/internal/head?key=' + deploy_key);
	if (!res.ok)
		throw new Error(util.format('Failed to fetch remote HEAD, status code: [%d] %s', res.status, res.statusText));

	const remote_head = await res.text();
	if (!/^[a-f0-9]{40}$/.test(remote_head))
		throw new Error(util.format('Unexpected remote HEAD: %s', remote_head));

	return remote_head;
}

async function git_diff(local_head: string, remote_head: string): Promise<string[]> {
	const git = Bun.spawn(['git', 'diff', '--name-only', local_head, remote_head]);
	const text = await new Response(git.stdout).text();

	if (git.exitCode !== 0)
		throw new Error('git diff exited with code ' + git.exitCode);

	return text.split('\n');
}

async function load_workflow_triggers(): Promise<string[]> {
	const trigger_file = Bun.file('./workflow_triggers/server_deploy.txt');
	const trigger_contents = await trigger_file.text();

	return trigger_contents.split('\n');
}

try {
	const deploy_key = process.argv[2];
	if (deploy_key === undefined || deploy_key.length === 0)
		throw new Error('missing deploy key, usage: node action_update_server.js <deploy_key>');

	const local_head = await get_git_head();
	const remote_head = await get_remote_head(deploy_key);

	console.log('local_head: %s', local_head);
	console.log('remote_head: %s', remote_head);

	const diff = await git_diff(local_head, remote_head);
	if (diff.length === 0) {
		console.log('no changes detected, skipping server update');
		process.exit(0);
	}

	console.log('diff:');
	for (const diff_entry of diff)
		console.log(diff_entry);

	const triggers = await load_workflow_triggers();
	if (diff.some(file => triggers.some(trigger => file.startsWith(trigger)))) {
		console.log('changes detected, triggering server update');

		const res = await fetch('https://wowexport.net/services/internal/update?key=' + deploy_key, { method: 'POST' });
		if (!res.ok)
			throw new Error(util.format('Failed to trigger remote update, status code: [%d] %s', res.status, res.statusText));
	} else {
		console.log('no changes detected, skipping server update');
	}
} catch (e) {
	console.error(e);
	process.exit(1);
}

export {}; // Enables top-level await by making this file a module.