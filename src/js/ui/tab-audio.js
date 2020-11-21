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
const EncryptionError = require('../casc/blte-reader').EncryptionError;

let selectedFile = null;
let isTrackLoaded = false;

let audioNode = null;
let data = null;

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

	// Free assigned data URL.
	if (data)
		data.revokeDataURL();
};

/**
 * Load the currently selected track.
 * Does not automatically begin playback.
 * Ensure unloadSelectedTrack() is called first.
 */
const loadSelectedTrack = async () => {
	core.view.isBusy++;
	core.setToast('progress', util.format('Loading %s, please wait...', selectedFile), null, -1, false);
	log.write('Previewing sound file %s', selectedFile);

	try {
		data = await core.view.casc.getFileByName(selectedFile);
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
			core.setToast('error', util.format('The audio file %s is encrypted with an unknown key (%s).', selectedFile, e.key));
			log.write('Failed to decrypt audio file %s (%s)', selectedFile, e.key);
		} else {
			// Error reading/parsing audio.
			core.setToast('error', 'Unable to preview audio ' + selectedFile, { 'View Log': () => log.openRuntimeLog() });
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
		const first = selection[0];
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
		for (const fileName of userSelection) {
			// Abort if the export has been cancelled.
			if (helper.isCancelled())
				return;
				
			try {
				const exportPath = ExportHelper.getExportPath(fileName);

				if (overwriteFiles || !await generics.fileExists(exportPath)) {
					const data = await core.view.casc.getFileByName(fileName);
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