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
const ExportHelper = require('../casc/export-helper');
const BufferWrapper = require('../buffer');
const audioHelper = require('./audio-helper');
const fsp = require('fs').promises;

const { PLAYBACK_STATE, PlaybackState, AudioSourceManager, AUDIO_TYPE_UNKNOWN, AUDIO_TYPE_OGG, AUDIO_TYPE_MP3, detectFileType } = audioHelper;

let selectedFile = null;
let isTrackLoaded = false;

let audioContext = null;
let audioBuffer = null;
let audioSource = null;
let gainNode = null;
let animationFrameId = null;
let data;

const playback_state = new PlaybackState();
const source_manager = new AudioSourceManager();

/**
 * Update the current status of the sound player seek bar.
 */
const updateSeek = () => {
	if (!audioBuffer || playback_state.state !== PLAYBACK_STATE.PLAYING) {
		animationFrameId = null;
		return;
	}

	const current_position = playback_state.get_current_position(audioBuffer, audioContext, core.view.config.soundPlayerLoop);
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
 * Start playback from current position.
 */
const start_playback = () => {
	if (!isTrackLoaded || !audioBuffer)
		return;

	if (playback_state.state === PLAYBACK_STATE.PLAYING)
		return;

	const start_position = playback_state.position_at_pause;

	source_manager.set_loop(core.view.config.soundPlayerLoop);
	source_manager.create_source(audioBuffer, audioContext, gainNode, () => {
		if (!source_manager.is_loop_enabled && playback_state.state === PLAYBACK_STATE.PLAYING) {
			playback_state.state = PLAYBACK_STATE.LOADED;
			playback_state.position_at_pause = 0;
			stop_animation_loop();
			core.view.soundPlayerState = false;
			core.view.soundPlayerSeek = 0;
		}
	});
	source_manager.start_source(start_position, audioBuffer);

	playback_state.start_playback(start_position, audioContext);
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

	const current_position = playback_state.get_current_position(audioBuffer, audioContext, core.view.config.soundPlayerLoop);
	playback_state.position_at_pause = current_position;
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
		playback_state.seek_to(position_seconds, audioBuffer);

		const start_position = playback_state.pending_seek || playback_state.position_at_pause;
		playback_state.pending_seek = null;

		source_manager.create_source(audioBuffer, audioContext, gainNode, () => {
			if (!source_manager.is_loop_enabled && playback_state.state === PLAYBACK_STATE.PLAYING) {
				playback_state.state = PLAYBACK_STATE.LOADED;
				playback_state.position_at_pause = 0;
				stop_animation_loop();
				core.view.soundPlayerState = false;
				core.view.soundPlayerSeek = 0;
			}
		});
		source_manager.start_source(start_position, audioBuffer);
		playback_state.start_playback(start_position, audioContext);
	} else {
		playback_state.seek_to(position_seconds, audioBuffer);
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
		const raw_data = core.view.mpq.getFile(selectedFile);
		if (!raw_data) {
			log.write('Failed to load audio: %s', selectedFile);
			core.setToast('error', 'Failed to load audio file ' + selectedFile, null, -1);
			core.view.isBusy--;
			return;
		}

		const buffer = Buffer.from(raw_data);
		data = new BufferWrapper(buffer);

		const ext = selectedFile.slice(selectedFile.lastIndexOf('.')).toLowerCase();
		if (ext === '.wav_') {
			core.view.soundPlayerTitle += ' (WAV)';
		} else {
			const fileType = detectFileType(data);
			if (fileType === AUDIO_TYPE_OGG)
				core.view.soundPlayerTitle += ' (OGG)';
			else if (fileType === AUDIO_TYPE_MP3)
				core.view.soundPlayerTitle += ' (MP3)';
		}

		log.write('audio decode: buffer length=%d, byteOffset=%d, byteLength=%d', buffer.byteLength, 0, buffer.byteLength);
		log.write('audio decode: first 16 bytes: %s', data.readHexString(16));
		data.seek(0);

		const array_buffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
		log.write('audio decode: sliced array_buffer length=%d', array_buffer.byteLength);

		audioBuffer = await audioContext.decodeAudioData(array_buffer);
		core.view.soundPlayerDuration = audioBuffer.duration;

		isTrackLoaded = true;
		playback_state.mark_loaded();
		core.hideToast();
	} catch (e) {
		core.setToast('error', 'Unable to preview audio ' + selectedFile, { 'View Log': () => log.openRuntimeLog() }, -1);
		log.write('Failed to load MPQ audio file: %s', e.message);
	}

	core.view.isBusy--;
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

	core.events.on('click-sound-toggle', () => {
		if (core.view.soundPlayerState)
			pauseSelectedTrack();
		else
			playSelectedTrack();
	});

	core.view.$watch('selectionSounds', async selection => {
		if (core.view.screen !== 'legacy-tab-sounds' || selection.length === 0)
			return;

		const first = selection[0];
		if (!core.view.isBusy && first && selectedFile !== first) {
			core.view.soundPlayerTitle = path.basename(first);

			selectedFile = first;
			unloadSelectedTrack();

			if (core.view.config.soundPlayerAutoPlay)
				playSelectedTrack();
		}
	});

	core.events.on('click-export-legacy-sound', async () => {
		const userSelection = core.view.selectionSounds;
		if (userSelection.length === 0) {
			core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
			return;
		}

		const helper = new ExportHelper(userSelection.length, 'sound files');
		helper.start();

		const overwriteFiles = core.view.config.overwriteFiles;
		for (let fileName of userSelection) {
			if (helper.isCancelled())
				return;

			try {
				let exportFileName = fileName;
				const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();

				if (ext === '.wav_') {
					exportFileName = fileName.slice(0, -1);
				} else {
					const raw_data = core.view.mpq.getFile(fileName);
					if (raw_data) {
						const buffer = Buffer.from(raw_data);
						const wrapped = new BufferWrapper(buffer);
						const fileType = detectFileType(wrapped);

						if (fileType === AUDIO_TYPE_OGG)
							exportFileName = ExportHelper.replaceExtension(fileName, '.ogg');
						else if (fileType === AUDIO_TYPE_MP3)
							exportFileName = ExportHelper.replaceExtension(fileName, '.mp3');
					}
				}

				const exportPath = ExportHelper.getExportPath(exportFileName);
				if (overwriteFiles || !await generics.fileExists(exportPath)) {
					const raw_data = core.view.mpq.getFile(fileName);
					if (!raw_data)
						throw new Error('Failed to read file from MPQ');

					await fsp.mkdir(path.dirname(exportPath), { recursive: true });
					await fsp.writeFile(exportPath, new Uint8Array(raw_data));
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

	core.events.on('screen-legacy-tab-sounds', async () => {
		if (core.view.listfileSounds.length === 0 && !core.view.isBusy) {
			core.view.setScreen('loading');
			core.view.isBusy++;

			try {
				const ogg_files = core.view.mpq.getFilesByExtension('.ogg');
				const wav_files = core.view.mpq.getFilesByExtension('.wav');
				const mp3_files = core.view.mpq.getFilesByExtension('.mp3');
				const wav__files = core.view.mpq.getFilesByExtension('.wav_');

				core.view.listfileSounds = [...ogg_files, ...wav_files, ...mp3_files, ...wav__files];
			} catch (e) {
				log.write('failed to load legacy sounds: %o', e);
			}

			core.view.isBusy--;
			core.view.setScreen('legacy-tab-sounds');
		}
	});

	core.events.on('crash', () => {
		unloadSelectedTrack();

		if (audioContext) {
			audioContext.close();
			audioContext = null;
		}
	});
});
