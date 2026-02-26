/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

class AudioPlayer {
	constructor() {
		this.context = null;
		this.gain = null;
		this.buffer = null;
		this.source = null;

		this.is_playing = false;
		this.start_time = 0;
		this.start_offset = 0;

		this.loop = false;
		this.on_ended = null;
	}

	init() {
		if (this.context)
			return;

		this.context = new (window.AudioContext || window.webkitAudioContext)();
		this.gain = this.context.createGain();
		this.gain.connect(this.context.destination);
	}

	async load(array_buffer) {
		this.stop();
		this.buffer = await this.context.decodeAudioData(array_buffer);
		return this.buffer;
	}

	unload() {
		this.stop();
		this.buffer = null;
		this.start_offset = 0;
	}

	play(from_offset) {
		if (!this.buffer)
			return;

		this.stop_source();

		if (from_offset !== undefined)
			this.start_offset = Math.max(0, Math.min(from_offset, this.buffer.duration));

		this.source = this.context.createBufferSource();
		this.source.buffer = this.buffer;
		this.source.loop = this.loop;
		this.source.connect(this.gain);

		this.source.onended = () => {
			// only handle natural completion (not stopped programmatically)
			if (this.is_playing && !this.loop) {
				this.is_playing = false;
				this.start_offset = 0;
				this.source = null;

				if (this.on_ended)
					this.on_ended();
			}
		};

		this.source.start(0, this.start_offset);
		this.start_time = this.context.currentTime;
		this.is_playing = true;
	}

	pause() {
		if (!this.is_playing)
			return;

		this.start_offset = this.get_position();
		this.stop_source();
		this.is_playing = false;
	}

	stop() {
		this.stop_source();
		this.is_playing = false;
		this.start_offset = 0;
	}

	stop_source() {
		if (this.source) {
			try {
				this.source.onended = null;
				this.source.stop();
				this.source.disconnect();
			} catch (e) {
				// ignore errors during cleanup
			}

			this.source = null;
		}
	}

	seek(position) {
		if (!this.buffer)
			return;

		const clamped = Math.max(0, Math.min(position, this.buffer.duration));

		if (this.is_playing)
			this.play(clamped);
		else
			this.start_offset = clamped;
	}

	get_position() {
		if (!this.buffer)
			return 0;

		if (this.is_playing) {
			const elapsed = this.context.currentTime - this.start_time;
			const position = this.start_offset + elapsed;

			if (this.loop)
				return position % this.buffer.duration;

			return Math.min(position, this.buffer.duration);
		}

		return this.start_offset;
	}

	get_duration() {
		return this.buffer?.duration ?? 0;
	}

	set_volume(value) {
		if (this.gain)
			this.gain.gain.value = value;
	}

	set_loop(enabled) {
		this.loop = enabled;

		if (this.source)
			this.source.loop = enabled;
	}

	destroy() {
		this.unload();

		if (this.context) {
			this.context.close();
			this.context = null;
			this.gain = null;
		}
	}
}

const AUDIO_TYPE_UNKNOWN = Symbol('AudioTypeUnk');
const AUDIO_TYPE_OGG = Symbol('AudioTypeOgg');
const AUDIO_TYPE_MP3 = Symbol('AudioTypeMP3');

const detectFileType = (data) => {
	if (data.startsWith('OggS'))
		return AUDIO_TYPE_OGG;
	else if (data.startsWith(['ID3', '\xFF\xFB', '\xFF\xF3', '\xFF\xF2']))
		return AUDIO_TYPE_MP3;

	return AUDIO_TYPE_UNKNOWN;
};

export {
	AudioPlayer,
	AUDIO_TYPE_UNKNOWN,
	AUDIO_TYPE_OGG,
	AUDIO_TYPE_MP3,
	detectFileType
};
