const core = require('../core');
const log = require('../log');
const path = require('path');
const util = require('util');

let isLoading = null;

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
	requestAnimationFrame(updateSeek);
};

/**
 * Play the currently loaded track.
 * Selected track will be loaded if it's not already.
 */
const playSelectedTrack = async () => {
	if (!isTrackLoaded)
		await loadSelectedTrack();

	core.view.soundPlayerState = true;
	audioNode.play();
	updateSeek();
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
	isLoading = true;
	const toast = core.delayToast(200, 'progress', util.format('Loading %s, please wait...', selectedFile), null, -1, false);
	log.write('Previewing sound file %s', selectedFile);

	try {
		data = await core.view.casc.getFileByName(selectedFile);
		audioNode.src = data.getDataURL();

		isTrackLoaded = true;

		toast.cancel();
	} catch (e) {
		toast.cancel();
		core.setToast('error', 'Unable to open file: ' + selectedFile, { 'View Log': () => log.openRuntimeLog() });
		log.write('Failed to open CASC file: %s', e.message);
	}

	isLoading = false;
};

core.events.once('init', () => {
	// Create internal audio node.
	audioNode = document.createElement('audio');
	audioNode.volume = core.view.config.soundPlayerVolume;
	audioNode.ondurationchange = () => core.view.soundPlayerDuration = audioNode.duration;

	console.log(audioNode); // ToDo: Remove.

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
	core.events.on('user-select-sound', async selection => {
		// Store the full selection for exporting purposes.
		userSelection = selection;

		// Check if the first file in the selection is "new".
		const first = selection[0];
		if (!isLoading && first && selectedFile !== first) {
			core.view.soundPlayerTitle = path.basename(first);

			selectedFile = first;
			unloadSelectedTrack();

			if (core.view.config.soundPlayerAutoPlay)
				playSelectedTrack();
		}
	});

	// Track when the user clicks to export selected sound files.
	core.events.on('click-export-sound', async () => {
		if (userSelection.length === 0) {
			core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
			return;
		}

		// ToDo: Export sound files.
		//await exportFiles(userSelection);
	});
});