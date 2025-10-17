/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const core = require('../core');
const log = require('../log');
const path = require('path');
const util = require('util');
const generics = require('../generics');
const listfile = require('../casc/listfile');
const ExportHelper = require('../casc/export-helper');
const EncryptionError = require('../casc/blte-reader').EncryptionError;
const WDCReader = require('../db/WDCReader');

const AUDIO_TYPE_UNKNOWN = Symbol('AudioTypeUnk');
const AUDIO_TYPE_OGG = Symbol('AudioTypeOgg');
const AUDIO_TYPE_MP3 = Symbol('AudioTypeMP3');

let selectedFile = null;
let isTrackLoaded = false;
let hasSoundDataLoaded = false;

let audioContext = null;
let audioBuffer = null;
let audioSource = null;
let gainNode = null;
let animationFrameId = null;
let data;

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

	get_current_position() {
		if (!audioBuffer)
			return 0;

		if (this.state === PLAYBACK_STATE.PLAYING) {
			const elapsed = audioContext.currentTime - this.playback_started_at;
			const position = this.position_at_pause + elapsed;

			if (core.view.config.soundPlayerLoop)
				return position % audioBuffer.duration;

			return Math.min(position, audioBuffer.duration);
		}

		return this.position_at_pause;
	}

	start_playback(from_position) {
		this.playback_started_at = audioContext.currentTime;
		this.position_at_pause = from_position;
		this.state = PLAYBACK_STATE.PLAYING;
	}

	pause_playback() {
		if (this.state === PLAYBACK_STATE.PLAYING) {
			this.position_at_pause = this.get_current_position();
			this.state = PLAYBACK_STATE.PAUSED;
		}
	}

	seek_to(position) {
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

const playback_state = new PlaybackState();

class AudioSourceManager {
	constructor() {
		this.source = null;
		this.is_loop_enabled = false;
	}

	create_source() {
		if (!audioBuffer || !audioContext)
			return null;

		this.destroy_source();

		this.source = audioContext.createBufferSource();
		this.source.buffer = audioBuffer;
		this.source.connect(gainNode);
		this.source.loop = this.is_loop_enabled;

		this.source.onended = () => {
			if (!this.is_loop_enabled && playback_state.state === PLAYBACK_STATE.PLAYING) {
				playback_state.state = PLAYBACK_STATE.LOADED;
				playback_state.position_at_pause = 0;
				stop_animation_loop();
				core.view.soundPlayerState = false;
				core.view.soundPlayerSeek = 0;
			}
		};

		return this.source;
	}

	start_source(offset = 0) {
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
				log.write('[AudioSourceManager] destroy_source: error stopping source: %s', e.message);
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

const source_manager = new AudioSourceManager();

/**
 * Update the current status of the sound player seek bar.
 */
const updateSeek = () => {
	if (!audioBuffer || playback_state.state !== PLAYBACK_STATE.PLAYING) {
		animationFrameId = null;
		return;
	}

	const current_position = playback_state.get_current_position();
	core.view.soundPlayerSeek = current_position / audioBuffer.duration;

	animationFrameId = requestAnimationFrame(updateSeek);
};

const start_animation_loop = () => {
	if (animationFrameId === null)
		updateSeek();
};

const stop_animation_loop = () => {
	if (animationFrameId !== null) {
		cancelAnimationFrame(animationFrameId);
		animationFrameId = null;
	}
};

/**
 * Detect the file type of a given audio container.
 * @param {BufferWrapper} data 
 * @returns 
 */
const detectFileType = (data) => {
	if (data.startsWith('OggS')) {
		// File magic matches Ogg container format.
		//selectedFile = ExportHelper.replaceExtension(selectedFile, '.ogg');
		return AUDIO_TYPE_OGG;
	} else if (data.startsWith(['ID3', '\xFF\xFB', '\xFF\xF3', '\xFF\xF2'])) {
		// File magic matches MP3 ID3v2/v1 container format.
		return AUDIO_TYPE_MP3;
	}

	return AUDIO_TYPE_UNKNOWN;
};

/**
 * Start playback from current position.
 */
const start_playback = () => {
	if (!isTrackLoaded || !audioBuffer)
		return;

	if (playback_state.state === PLAYBACK_STATE.PLAYING)
		return;

	const start_position = playback_state.position_at_pause;

	source_manager.set_loop(core.view.config.soundPlayerLoop);
	source_manager.create_source();
	source_manager.start_source(start_position);

	playback_state.start_playback(start_position);
	core.view.soundPlayerState = true;
	start_animation_loop();
};

/**
 * Stop playback completely and reset position.
 */
const stop_playback = () => {
	source_manager.destroy_source();
	playback_state.pause_playback();
	playback_state.position_at_pause = 0;
	stop_animation_loop();
	core.view.soundPlayerState = false;
	core.view.soundPlayerSeek = 0;
};

/**
 * Play the currently loaded track.
 * Selected track will be loaded if it's not already.
 */
const playSelectedTrack = async () => {
	if (!isTrackLoaded)
		await loadSelectedTrack();

	if (isTrackLoaded)
		start_playback();
};

/**
 * Pause the currently playing track.
 */
const pauseSelectedTrack = () => {
	if (playback_state.state !== PLAYBACK_STATE.PLAYING)
		return;

	playback_state.pause_playback();
	source_manager.destroy_source();
	stop_animation_loop();
	core.view.soundPlayerState = false;
};

/**
 * Seek to a specific position in the track.
 */
const seek_to_position = (position_seconds) => {
	if (!isTrackLoaded || !audioBuffer)
		return;

	const was_playing = playback_state.state === PLAYBACK_STATE.PLAYING;

	if (was_playing) {
		source_manager.destroy_source();
		playback_state.seek_to(position_seconds);

		const start_position = playback_state.pending_seek || playback_state.position_at_pause;
		playback_state.pending_seek = null;

		source_manager.create_source();
		source_manager.start_source(start_position);
		playback_state.start_playback(start_position);
	} else {
		playback_state.seek_to(position_seconds);
		core.view.soundPlayerSeek = playback_state.position_at_pause / audioBuffer.duration;
	}
};

/**
 * Unload the currently selected track.
 * Playback will be halted.
 */
const unloadSelectedTrack = () => {
	source_manager.destroy_source();
	stop_animation_loop();

	isTrackLoaded = false;
	core.view.soundPlayerState = false;
	core.view.soundPlayerDuration = 0;
	core.view.soundPlayerSeek = 0;
	audioBuffer = null;
	playback_state.reset();

	data?.revokeDataURL();
};

/**
 * Load the currently selected track.
 * Does not automatically begin playback.
 * Ensure unloadSelectedTrack() is called first.
 */
const loadSelectedTrack = async () => {
	if (selectedFile === null)
		return core.setToast('info', 'You need to select an audio track first!', null, -1, true);

	core.view.isBusy++;
	core.setToast('progress', util.format('Loading %s, please wait...', selectedFile), null, -1, false);
	log.write('Previewing sound file %s', selectedFile);

	try {
		const fileDataID = listfile.getByFilename(selectedFile);
		data = await core.view.casc.getFile(fileDataID);

		if (selectedFile.endsWith('.unk_sound')) {
			const fileType = detectFileType(data);
			if (fileType === AUDIO_TYPE_OGG)
				core.view.soundPlayerTitle += ' (OGG Auto Detected)';
			else if (fileType === AUDIO_TYPE_MP3)
				core.view.soundPlayerTitle += ' (MP3 Auto Detected)';
		}

		// WARNING: these log.write() calls are load-bearing, do not remove
		log.write('audio decode: buffer length=%d, byteOffset=%d, byteLength=%d', data.raw.buffer.byteLength, data.raw.byteOffset, data.raw.byteLength);
		log.write('audio decode: first 16 bytes: %s', data.readHexString(16));
		data.seek(0);

		const array_buffer = data.raw.buffer.slice(data.raw.byteOffset, data.raw.byteOffset + data.raw.byteLength);
		log.write('audio decode: sliced array_buffer length=%d', array_buffer.byteLength);

		audioBuffer = await audioContext.decodeAudioData(array_buffer);
		core.view.soundPlayerDuration = audioBuffer.duration;

		isTrackLoaded = true;
		playback_state.mark_loaded();
		core.hideToast();
	} catch (e) {
		if (e instanceof EncryptionError) {
			// Missing decryption key.
			core.setToast('error', util.format('The audio file %s is encrypted with an unknown key (%s).', selectedFile, e.key), null, -1);
			log.write('Failed to decrypt audio file %s (%s)', selectedFile, e.key);
		} else {
			// Error reading/parsing audio.
			core.setToast('error', 'Unable to preview audio ' + selectedFile, { 'View Log': () => log.openRuntimeLog() }, -1);
			log.write('Failed to open CASC file: %s', e.message);
		}
	}

	core.view.isBusy--;
};

/**
 * Load sound data from SoundKitEntry table.
 */
const loadSoundData = async () => {
	if (!hasSoundDataLoaded && !core.view.isBusy && core.view.config.enableUnknownFiles) {
		// Show a loading screen
		const progress = core.createProgress(2);
		core.view.setScreen('loading');
		core.view.isBusy++;

		try {
			// Load unknown sounds from SoundKitEntry table
			await progress.step('Loading sound entries...');
			const soundKitEntries = new WDCReader('DBFilesClient/SoundKitEntry.db2');
			await soundKitEntries.parse();

			await progress.step('Processing unknown sound files...');
			
			let unknownCount = 0;
			for (const entry of soundKitEntries.getAllRows().values()) {
				if (!listfile.existsByID(entry.FileDataID)) {
					// List unknown sound files using the .unk_sound extension. Files will be
					// dynamically checked upon export and given the correct extension.
					const fileName = 'unknown/' + entry.FileDataID + '.unk_sound';
					listfile.addEntry(entry.FileDataID, fileName, core.view.listfileSounds);
					unknownCount++;
				}
			}

			log.write('Added %d unknown sound files from SoundKitEntry to listfile', unknownCount);
			hasSoundDataLoaded = true;
		} catch (e) {
			log.write('Failed to load sound data: %s', e.message);
			core.setToast('error', 'Failed to load sound data', { 'View Log': () => log.openRuntimeLog() }, -1);
		}

		// Hide the loading screen
		core.view.loadPct = -1;
		core.view.isBusy--;
		core.view.setScreen('tab-sounds');
	}
};

core.registerLoadFunc(async () => {
	audioContext = new (window.AudioContext || window.webkitAudioContext)();
	gainNode = audioContext.createGain();
	gainNode.connect(audioContext.destination);
	gainNode.gain.value = core.view.config.soundPlayerVolume;

	core.view.$watch('config.soundPlayerVolume', value => {
		gainNode.gain.value = value;
	});

	core.view.$watch('config.soundPlayerLoop', value => {
		source_manager.set_loop(value);
	});

	core.events.on('click-sound-seek', seek => {
		if (audioBuffer && isTrackLoaded) {
			const position_seconds = audioBuffer.duration * seek;
			seek_to_position(position_seconds);
		}
	});

	// Track sound-player-toggle events.
	core.events.on('click-sound-toggle', () => {
		if (core.view.soundPlayerState)
			pauseSelectedTrack();
		else
			playSelectedTrack();
	});

	// Track selection changes on the sound listbox and set first as active entry.
	core.view.$watch('selectionSounds', async selection => {
		// Check if the first file in the selection is "new".
		const first = listfile.stripFileEntry(selection[0]);
		if (!core.view.isBusy && first && selectedFile !== first) {
			core.view.soundPlayerTitle = path.basename(first);

			selectedFile = first;
			unloadSelectedTrack();

			if (core.view.config.soundPlayerAutoPlay)
				playSelectedTrack();
		}
	});

	// Track when the user clicks to export selected sound files.
	core.events.on('click-export-sound', async () => {
		const userSelection = core.view.selectionSounds;
		if (userSelection.length === 0) {
			core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
			return;
		}

		const helper = new ExportHelper(userSelection.length, 'sound files');
		helper.start();
		
		const overwriteFiles = core.view.config.overwriteFiles;
		for (let fileName of userSelection) {
			// Abort if the export has been cancelled.
			if (helper.isCancelled())
				return;

			let data;
			fileName = listfile.stripFileEntry(fileName);

			if (fileName.endsWith('.unk_sound')) {
				data = await core.view.casc.getFileByName(fileName);
				const fileType = detectFileType(data);

				if (fileType === AUDIO_TYPE_OGG)
					fileName = ExportHelper.replaceExtension(fileName, '.ogg');
				else if (fileType === AUDIO_TYPE_MP3)
					fileName = ExportHelper.replaceExtension(fileName, '.mp3');
			}
			
			let exportFileName = fileName;
			
			if (!core.view.config.exportNamedFiles) {
				const fileDataID = listfile.getByFilename(fileName);
				if (fileDataID) {
					const ext = path.extname(fileName);
					const dir = path.dirname(fileName);
					const fileDataIDName = fileDataID + ext;
					exportFileName = dir === '.' ? fileDataIDName : path.join(dir, fileDataIDName);
				}
			}
				
			try {
				const exportPath = ExportHelper.getExportPath(exportFileName);
				if (overwriteFiles || !await generics.fileExists(exportPath)) {
					if (!data)
						data = await core.view.casc.getFileByName(fileName);

					await data.writeToFile(exportPath);
				} else {
					log.write('Skipping audio export %s (file exists, overwrite disabled)', exportPath);
				}

				helper.mark(fileName, true);
			} catch (e) {
				helper.mark(fileName, false, e.message, e.stack);
			}
		}

		helper.finish();
	});

	// Track when the "Audio" tab is opened.
	core.events.on('screen-tab-sounds', async () => {
		await loadSoundData();
	});

	core.events.on('crash', () => {
		unloadSelectedTrack();

		if (audioContext) {
			audioContext.close();
			audioContext = null;
		}
	});
});