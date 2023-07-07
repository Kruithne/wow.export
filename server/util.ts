/**
 * Merges one or more Uint8Arrays into a single Uint8Array.
 * This is considerably more performant than concatenating via spread operator.
 */
export function merge_typed_array(arrays: Uint8Array[]): Uint8Array {
	let size = 0;
	for (const array of arrays)
		size += array.length;

	const merged = new Uint8Array(size);
	let offset = 0;
	for (const array of arrays) {
		merged.set(array, offset);
		offset += array.length;
	}

	return merged;
}

/** Converts a ReadableStream to an array of chunks. */
export async function stream_to_array<T>(stream: ReadableStream<T>): Promise<T[]> {
	const chunks: T[] = [];

	for await (const chunk of stream)
		chunks.push(chunk);

	return chunks;
}

/** Returns the current git HEAD as a 160-bit hex string (sha1). */
export async function get_git_head(): Promise<string> {
	const git = Bun.spawn(['git', 'rev-parse', 'HEAD']);

	if (git.exitCode !== 0)
		throw new Error('git rev-parse HEAD failed with exit code: ' + git.exitCode);

	if (!git.stdout)
		throw new Error('failed to spawn git process');

	const merged = merge_typed_array(await stream_to_array(git.stdout));
	const decoded = new TextDecoder().decode(merged);

	// Expecting 40 hex characters followed by a newline.
	if (!/^[a-f0-9]{40}\n$/.test(decoded))
		throw new Error('git rev-parse HEAD returned unexpected output: ' + decoded);

	return decoded.trim();
}