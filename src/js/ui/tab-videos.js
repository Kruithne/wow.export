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
let currentSourceBuffer = null;
let currentVideoDecoder = null;

core.registerLoadFunc(async () => {
	// preview video using streaming
	core.events.on('click-preview-video', async () => {
		const selection = core.view.selectionVideos;
		if (selection.length === 0) {
			core.setToast('info', 'select a video file first');
			return;
		}

		const fileName = listfile.stripFileEntry(selection[0]);
		const fileDataID = listfile.getByFilename(fileName);

		if (!fileDataID) {
			core.setToast('error', 'unable to find file in listfile');
			return;
		}

		core.view.isBusy++;
		core.setToast('progress', 'loading video...', null, -1, 1);

		try {
			// cleanup previous decoder
			if (currentVideoDecoder) {
				try {
					if (currentVideoDecoder.state !== 'closed') {
						await currentVideoDecoder.flush();
						currentVideoDecoder.close();
					}
				} catch (e) {
					log.write('error closing previous decoder: %s', e.message);
				}
				currentVideoDecoder = null;
			}

			// cleanup previous media source
			if (currentMediaSource) {
				try {
					if (currentMediaSource.readyState === 'open')
						currentMediaSource.endOfStream();
				} catch (e) {
					log.write('error ending previous stream: %s', e.message);
				}
				currentMediaSource = null;
				currentSourceBuffer = null;
			}

			// get streaming reader
			const streamReader = await core.view.casc.getFileStream(fileDataID);

			log.write('streaming video %s (%d blocks, %s total)',
				fileName,
				streamReader.getBlockCount(),
				generics.filesize(streamReader.getTotalSize())
			);

			// initialize vp9 demuxer
			log.write('initializing vp9 decoder...');
			const demuxer = new VP9AVIDemuxer(streamReader);
			const config = await demuxer.parse_header();

			if (!config) {
				throw new Error('failed to parse avi header');
			}

			log.write('video config: %dx%d @ %d fps, codec: %s',
				config.codedWidth,
				config.codedHeight,
				demuxer.frame_rate,
				config.codec
			);

			// check codec support
			const support = await VideoDecoder.isConfigSupported(config);
			if (!support.supported) {
				throw new Error(`vp9 codec not supported: ${config.codec}`);
			}

			// get canvas element
			const canvas = document.getElementById('video-preview-canvas');
			if (!canvas) {
				throw new Error('video-preview-canvas element not found');
			}
			const ctx = canvas.getContext('2d', { alpha: false });

			// frame timing state
			const frame_duration_ms = 1000 / demuxer.frame_rate;
			let pending_frames = [];
			let playback_start_time = null;
			let frames_rendered = 0;

			// setup decoder
			const decoder = new VideoDecoder({
				output(frame) {
					pending_frames.push(frame);
					if (pending_frames.length === 1)
						requestAnimationFrame(render_next_frame);
				},
				error(e) {
					log.write('decoder error: %s', e.message);
					core.setToast('error', 'video decode error: ' + e.message);
				}
			});

			// frame renderer with timing
			const render_next_frame = () => {
				if (pending_frames.length === 0)
					return;

				if (playback_start_time === null)
					playback_start_time = performance.now();

				const frame = pending_frames.shift();
				const elapsed_time = performance.now() - playback_start_time;
				const expected_time = frames_rendered * frame_duration_ms;
				const delay = expected_time - elapsed_time;

				const do_render = () => {
					canvas.width = frame.displayWidth;
					canvas.height = frame.displayHeight;
					ctx.drawImage(frame, 0, 0);
					frame.close();
					frames_rendered++;

					if (pending_frames.length > 0)
						requestAnimationFrame(render_next_frame);
				};

				if (delay > 0)
					setTimeout(do_render, delay);
				else
					do_render();
			};

			decoder.configure(config);
			currentVideoDecoder = decoder;

			log.write('streaming vp9 frames at %d fps...', demuxer.frame_rate);
			core.setToast('progress', 'playing video...', null, -1, 1);

			let frame_count = 0;
			const total_blocks = streamReader.getBlockCount();

			for await (const frame_info of demuxer.extract_frames()) {
				// skip empty frames
				if (!frame_info.data || frame_info.data.length === 0) {
					log.write('skipping empty frame at timestamp %d', frame_info.timestamp);
					continue;
				}

				const chunk = new EncodedVideoChunk(frame_info);
				decoder.decode(chunk);
				frame_count++;

				if (frame_count % 30 === 0) {
					const progress = Math.floor(frame_count / (total_blocks * 10) * 100);
					log.write('decoded %d frames', frame_count);
					core.setToast('progress', `playing video... (${Math.min(progress, 99)}%)`, null, -1, 1);
				}
			}

			await decoder.flush();
			log.write('video playback complete (%d frames)', frame_count);
			core.setToast('success', 'video playback complete');
		} catch (e) {
			log.write('failed to stream video %s: %s', fileName, e.message);
			log.write(e.stack);
			core.setToast('error', 'failed to load video: ' + e.message, { 'view log': () => log.openRuntimeLog() }, -1);
		}

		core.view.isBusy--;
	});

	// stop video preview
	core.events.on('click-stop-video-preview', async () => {
		if (currentVideoDecoder) {
			try {
				if (currentVideoDecoder.state !== 'closed') {
					await currentVideoDecoder.flush();
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
			currentSourceBuffer = null;
		}

		// clear canvas
		const canvas = document.getElementById('video-preview-canvas');
		if (canvas) {
			const ctx = canvas.getContext('2d');
			ctx.clearRect(0, 0, canvas.width, canvas.height);
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