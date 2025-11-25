const path = require('path');
const util = require('util');
const log = require('../log');
const generics = require('../generics');
const listfile = require('../casc/listfile');
const ExportHelper = require('../casc/export-helper');
const EncryptionError = require('../casc/blte-reader').EncryptionError;
const db2 = require('../casc/db2');
const audioHelper = require('../ui/audio-helper');
const InstallType = require('../install-type');

const { AudioPlayer, AUDIO_TYPE_OGG, AUDIO_TYPE_MP3, detectFileType } = audioHelper;

let selected_file = null;
let has_sound_data_loaded = false;
let animation_frame_id = null;
let file_data = null;

const player = new AudioPlayer();

const update_seek = (core) => {
	if (!player.is_playing) {
		animation_frame_id = null;
		return;
	}

	const duration = player.get_duration();
	if (duration > 0)
		core.view.soundPlayerSeek = player.get_position() / duration;

	animation_frame_id = requestAnimationFrame(() => update_seek(core));
};

const start_seek_loop = (core) => {
	if (animation_frame_id === null)
		update_seek(core);
};

const stop_seek_loop = () => {
	if (animation_frame_id !== null) {
		cancelAnimationFrame(animation_frame_id);
		animation_frame_id = null;
	}
};

const load_track = async (core) => {
	if (selected_file === null)
		return false;

	using _lock = core.create_busy_lock();
	core.setToast('progress', util.format('Loading %s, please wait...', selected_file), null, -1, false);
	log.write('Previewing sound file %s', selected_file);

	try {
		const file_data_id = listfile.getByFilename(selected_file);
		file_data = await core.view.casc.getFile(file_data_id);

		if (selected_file.endsWith('.unk_sound')) {
			const file_type = detectFileType(file_data);
			if (file_type === AUDIO_TYPE_OGG)
				core.view.soundPlayerTitle += ' (OGG Auto Detected)';
			else if (file_type === AUDIO_TYPE_MP3)
				core.view.soundPlayerTitle += ' (MP3 Auto Detected)';
		}

		log.write('audio decode: buffer length=%d, byteOffset=%d, byteLength=%d', file_data.raw.buffer.byteLength, file_data.raw.byteOffset, file_data.raw.byteLength);
		log.write('audio decode: first 16 bytes: %s', file_data.readHexString(16));
		file_data.seek(0);

		const array_buffer = file_data.raw.buffer.slice(file_data.raw.byteOffset, file_data.raw.byteOffset + file_data.raw.byteLength);
		log.write('audio decode: sliced array_buffer length=%d', array_buffer.byteLength);

		await player.load(array_buffer);
		core.view.soundPlayerDuration = player.get_duration();
		core.hideToast();
		return true;
	} catch (e) {
		if (e instanceof EncryptionError) {
			core.setToast('error', util.format('The audio file %s is encrypted with an unknown key (%s).', selected_file, e.key), null, -1);
			log.write('Failed to decrypt audio file %s (%s)', selected_file, e.key);
		} else {
			core.setToast('error', 'Unable to preview audio ' + selected_file, { 'View Log': () => log.openRuntimeLog() }, -1);
			log.write('Failed to open CASC file: %s', e.message);
		}

		return false;
	}
};

const unload_track = (core) => {
	stop_seek_loop();
	player.unload();

	core.view.soundPlayerState = false;
	core.view.soundPlayerDuration = 0;
	core.view.soundPlayerSeek = 0;

	file_data?.revokeDataURL();
	file_data = null;
};

const play_track = async (core) => {
	if (!player.buffer) {
		if (selected_file === null) {
			core.setToast('info', 'You need to select an audio track first!', null, -1, true);
			return;
		}

		const loaded = await load_track(core);
		if (!loaded)
			return;
	}

	player.play();
	core.view.soundPlayerState = true;
	start_seek_loop(core);
};

const pause_track = (core) => {
	player.pause();
	stop_seek_loop();
	core.view.soundPlayerState = false;
};

const load_sound_data = async (core) => {
	if (!has_sound_data_loaded && !core.view.isBusy && core.view.config.enableUnknownFiles) {
		core.showLoadingScreen(1);

		try {
			await core.progressLoadingScreen('Processing unknown sound files...');

			let unknown_count = 0;
			for (const entry of (await db2.SoundKitEntry.getAllRows()).values()) {
				if (!listfile.existsByID(entry.FileDataID)) {
					const file_name = 'unknown/' + entry.FileDataID + '.unk_sound';
					listfile.addEntry(entry.FileDataID, file_name, core.view.listfileSounds);
					unknown_count++;
				}
			}

			log.write('Added %d unknown sound files from SoundKitEntry to listfile', unknown_count);
			has_sound_data_loaded = true;
		} catch (e) {
			log.write('Failed to load sound data: %s', e.message);
			core.setToast('error', 'Failed to load sound data', { 'View Log': () => log.openRuntimeLog() }, -1);
		}

		core.hideLoadingScreen();
	}
};

const export_sounds = async (core) => {
	const user_selection = core.view.selectionSounds;
	if (user_selection.length === 0) {
		core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
		return;
	}

	const helper = new ExportHelper(user_selection.length, 'sound files');
	helper.start();

	const overwrite_files = core.view.config.overwriteFiles;
	for (let file_name of user_selection) {
		if (helper.isCancelled())
			return;

		let export_data;
		file_name = listfile.stripFileEntry(file_name);

		if (file_name.endsWith('.unk_sound')) {
			export_data = await core.view.casc.getFileByName(file_name);
			const file_type = detectFileType(export_data);

			if (file_type === AUDIO_TYPE_OGG)
				file_name = ExportHelper.replaceExtension(file_name, '.ogg');
			else if (file_type === AUDIO_TYPE_MP3)
				file_name = ExportHelper.replaceExtension(file_name, '.mp3');
		}

		let export_file_name = file_name;

		if (!core.view.config.exportNamedFiles) {
			const file_data_id = listfile.getByFilename(file_name);
			if (file_data_id) {
				const ext = path.extname(file_name);
				const dir = path.dirname(file_name);
				const file_data_id_name = file_data_id + ext;
				export_file_name = dir === '.' ? file_data_id_name : path.join(dir, file_data_id_name);
			}
		}

		try {
			const export_path = ExportHelper.getExportPath(export_file_name);
			if (overwrite_files || !await generics.fileExists(export_path)) {
				if (!export_data)
					export_data = await core.view.casc.getFileByName(file_name);

				await export_data.writeToFile(export_path);
			} else {
				log.write('Skipping audio export %s (file exists, overwrite disabled)', export_path);
			}

			helper.mark(file_name, true);
		} catch (e) {
			helper.mark(file_name, false, e.message, e.stack);
		}
	}

	helper.finish();
};

module.exports = {
	register() {
		this.registerNavButton('Audio', 'music.svg', InstallType.CASC);
	},

	template: `
		<div class="tab list-tab" id="tab-sounds">
			<div class="list-container">
				<listbox v-model:selection="$core.view.selectionSounds" :items="$core.view.listfileSounds" :filter="$core.view.userInputFilterSounds" :keyinput="true" :regex="$core.view.config.regexFilters" :copymode="$core.view.config.copyMode" :pasteselection="$core.view.config.pasteSelection" :copytrimwhitespace="$core.view.config.removePathSpacesCopy" :includefilecount="true" unittype="sound file" persistscrollkey="sounds"></listbox>
			</div>
			<div class="filter">
				<div class="regex-info" v-if="$core.view.config.regexFilters" :title="$core.view.regexTooltip">Regex Enabled</div>
				<input type="text" v-model="$core.view.userInputFilterSounds" placeholder="Filter sound files..."/>
			</div>
			<div id="sound-player">
				<div id="sound-player-anim" :style="{ 'animation-play-state': $core.view.soundPlayerState ? 'running' : 'paused' }"></div>
				<div id="sound-player-controls">
					<div id="sound-player-info">
						<span>{{ $core.view.soundPlayerSeekFormatted }}</span>
						<span class="title">{{ $core.view.soundPlayerTitle }}</span>
						<span>{{ $core.view.soundPlayerDurationFormatted }}</span>
					</div>
					<slider id="slider-seek" v-model="$core.view.soundPlayerSeek" @update:model-value="handle_seek"></slider>
					<div class="buttons">
						<input type="button" :class="{ isPlaying: !$core.view.soundPlayerState }" @click="toggle_playback"/>
						<slider id="slider-volume" v-model="$core.view.config.soundPlayerVolume"></slider>
					</div>
				</div>
			</div>
			<div class="preview-controls">
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.config.soundPlayerLoop"/>
					<span>Loop</span>
				</label>
				<label class="ui-checkbox">
					<input type="checkbox" v-model="$core.view.config.soundPlayerAutoPlay"/>
					<span>Autoplay</span>
				</label>
				<input type="button" value="Export Selected" @click="export_selected" :class="{ disabled: $core.view.isBusy }"/>
			</div>
		</div>
	`,

	methods: {
		toggle_playback() {
			if (this.$core.view.soundPlayerState)
				pause_track(this.$core);
			else
				play_track(this.$core);
		},

		handle_seek(seek) {
			const duration = player.get_duration();
			if (duration > 0)
				player.seek(duration * seek);
		},

		async export_selected() {
			await export_sounds(this.$core);
		}
	},

	async mounted() {
		player.init();
		player.set_volume(this.$core.view.config.soundPlayerVolume);
		player.set_loop(this.$core.view.config.soundPlayerLoop);

		player.on_ended = () => {
			stop_seek_loop();
			this.$core.view.soundPlayerState = false;
			this.$core.view.soundPlayerSeek = 0;
		};

		this.$core.view.$watch('config.soundPlayerVolume', value => {
			player.set_volume(value);
		});

		this.$core.view.$watch('config.soundPlayerLoop', value => {
			player.set_loop(value);
		});

		this.$core.view.$watch('selectionSounds', async selection => {
			const first = listfile.stripFileEntry(selection[0]);
			if (!this.$core.view.isBusy && first && selected_file !== first) {
				this.$core.view.soundPlayerTitle = path.basename(first);

				selected_file = first;
				unload_track(this.$core);

				if (this.$core.view.config.soundPlayerAutoPlay)
					play_track(this.$core);
			}
		});

		this.$core.events.on('crash', () => {
			unload_track(this.$core);
			player.destroy();
		});

		await load_sound_data(this.$core);
	}
};
