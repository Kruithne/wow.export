const FRAMES_PER_SECOND = 24;

const SUBTITLE_FORMAT = {
	SRT: 118,
	SBT: 7
};

const parse_sbt_timestamp = (timestamp) => {
	const parts = timestamp.split(':');
	if (parts.length !== 4)
		return 0;

	const hours = parseInt(parts[0], 10);
	const minutes = parseInt(parts[1], 10);
	const seconds = parseInt(parts[2], 10);
	const frames = parseInt(parts[3], 10);

	const total_ms = (hours * 3600 + minutes * 60 + seconds) * 1000;
	const frame_ms = Math.round((frames / FRAMES_PER_SECOND) * 1000);

	return total_ms + frame_ms;
};

const format_srt_timestamp = (ms) => {
	const hours = Math.floor(ms / 3600000);
	ms %= 3600000;

	const minutes = Math.floor(ms / 60000);
	ms %= 60000;

	const seconds = Math.floor(ms / 1000);
	const millis = ms % 1000;

	const pad2 = (n) => n.toString().padStart(2, '0');
	const pad3 = (n) => n.toString().padStart(3, '0');

	return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)},${pad3(millis)}`;
};

const format_vtt_timestamp = (ms) => {
	const hours = Math.floor(ms / 3600000);
	ms %= 3600000;

	const minutes = Math.floor(ms / 60000);
	ms %= 60000;

	const seconds = Math.floor(ms / 1000);
	const millis = ms % 1000;

	const pad2 = (n) => n.toString().padStart(2, '0');
	const pad3 = (n) => n.toString().padStart(3, '0');

	return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.${pad3(millis)}`;
};

const parse_srt_timestamp = (timestamp) => {
	const match = timestamp.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
	if (!match)
		return 0;

	const hours = parseInt(match[1], 10);
	const minutes = parseInt(match[2], 10);
	const seconds = parseInt(match[3], 10);
	const millis = parseInt(match[4], 10);

	return (hours * 3600 + minutes * 60 + seconds) * 1000 + millis;
};

const sbt_to_srt = (sbt) => {
	const lines = sbt.split(/\r?\n/);
	const entries = [];

	let current_entry = null;

	for (const line of lines) {
		const trimmed = line.trim();

		if (trimmed.length === 0) {
			if (current_entry !== null && current_entry.text.length > 0) {
				entries.push(current_entry);
				current_entry = null;
			}
			continue;
		}

		// timestamp line: 00:00:14:12 - 00:00:17:08
		const timestamp_match = trimmed.match(/^(\d{2}:\d{2}:\d{2}:\d{2})\s*-\s*(\d{2}:\d{2}:\d{2}:\d{2})/);
		if (timestamp_match) {
			if (current_entry !== null && current_entry.text.length > 0)
				entries.push(current_entry);

			current_entry = {
				start: parse_sbt_timestamp(timestamp_match[1]),
				end: parse_sbt_timestamp(timestamp_match[2]),
				text: []
			};
			continue;
		}

		if (current_entry !== null)
			current_entry.text.push(trimmed);
	}

	if (current_entry !== null && current_entry.text.length > 0)
		entries.push(current_entry);

	const srt_lines = [];
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		srt_lines.push((i + 1).toString());
		srt_lines.push(`${format_srt_timestamp(entry.start)} --> ${format_srt_timestamp(entry.end)}`);
		srt_lines.push(...entry.text);
		srt_lines.push('');
	}

	return srt_lines.join('\n');
};

const srt_to_vtt = (srt) => {
	const lines = srt.split(/\r?\n/);
	const entries = [];

	let current_entry = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();

		if (trimmed.length === 0) {
			if (current_entry !== null && current_entry.text.length > 0) {
				entries.push(current_entry);
				current_entry = null;
			}
			continue;
		}

		// skip sequence numbers
		if (/^\d+$/.test(trimmed) && current_entry === null)
			continue;

		// timestamp line: 00:00:02,433 --> 00:00:06,067
		const timestamp_match = trimmed.match(/^(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
		if (timestamp_match) {
			if (current_entry !== null && current_entry.text.length > 0)
				entries.push(current_entry);

			current_entry = {
				start: parse_srt_timestamp(timestamp_match[1]),
				end: parse_srt_timestamp(timestamp_match[2]),
				text: []
			};
			continue;
		}

		if (current_entry !== null)
			current_entry.text.push(trimmed);
	}

	if (current_entry !== null && current_entry.text.length > 0)
		entries.push(current_entry);

	const vtt_lines = ['WEBVTT', ''];
	for (const entry of entries) {
		vtt_lines.push(`${format_vtt_timestamp(entry.start)} --> ${format_vtt_timestamp(entry.end)}`);
		vtt_lines.push(...entry.text);
		vtt_lines.push('');
	}

	return vtt_lines.join('\n');
};

const get_subtitles_vtt = async (casc, file_data_id, format) => {
	const data = await casc.getFile(file_data_id);
	let text = data.readString(undefined, 'utf8');

	// strip BOM if present
	if (text.charCodeAt(0) === 0xFEFF)
		text = text.slice(1);

	let srt;
	if (format === SUBTITLE_FORMAT.SBT)
		srt = sbt_to_srt(text);
	else
		srt = text;

	return srt_to_vtt(srt);
};

export {
	SUBTITLE_FORMAT,
	get_subtitles_vtt
};
