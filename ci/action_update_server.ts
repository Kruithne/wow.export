// This script is run automatically by .github/workflows/update_server.yml

import util from 'node:util';
import { get_git_head } from '../server/util';
import { get_remote_head, load_workflow_triggers, git_diff } from './ci_util';

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

	let sources_changed = false;
	const triggers = await load_workflow_triggers('./ci/triggers/server_triggers.txt');
	for (const diff_entry of diff) {
		if (triggers.some(trigger => diff_entry.startsWith(trigger))) {
			sources_changed = true;
			console.log('\t%s (triggered)', diff_entry);
		} else {
			console.log('\t%s (ignored)', diff_entry);
		}
	}

	if (sources_changed) {
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