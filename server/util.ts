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