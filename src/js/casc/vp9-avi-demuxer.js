/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

/**
 * VP9AVIDemuxer - Minimal AVI container parser for VP9-encoded video streams
 * Extracts video frames from VP9 AVI files for WebCodecs playback
 */
class VP9AVIDemuxer {
	constructor(stream_reader) {
		this.reader = stream_reader;
		this.config = null;
		this.frame_rate = 30; // default, will parse from avih chunk
	}

	/**
	 * Parse AVI header to extract codec configuration
	 * @returns {Object} WebCodecs VideoDecoder configuration
	 */
	async parse_header() {
		const first_block = await this.reader.getBlock(0);
		const data = first_block.raw;
		const view = new DataView(data.buffer, data.byteOffset);

		// find avih chunk for frame rate
		let offset = this.find_chunk(data, 'avih');
		if (offset !== -1) {
			const micro_per_frame = view.getUint32(offset + 8, true);
			this.frame_rate = 1000000 / micro_per_frame;
		}

		// find strf chunk for dimensions and codec
		offset = this.find_chunk(data, 'strf');
		if (offset !== -1) {
			const width = view.getUint32(offset + 12, true);
			const height = view.getUint32(offset + 16, true);

			// verify VP9 codec
			const codec_fourcc = String.fromCharCode(
				data[offset + 24], data[offset + 25],
				data[offset + 26], data[offset + 27]
			);

			if (codec_fourcc !== 'VP90') {
				throw new Error(`unsupported codec: ${codec_fourcc} (expected VP90)`);
			}

			this.config = {
				codec: 'vp09.00.10.08', // VP9 profile 0, level 1.0, 8-bit
				codedWidth: width,
				codedHeight: height,
				hardwareAcceleration: 'prefer-hardware'
			};
		}

		return this.config;
	}

	/**
	 * Find chunk by fourCC identifier in AVI data
	 * @param {Uint8Array} data - AVI data buffer
	 * @param {string} fourcc - Four-character code to search for
	 * @returns {number} Offset of chunk, or -1 if not found
	 */
	find_chunk(data, fourcc) {
		const target = new TextEncoder().encode(fourcc);
		for (let i = 0; i < data.length - 4; i++) {
			if (data[i] === target[0] &&
				data[i+1] === target[1] &&
				data[i+2] === target[2] &&
				data[i+3] === target[3])
				return i;
		}
		return -1;
	}

	/**
	 * Extract video frames from stream blocks
	 * @yields {Object} Frame info: { type, timestamp, duration, data }
	 */
	async* extract_frames() {
		let timestamp = 0;
		const frame_duration = Math.floor(1000000 / this.frame_rate); // microseconds
		let first_block = true;
		let leftover_buffer = null;
		let block_num = 0;

		for await (const block of this.reader.streamBlocks()) {
			block_num++;

			// combine leftover from previous block with current block
			let data;
			if (leftover_buffer) {
				const combined = new Uint8Array(leftover_buffer.length + block.raw.length);
				combined.set(leftover_buffer, 0);
				combined.set(block.raw, leftover_buffer.length);
				data = combined;
				leftover_buffer = null;
			} else {
				data = block.raw;
			}

			const result = this.parse_movi_frames_with_remainder(data, first_block);
			first_block = false;

			console.log(`block ${block_num}: parsed ${result.frames.length} frames, remainder: ${result.remainder ? result.remainder.length : 0} bytes`);

			// save unparsed data for next block
			if (result.remainder && result.remainder.length > 0)
				leftover_buffer = result.remainder;

			for (const frame_data of result.frames) {
				yield {
					type: 'key',
					timestamp: timestamp,
					duration: frame_duration,
					data: frame_data
				};
				timestamp += frame_duration;
			}
		}

		console.log(`total blocks processed: ${block_num}`);
	}

	/**
	 * Parse movi chunk to extract individual video frames with remainder handling
	 * @param {Uint8Array} data - Block data containing video frames
	 * @param {boolean} skip_header - Whether to skip AVI header on first block
	 * @returns {Object} { frames: Array<Uint8Array>, remainder: Uint8Array }
	 */
	parse_movi_frames_with_remainder(data, skip_header) {
		const frames = [];
		const view = new DataView(data.buffer, data.byteOffset);
		let offset = 0;

		// skip to movi chunk on first block
		if (skip_header) {
			const movi_offset = this.find_chunk(data, 'movi');
			if (movi_offset !== -1) {
				offset = movi_offset + 4;
				console.log(`found movi chunk at offset ${movi_offset}, starting parse at ${offset}`);
			} else {
				console.log('movi chunk not found in first block');
				return { frames: [], remainder: null };
			}
		}

		let last_valid_offset = offset;
		let chunks_found = 0;

		while (offset <= data.length - 8) {
			// read chunk fourcc and size
			const chunk_id = String.fromCharCode(
				data[offset], data[offset+1],
				data[offset+2], data[offset+3]
			);
			const chunk_size = view.getUint32(offset + 4, true);

			// check if we have enough data for this chunk
			if (offset + 8 + chunk_size > data.length) {
				// chunk spans block boundary, save remainder
				console.log(`chunk ${chunk_id} size ${chunk_size} spans boundary at offset ${offset}`);
				break;
			}

			// validate chunk size is reasonable
			if (chunk_size === 0 || chunk_size > 10 * 1024 * 1024) {
				// skip invalid chunk, try to find next valid chunk
				console.log(`invalid chunk at offset ${offset}: id=${chunk_id}, size=${chunk_size}`);
				offset++;
				continue;
			}

			chunks_found++;

			// video chunks: '00dc' (compressed) or '00db' (uncompressed/keyframe)
			if (chunk_id === '00dc' || chunk_id === '00db') {
				const frame = data.slice(offset + 8, offset + 8 + chunk_size);
				if (frame.length > 0)
					frames.push(frame);
			}

			offset += 8 + chunk_size;
			// AVI uses word alignment
			if (chunk_size % 2)
				offset++;

			last_valid_offset = offset;
		}

		console.log(`parsed ${chunks_found} chunks, ${frames.length} video frames, consumed ${last_valid_offset} bytes of ${data.length}`);

		// return unparsed data as remainder
		const remainder = last_valid_offset < data.length ? data.slice(last_valid_offset) : null;
		return { frames, remainder };
	}

	/**
	 * Parse movi chunk to extract individual video frames (deprecated, kept for compatibility)
	 * @param {Uint8Array} data - Block data containing video frames
	 * @param {boolean} skip_header - Whether to skip AVI header on first block
	 * @returns {Array<Uint8Array>} Array of frame data buffers
	 */
	parse_movi_frames(data, skip_header) {
		const frames = [];
		const view = new DataView(data.buffer, data.byteOffset);
		let offset = 0;

		// skip to movi chunk on first block
		if (skip_header) {
			const movi_offset = this.find_chunk(data, 'movi');
			if (movi_offset !== -1)
				offset = movi_offset + 4;
		}

		while (offset <= data.length - 8) {
			// read chunk fourcc and size
			const chunk_id = String.fromCharCode(
				data[offset], data[offset+1],
				data[offset+2], data[offset+3]
			);
			const chunk_size = view.getUint32(offset + 4, true);

			// check if we have enough data for this chunk
			if (offset + 8 + chunk_size > data.length) {
				// chunk spans block boundary, will be in next block
				break;
			}

			// validate chunk size is reasonable
			if (chunk_size === 0 || chunk_size > 10 * 1024 * 1024) {
				// skip invalid chunk, try to find next valid chunk
				offset++;
				continue;
			}

			// video chunks: '00dc' (compressed) or '00db' (uncompressed/keyframe)
			if (chunk_id === '00dc' || chunk_id === '00db') {
				const frame = data.slice(offset + 8, offset + 8 + chunk_size);
				// only add non-empty frames
				if (frame.length > 0)
					frames.push(frame);
			}

			offset += 8 + chunk_size;
			// AVI uses word alignment
			if (chunk_size % 2)
				offset++;
		}

		return frames;
	}
}

module.exports = VP9AVIDemuxer;
