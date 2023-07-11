// This script is run automatically by .github/workflows/update_patch.yml

import { get_git_head } from '../server/util';
import triggers from './triggers.toml';
import util from 'node:util';

export async function get_remote_head(deploy_key: string): Promise<string> {
	const res = await fetch('https://wowexport.net/services/internal/head?key=' + deploy_key);
	if (!res.ok)
		throw new Error(util.format('Failed to fetch remote HEAD, status code: [%d] %s', res.status, res.statusText));

	const remote_head = await res.text();
	if (!/^[a-f0-9]{40}$/.test(remote_head))
		throw new Error(util.format('Unexpected remote HEAD: %s', remote_head));

	return remote_head;
}

export async function git_diff(local_head: string, remote_head: string): Promise<string[]> {
	const git = Bun.spawn(['git', 'diff', '--name-only', local_head, remote_head]);
	const text = await new Response(git.stdout).text();

	await git.exited;

	if (git.exitCode !== 0)
		throw new Error('git diff exited with code ' + git.exitCode);

	return text.split('\n').filter(line => line.length > 0);
}

try {
	const deploy_key = process.argv[2];
	if (deploy_key === undefined || deploy_key.length === 0)
		throw new Error('missing deploy key, usage: node action_update_server.js <deploy_key>');

	const local_head = await get_git_head();
	const remote_head = await get_remote_head(deploy_key);

	const diff = await git_diff(local_head, remote_head);
	if (diff.length === 0)
		process.exit(0);

	const triggered = [];
	for (const [deploy_key, deploy_triggers] of Object.entries(triggers)) {
		for (const trigger of deploy_triggers as string[]) {
			if (diff.some(diff_entry => diff_entry.startsWith(trigger))) {
				triggered.push(deploy_key);
				break;
			}
		}
	}

	console.log(triggered.join(','));
} catch (e) {
	console.error(e);
	process.exit(1);
}

export {}; // Enables top-level await by making this file a module.