class VP9AVIDemuxer {
	constructor(stream_reader) {
		this.reader = stream_reader;
		this.config = null;
		this.frame_rate = 30;
	}

	async parse_header() {
		const first_block = await this.reader.getBlock(0);
		const data = first_block.raw;
		const view = new DataView(data.buffer, data.byteOffset);

		let offset = this.find_chunk(data, 'avih');
		if (offset !== -1) {
			const micro_per_frame = view.getUint32(offset + 8, true);
			this.frame_rate = 1000000 / micro_per_frame;
		}

		offset = this.find_chunk(data, 'strf');
		if (offset !== -1) {
			const width = view.getUint32(offset + 12, true);
			const height = view.getUint32(offset + 16, true);

			const codec_fourcc = String.fromCharCode(
				data[offset + 24], data[offset + 25],
				data[offset + 26], data[offset + 27]
			);

			if (codec_fourcc !== 'VP90')
				throw new Error('unsupported codec: ' + codec_fourcc + ' (expected VP90)');

			this.config = {
				codec: 'vp09.00.10.08',
				codedWidth: width,
				codedHeight: height,
				hardwareAcceleration: 'prefer-hardware'
			};
		}

		return this.config;
	}

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

	async* extract_frames() {
		let timestamp = 0;
		const frame_duration = Math.floor(1000000 / this.frame_rate);
		let first_block = true;
		let leftover_buffer = null;

		for await (const block of this.reader.streamBlocks()) {
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
	}

	parse_movi_frames_with_remainder(data, skip_header) {
		const frames = [];
		const view = new DataView(data.buffer, data.byteOffset);
		let offset = 0;

		if (skip_header) {
			const movi_offset = this.find_chunk(data, 'movi');
			if (movi_offset !== -1)
				offset = movi_offset + 4;
			else
				return { frames: [], remainder: null };
		}

		let last_valid_offset = offset;

		while (offset <= data.length - 8) {
			const chunk_id = String.fromCharCode(
				data[offset], data[offset+1],
				data[offset+2], data[offset+3]
			);
			const chunk_size = view.getUint32(offset + 4, true);

			if (offset + 8 + chunk_size > data.length)
				break;

			if (chunk_size === 0 || chunk_size > 10 * 1024 * 1024) {
				offset++;
				continue;
			}

			if (chunk_id === '00dc' || chunk_id === '00db') {
				const frame = data.slice(offset + 8, offset + 8 + chunk_size);
				if (frame.length > 0)
					frames.push(frame);
			}

			offset += 8 + chunk_size;
			if (chunk_size % 2)
				offset++;

			last_valid_offset = offset;
		}

		const remainder = last_valid_offset < data.length ? data.slice(last_valid_offset) : null;
		return { frames, remainder };
	}

	parse_movi_frames(data, skip_header) {
		const frames = [];
		const view = new DataView(data.buffer, data.byteOffset);
		let offset = 0;

		if (skip_header) {
			const movi_offset = this.find_chunk(data, 'movi');
			if (movi_offset !== -1)
				offset = movi_offset + 4;
		}

		while (offset <= data.length - 8) {
			const chunk_id = String.fromCharCode(
				data[offset], data[offset+1],
				data[offset+2], data[offset+3]
			);
			const chunk_size = view.getUint32(offset + 4, true);

			if (offset + 8 + chunk_size > data.length)
				break;

			if (chunk_size === 0 || chunk_size > 10 * 1024 * 1024) {
				offset++;
				continue;
			}

			if (chunk_id === '00dc' || chunk_id === '00db') {
				const frame = data.slice(offset + 8, offset + 8 + chunk_size);
				if (frame.length > 0)
					frames.push(frame);
			}

			offset += 8 + chunk_size;
			if (chunk_size % 2)
				offset++;
		}

		return frames;
	}
}

export default VP9AVIDemuxer;
