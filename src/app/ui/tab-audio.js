/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
const core = require('../core');
const log = require('../log');
const path = require('path');
const util = require('util');
const generics = require('../generics');
const listfile = require('../casc/listfile');
const ExportHelper = require('../casc/export-helper');
const EncryptionError = require('../casc/blte-reader').EncryptionError;

const AUDIO_TYPE_UNKNOWN = Symbol('AudioTypeUnk');
const AUDIO_TYPE_OGG = Symbol('AudioTypeOgg');
const AUDIO_TYPE_MP3 = Symbol('AudioTypeMP3');

let selectedFile = null;
let isTrackLoaded = false;

let audioNode = null;
let data;

/**
 * Update the current status of the sound player seek bar.
 */
const updateSeek = () => {
	if (!core.view.soundPlayerState || !audioNode)
		return;

	core.view.soundPlayerSeek = audioNode.currentTime / audioNode.duration;

	if (core.view.soundPlayerSeek === 1) {
		if (core.view.config.soundPlayerLoop)
			audioNode.play();
		else
			core.view.soundPlayerState = false;
	}

	requestAnimationFrame(updateSeek);
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
 * Play the currently loaded track.
 * Selected track will be loaded if it's not already.
 */
const playSelectedTrack = async () => {
	if (!isTrackLoaded)
		await loadSelectedTrack();

	// Ensure the track actually loaded.
	if (isTrackLoaded) {
		core.view.soundPlayerState = true;
		audioNode.play();
		updateSeek();
	}
};

/**
 * Pause the currently playing track.
 */
const pauseSelectedTrack = () => {
	core.view.soundPlayerState = false;
	audioNode.pause();
};

/**
 * Unload the currently selected track.
 * Playback will be halted.
 */
const unloadSelectedTrack = () => {
	isTrackLoaded = false;
	core.view.soundPlayerState = false;
	core.view.soundPlayerDuration = 0;
	core.view.soundPlayerSeek = 0;
	audioNode.src = '';

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

		audioNode.src = data.getDataURL();

		await new Promise(res => {
			audioNode.onloadeddata = res;
			audioNode.onerror = res;
		});

		if (isNaN(audioNode.duration))
			throw new Error('Invalid audio duration.');

		isTrackLoaded = true;
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

core.registerLoadFunc(async () => {
	// Create internal audio node.
	audioNode = document.createElement('audio');
	audioNode.volume = core.view.config.soundPlayerVolume;
	audioNode.ondurationchange = () => core.view.soundPlayerDuration = audioNode.duration;

	// Track changes to config.soundPlayerVolume and adjust our gain node.
	core.view.$watch('config.soundPlayerVolume', value => {
		audioNode.volume = value;
	});

	// Track requests to seek the current sound file and directly edit the
	// time of the audio node. core.view.soundPlayerSeek will automatically update.
	core.events.on('click-sound-seek', seek => {
		if (audioNode && isTrackLoaded)
			audioNode.currentTime = audioNode.duration * seek;
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

			try {
				const exportPath = ExportHelper.getExportPath(fileName);
				if (overwriteFiles || !await generics.fileExists(exportPath)) {
					if (!data)
						data = await core.view.casc.getFileByName(fileName);

					await data.writeToFile(exportPath);
				} else {
					log.write('Skipping audio export %s (file exists, overwrite disabled)', exportPath);
				}

				helper.mark(fileName, true);
			} catch (e) {
				helper.mark(fileName, false, e.message);
			}
		}

		helper.finish();
	});

	// If the application crashes, we need to make sure to stop playing sound.
	core.events.on('crash', () => {
		if (audioNode)
			audioNode.remove();

		unloadSelectedTrack();
	});
});