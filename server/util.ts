/** Returns the current git HEAD as a 160-bit hex string (sha1). */
export async function get_git_head(): Promise<string> {
	const git = Bun.spawn(['git', 'rev-parse', 'HEAD']);
	const text = await new Response(git.stdout).text();

	if (git.exitCode !== 0)
		throw new Error('git rev-parse HEAD failed with exit code: ' + git.exitCode);

	// Expecting 40 hex characters followed by a newline.
	if (!/^[a-f0-9]{40}\n$/.test(text))
		throw new Error('git rev-parse HEAD returned unexpected output: ' + text);

	return text.trim();
}