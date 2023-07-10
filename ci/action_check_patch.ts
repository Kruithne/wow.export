// This script is run automatically by .github/workflows/update_patch.yml

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
	for (const diff_entry of diff)
		console.log(diff_entry);

	let sources_changed = false;
	const triggers = await load_workflow_triggers('./ci/triggers/patch_triggers.txt');
	for (const diff_entry of diff) {
		if (triggers.some(trigger => diff_entry.startsWith(trigger))) {
			sources_changed = true;
			console.log('\t%s (triggered)', diff_entry);
		} else {
			console.log('\t%s (ignored)', diff_entry);
		}
	}

	if (sources_changed) {
		console.log('changes detected');
		process.exit(200); // 200 exit code is picked up by the ci to continue the workflow
	} else {
		console.log('no changes detected, skipping client update');
	}
} catch (e) {
	console.error(e);
	process.exit(1);
}

export {}; // Enables top-level await by making this file a module.