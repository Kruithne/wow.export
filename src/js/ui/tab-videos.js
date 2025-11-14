/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const path = require('path');
const core = require('../core');
const log = require('../log');
const ExportHelper = require('../casc/export-helper');
const BLTEIntegrityError = require('../casc/blte-reader').BLTEIntegrityError;
const generics = require('../generics');
const listfile = require('../casc/listfile');
const VP9AVIDemuxer = require('../casc/vp9-avi-demuxer');

let currentMediaSource = null;
let currentVideoDecoder = null;
let selectedFile = null;
let shouldStop = false;
let isPlaying = false;
let pendingFrames = [];

const stop_video = async () => {
	shouldStop = true;
	core.view.videoPlayerState = false;

	// clean up any pending frames
	for (const frame of pendingFrames) {
		try {
			frame.close();
		} catch (e) {
			// ignore if already closed
		}
	}
	pendingFrames = [];

	// wait for playback to actually stop
	let attempts = 0;
	while (isPlaying && attempts < 50) {
		await new Promise(resolve => setTimeout(resolve, 100));
		attempts++;
	}

	if (currentVideoDecoder) {
		try {
			if (currentVideoDecoder.state !== 'closed') {
				currentVideoDecoder.close();
			}
		} catch (e) {
			log.write('error closing decoder: %s', e.message);
		}
		currentVideoDecoder = null;
	}

	if (currentMediaSource) {
		try {
			if (currentMediaSource.readyState === 'open')
				currentMediaSource.endOfStream();
		} catch (e) {
			log.write('error ending stream: %s', e.message);
		}
		currentMediaSource = null;
	}

	const canvas = document.getElementById('video-preview-canvas');
	if (canvas) {
		const ctx = canvas.getContext('2d');
		ctx.clearRect(0, 0, canvas.width, canvas.height);
	}

	log.write('video stopped, isPlaying: %s', isPlaying);
};

const play_video = async (fileName) => {
	const fileDataID = listfile.getByFilename(fileName);

	if (!fileDataID) {
		core.setToast('error', 'unable to find file in listfile');
		return;
	}

	log.write('play_video called for: %s, isPlaying: %s, shouldStop: %s', fileName, isPlaying, shouldStop);

	try {
		await stop_video();
		shouldStop = false;
		isPlaying = true;

		log.write('starting playback for: %s', fileName);

		const streamReader = await core.view.casc.getFileStream(fileDataID);

		log.write('streaming video %s (%d blocks, %s total)',
			fileName,
			streamReader.getBlockCount(),
			generics.filesize(streamReader.getTotalSize())
		);

		log.write('initializing vp9 decoder...');
		const demuxer = new VP9AVIDemuxer(streamReader);
		const config = await demuxer.parse_header();

		if (!config)
			throw new Error('failed to parse avi header');

		log.write('video config: %dx%d @ %d fps, codec: %s',
			config.codedWidth,
			config.codedHeight,
			demuxer.frame_rate,
			config.codec
		);

		const support = await VideoDecoder.isConfigSupported(config);
		if (!support.supported)
			throw new Error(`vp9 codec not supported: ${config.codec}`);

		const canvas = document.getElementById('video-preview-canvas');
		if (!canvas)
			throw new Error('video-preview-canvas element not found');

		const ctx = canvas.getContext('2d', { alpha: false });

		const frame_duration_ms = 1000 / demuxer.frame_rate;
		pendingFrames = [];
		let playback_start_time = null;
		let frames_rendered = 0;

		const decoder = new VideoDecoder({
			output(frame) {
				pendingFrames.push(frame);
				if (pendingFrames.length === 1 && !shouldStop)
					requestAnimationFrame(render_next_frame);
			},
			error(e) {
				log.write('decoder error: %s', e.message);
				core.setToast('error', 'video decode error: ' + e.message);
			}
		});

		const render_next_frame = () => {
			if (pendingFrames.length === 0 || shouldStop)
				return;

			if (playback_start_time === null)
				playback_start_time = performance.now();

			const frame = pendingFrames.shift();
			const elapsed_time = performance.now() - playback_start_time;
			const expected_time = frames_rendered * frame_duration_ms;
			const delay = expected_time - elapsed_time;

			const do_render = () => {
				if (shouldStop) {
					frame.close();
					return;
				}

				canvas.width = frame.displayWidth;
				canvas.height = frame.displayHeight;
				ctx.drawImage(frame, 0, 0);
				frame.close();
				frames_rendered++;

				if (pendingFrames.length > 0 && !shouldStop)
					requestAnimationFrame(render_next_frame);
			};

			if (delay > 0)
				setTimeout(do_render, delay);
			else
				do_render();
		};

		decoder.configure(config);
		currentVideoDecoder = decoder;
		core.view.videoPlayerState = true;

		log.write('streaming vp9 frames at %d fps...', demuxer.frame_rate);

		let frame_count = 0;
		const total_blocks = streamReader.getBlockCount();

		for await (const frame_info of demuxer.extract_frames()) {
			if (shouldStop) {
				log.write('breaking out of frame loop, shouldStop is true');
				break;
			}

			if (!frame_info.data || frame_info.data.length === 0) {
				log.write('skipping empty frame at timestamp %d', frame_info.timestamp);
				continue;
			}

			const chunk = new EncodedVideoChunk(frame_info);

			if (decoder.state !== 'closed')
				decoder.decode(chunk);
			else
				break;

			frame_count++;
		}

		log.write('frame loop exited, frame_count: %d, shouldStop: %s', frame_count, shouldStop);

		isPlaying = false;
		log.write('isPlaying set to false');

		if (!shouldStop) {
			await decoder.flush();
			core.view.videoPlayerState = false;
			log.write('video playback complete (%d frames)', frame_count);
		} else {
			log.write('video playback stopped (%d frames processed)', frame_count);
		}
	} catch (e) {
		isPlaying = false;
		core.view.videoPlayerState = false;

		// ignore abort errors from stopping playback
		if (e.message && e.message.includes('Aborted due to close()')) {
			log.write('video playback aborted: %s', fileName);
			return;
		}

		log.write('failed to stream video %s: %s', fileName, e.message);
		log.write(e.stack);
		core.setToast('error', 'failed to load video: ' + e.message, { 'view log': () => log.openRuntimeLog() }, -1);
	}
};

core.registerLoadFunc(async () => {
	core.events.on('click-preview-video', async () => {
		if (core.view.videoPlayerState) {
			await stop_video();
			return;
		}

		const selection = core.view.selectionVideos;
		if (selection.length === 0) {
			core.setToast('info', 'select a video file first');
			return;
		}

		const fileName = listfile.stripFileEntry(selection[0]);
		selectedFile = fileName;
		await play_video(fileName);
	});

	core.view.$watch('selectionVideos', async selection => {
		if (core.view.screen !== 'tab-video' || selection.length === 0)
			return;

		const fileName = listfile.stripFileEntry(selection[0]);
		if (!core.view.isBusy && fileName && selectedFile !== fileName) {
			selectedFile = fileName;

			if (core.view.config.videoPlayerAutoPlay)
				await play_video(fileName);
		}
	});

	// export selected videos
	core.events.on('click-export-video', async () => {
		const userSelection = core.view.selectionVideos;
		if (userSelection.length === 0) {
			core.setToast('info', 'You didn\'t select any files to export; you should do that first.');
			return;
		}

		const helper = new ExportHelper(userSelection.length, 'video');
		helper.start();
		
		const overwriteFiles = core.view.config.overwriteFiles;
		for (let fileName of userSelection) {
			// Abort if the export has been cancelled.
			if (helper.isCancelled())
				return;

			fileName = listfile.stripFileEntry(fileName);
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
			
			const exportPath = ExportHelper.getExportPath(exportFileName);
			let isCorrupted = false;

			if (overwriteFiles || !await generics.fileExists(exportPath)) {
				try {
					const data = await core.view.casc.getFileByName(fileName);
					await data.writeToFile(exportPath);

					helper.mark(fileName, true);
				} catch (e) {
					// Corrupted file, often caused by users cancelling a cinematic while it is streaming.
					if (e instanceof BLTEIntegrityError)
						isCorrupted = true;
					else
						helper.mark(fileName, false, e.message, e.stack);
				}

				if (isCorrupted) {
					try {
						log.write('Local cinematic file is corrupted, forcing fallback.');

						// In the event of a corrupted cinematic, try again with forced fallback.
						const data = await core.view.casc.getFileByName(fileName, false, false, true, true);
						await data.writeToFile(exportPath);

						helper.mark(fileName, true);
					} catch (e) {
						helper.mark(fileName, false, e.message, e.stack);
					}
				}
			} else {
				helper.mark(fileName, true);
				log.write('Skipping video export %s (file exists, overwrite disabled)', exportPath);
			}
		}

		helper.finish();
	});
});