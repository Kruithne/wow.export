/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import path from 'node:path';
import util from 'node:util';

import { state } from '../core';
import Events from '../events';
import Log from '../log';
import Listfile from '../casc/listfile';
import ExportHelper from '../casc/export-helper';
import BufferWrapper from '../buffer';

import { fileExists } from '../generics';
import { EncryptionError } from '../casc/blte-reader';

const AUDIO_TYPE_UNKNOWN = Symbol('AudioTypeUnk');
const AUDIO_TYPE_OGG = Symbol('AudioTypeOgg');
const AUDIO_TYPE_MP3 = Symbol('AudioTypeMP3');

type AudioType = typeof AUDIO_TYPE_UNKNOWN | typeof AUDIO_TYPE_OGG | typeof AUDIO_TYPE_MP3;

let selectedFile: string;
let isTrackLoaded = false;

let audioNode: HTMLAudioElement;
let data: BufferWrapper;

/** Update the current status of the sound player seek bar. */
function updateSeek(): void {
	if (!state.soundPlayerState || !audioNode)
		return;

	state.soundPlayerSeek = audioNode.currentTime / audioNode.duration;

	if (state.soundPlayerSeek === 1) {
		if (state.config.soundPlayerLoop)
			audioNode.play();

		else
			state.soundPlayerState = false;
	}

	requestAnimationFrame(updateSeek);
}

/**
 * Detect the file type of a given audio container.
 * @param data
 * @returns
 */
function detectFileType(data: BufferWrapper): AudioType {
	if (data.startsWith('OggS')) {
		// File magic matches Ogg container format.
		//selectedFile = ExportHelper.replaceExtension(selectedFile, '.ogg');
		return AUDIO_TYPE_OGG;
	} else if (data.startsWith('ID3') || data.startsWith('\xFF\xFB') || data.startsWith('\xFF\xF3') || data.startsWith('\xFF\xF2')) {
		// File magic matches MP3 ID3v2/v1 container format.
		return AUDIO_TYPE_MP3;
	}

	return AUDIO_TYPE_UNKNOWN;
}

/**
 * Play the currently loaded track.
 * Selected track will be loaded if it's not already.
 */
async function playSelectedTrack(): Promise<void> {
	if (!isTrackLoaded)
		await loadSelectedTrack();

	// Ensure the track actually loaded.
	if (isTrackLoaded) {
		state.soundPlayerState = true;
		audioNode.play();
		updateSeek();
	}
}

/**
 * Pause the currently playing track.
 */
function pauseSelectedTrack(): void {
	state.soundPlayerState = false;
	audioNode.pause();
}

/**
 * Unload the currently selected track.
 * Playback will be halted.
 */
function unloadSelectedTrack(): void {
	isTrackLoaded = false;
	state.soundPlayerState = false;
	state.soundPlayerDuration = 0;
	state.soundPlayerSeek = 0;
	audioNode.src = '';

	data?.revokeDataURL();
}

/**
 * Load the currently selected track.
 * Does not automatically begin playback.
 * Ensure unloadSelectedTrack() is called first.
 */
async function loadSelectedTrack(): Promise<void> {
	if (selectedFile === undefined)
		return state.setToast('info', 'You need to select an audio track first!', null, -1, true);

	state.isBusy++;
	state.setToast('progress', util.format('Loading %s, please wait...', selectedFile), null, -1, false);
	Log.write('Previewing sound file %s', selectedFile);

	try {
		const fileDataID = Listfile.getByFilename(selectedFile);
		data = await state.casc.getFile(fileDataID);

		if (selectedFile.endsWith('.unk_sound')) {
			const fileType = detectFileType(data);
			if (fileType === AUDIO_TYPE_OGG)
				state.soundPlayerTitle += ' (OGG Auto Detected)';
			else if (fileType === AUDIO_TYPE_MP3)
				state.soundPlayerTitle += ' (MP3 Auto Detected)';
		}

		audioNode.src = data.getDataURL();

		await new Promise(res => {
			audioNode.onloadeddata = res;
			audioNode.onerror = res;
		});

		if (isNaN(audioNode.duration))
			throw new Error('Invalid audio duration.');

		isTrackLoaded = true;
		state.hideToast();
	} catch (e) {
		if (e instanceof EncryptionError) {
			// Missing decryption key.
			state.setToast('error', util.format('The audio file %s is encrypted with an unknown key (%s).', selectedFile, e.key), null, -1);
			Log.write('Failed to decrypt audio file %s (%s)', selectedFile, e.key);
		} else {
			// Error reading/parsing audio.
			state.setToast('error', 'Unable to preview audio ' + selectedFile, { 'View Log': () => Log.openRuntimeLog() }, -1);
			Log.write('Failed to open CASC file: %s', e.message);
		}
	}

	state.isBusy--;
}

Events.once('casc:initialized', (): void => {
	// Create internal audio node.
	audioNode = document.createElement('audio');
	audioNode.volume = state.config.soundPlayerVolume;
	audioNode.ondurationchange = (): number => state.soundPlayerDuration = audioNode.duration;

	// Track changes to config.soundPlayerVolume and adjust our gain node.
	state.$watch('config.soundPlayerVolume', (value: number) => {
		audioNode.volume = value;
	});

	// Track requests to seek the current sound file and directly edit the
	// time of the audio node. state.soundPlayerSeek will automatically update.
	Events.on('click-sound-seek', seek => {
		if (audioNode && isTrackLoaded)
			audioNode.currentTime = audioNode.duration * seek;
	});

	// Track sound-player-toggle events.
	Events.on('click-sound-toggle', () => {
		if (state.soundPlayerState)
			pauseSelectedTrack();
		else
			playSelectedTrack();
	});

	// Track selection changes on the sound listbox and set first as active entry.
	state.$watch('selectionSounds', (selection: string[]) => {
		// Check if the first file in the selection is "new".
		const first = Listfile.stripFileEntry(selection[0]);
		if (!state.isBusy && first && selectedFile !== first) {
			state.soundPlayerTitle = path.basename(first);

			selectedFile = first;
			unloadSelectedTrack();

			if (state.config.soundPlayerAutoPlay)
				playSelectedTrack();
		}
	}, { deep: true });

	// Track when the user clicks to export selected sound files.
	Events.on('click-export-sound', async () => {
		const userSelection = state.selectionSounds;
		if (userSelection.length === 0) {
			state.setToast('info', 'You didn\'t select any files to export; you should do that first.');
			return;
		}

		const helper = new ExportHelper(userSelection.length, 'sound files');
		helper.start();

		const overwriteFiles = state.config.overwriteFiles;
		for (let fileName of userSelection) {
			// Abort if the export has been cancelled.
			if (helper.isCancelled())
				return;

			let data;
			fileName = Listfile.stripFileEntry(fileName);

			if (fileName.endsWith('.unk_sound')) {
				data = await state.casc.getFileByName(fileName);
				const fileType = detectFileType(data);

				if (fileType === AUDIO_TYPE_OGG)
					fileName = ExportHelper.replaceExtension(fileName, '.ogg');
				else if (fileType === AUDIO_TYPE_MP3)
					fileName = ExportHelper.replaceExtension(fileName, '.mp3');
			}

			try {
				const exportPath = ExportHelper.getExportPath(fileName);
				if (overwriteFiles || !await fileExists(exportPath)) {
					if (!data)
						data = await state.casc.getFileByName(fileName);

					await data.writeToFile(exportPath);
				} else {
					Log.write('Skipping audio export %s (file exists, overwrite disabled)', exportPath);
				}

				helper.mark(fileName, true);
			} catch (e) {
				helper.mark(fileName, false, e.message);
			}
		}

		helper.finish();
	});

	// If the application crashes, we need to make sure to stop playing sound.
	Events.on('application-crash', () => {
		if (audioNode)
			audioNode.remove();

		unloadSelectedTrack();
	});
});