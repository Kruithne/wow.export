/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/

const PLAYBACK_STATE = {
	UNLOADED: 'UNLOADED',
	LOADING: 'LOADING',
	LOADED: 'LOADED',
	PLAYING: 'PLAYING',
	PAUSED: 'PAUSED',
	SEEKING: 'SEEKING'
};

class PlaybackState {
	constructor() {
		this.state = PLAYBACK_STATE.UNLOADED;
		this.playback_started_at = 0;
		this.position_at_pause = 0;
		this.pending_seek = null;
	}

	get_current_position(audioBuffer, audioContext, loopEnabled) {
		if (!audioBuffer)
			return 0;

		if (this.state === PLAYBACK_STATE.PLAYING) {
			const elapsed = audioContext.currentTime - this.playback_started_at;
			const position = this.position_at_pause + elapsed;

			if (loopEnabled)
				return position % audioBuffer.duration;

			return Math.min(position, audioBuffer.duration);
		}

		return this.position_at_pause;
	}

	start_playback(from_position, audioContext) {
		this.playback_started_at = audioContext.currentTime;
		this.position_at_pause = from_position;
		this.state = PLAYBACK_STATE.PLAYING;
	}

	pause_playback() {
		if (this.state === PLAYBACK_STATE.PLAYING)
			this.state = PLAYBACK_STATE.PAUSED;
	}

	seek_to(position, audioBuffer) {
		if (!audioBuffer)
			return;

		this.position_at_pause = Math.max(0, Math.min(position, audioBuffer.duration));

		if (this.state === PLAYBACK_STATE.PLAYING) {
			this.pending_seek = this.position_at_pause;
			this.state = PLAYBACK_STATE.SEEKING;
		}
	}

	reset() {
		this.state = PLAYBACK_STATE.UNLOADED;
		this.playback_started_at = 0;
		this.position_at_pause = 0;
		this.pending_seek = null;
	}

	mark_loaded() {
		this.state = PLAYBACK_STATE.LOADED;
		this.position_at_pause = 0;
	}
}

class AudioSourceManager {
	constructor() {
		this.source = null;
		this.is_loop_enabled = false;
	}

	create_source(audioBuffer, audioContext, gainNode, onEndedCallback) {
		if (!audioBuffer || !audioContext)
			return null;

		this.destroy_source();

		this.source = audioContext.createBufferSource();
		this.source.buffer = audioBuffer;
		this.source.connect(gainNode);
		this.source.loop = this.is_loop_enabled;

		this.source.onended = onEndedCallback;

		return this.source;
	}

	start_source(offset, audioBuffer) {
		if (this.source) {
			const clamped_offset = Math.max(0, Math.min(offset, audioBuffer.duration));
			this.source.start(0, clamped_offset);
		}
	}

	destroy_source() {
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

	set_loop(enabled) {
		this.is_loop_enabled = enabled;

		if (this.source)
			this.source.loop = enabled;
	}

	is_active() {
		return this.source !== null;
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

module.exports = {
	PLAYBACK_STATE,
	PlaybackState,
	AudioSourceManager,
	AUDIO_TYPE_UNKNOWN,
	AUDIO_TYPE_OGG,
	AUDIO_TYPE_MP3,
	detectFileType
};
