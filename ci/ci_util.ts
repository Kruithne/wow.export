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

export async function load_workflow_triggers(trigger_file_path: string): Promise<string[]> {
	const trigger_file = Bun.file(trigger_file_path);
	const trigger_contents = await trigger_file.text();

	return trigger_contents.split('\n');
}