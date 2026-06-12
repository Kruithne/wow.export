/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

// obs-server exposes the live 3D model/character preview for OBS in two ways:
//
//  1. Browser source - a fixed 1080p MJPEG stream (multipart/x-mixed-replace).
//     OBS renders MJPEG natively as a video stream (no per-frame JavaScript
//     decode), which gives seamless, low-overhead playback. MJPEG has no alpha,
//     so frames are composited over a configurable chroma colour you can key out
//     in OBS.
//
//  2. Spout - a native DirectX texture sender (Windows) for true-alpha, GPU
//     sharing via the OBS Spout2 plugin. Independent of the browser source.
//
// No external dependencies are used; everything runs on Node's built-in modules,
// available to us via NW.js.

const http = require('http');
const path = require('path');
const log = require('./log');
const core = require('./core');
const constants = require('./constants');

const DEFAULT_PORT = 25478;
const DEFAULT_FPS = 30;
const DEFAULT_QUALITY = 90;
const DEFAULT_MAX_SIZE = 1600; // used for the Spout path
const DEFAULT_CHROMA = '#00b140'; // standard chroma green

// Fixed broadcast resolution for the MJPEG browser source.
const OUTPUT_W = 1920;
const OUTPUT_H = 1080;

const MJPEG_BOUNDARY = 'wowexportframe';

let server = null;
let current_port = null;

// Capture pacing is driven by requestAnimationFrame (smoother than setInterval
// and, with raf-throttling disabled, keeps running while OBS is focused).
let frame_running = false;
let raf_id = null;
let last_capture = 0;

// MJPEG output (1080p, opaque) canvas.
let mjpeg_canvas = null;
let mjpeg_ctx = null;
let mjpeg_in_flight = false;

// Spout output (transparent, downscaled) canvas.
let spout_canvas = null;
let spout_ctx = null;

// Connected MJPEG client responses.
const clients = new Set();

// Native Spout DirectX sender (Windows only). Loaded lazily.
let spout = null;
let spout_active = false;
let spout_warned = false;

// The overlay page served at '/'. OBS can point at this URL (or directly at
// /stream.mjpeg). It simply displays the MJPEG stream full-frame.
const OVERLAY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>wow.export OBS Source</title>
<style>
	html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
	img { position: fixed; inset: 0; width: 100%; height: 100%; object-fit: contain; }
</style>
</head>
<body>
	<img src="/stream.mjpeg" alt="">
</body>
</html>`;

/**
 * Locate the model/character viewer canvas that is currently visible.
 * @returns {HTMLCanvasElement|null}
 */
function get_active_canvas() {
	const canvases = document.querySelectorAll('canvas.gl-canvas');

	let best = null;
	let best_area = 0;

	for (const canvas of canvases) {
		if (canvas.offsetParent === null)
			continue;

		const area = canvas.width * canvas.height;
		if (area > best_area) {
			best_area = area;
			best = canvas;
		}
	}

	return best;
}

/**
 * Output dimensions for the Spout path: downscale so the longest edge does not
 * exceed the configured maximum, preserving aspect. Never scales up.
 */
function get_output_dimensions(src_w, src_h) {
	const max_size = Math.max(core.view.config.obsServerMaxSize ?? DEFAULT_MAX_SIZE, 64);
	const longest = Math.max(src_w, src_h);
	const scale = longest > max_size ? max_size / longest : 1;

	return {
		width: Math.max(Math.round(src_w * scale), 1),
		height: Math.max(Math.round(src_h * scale), 1)
	};
}

/**
 * Burn the imported-character info into the MJPEG frame (MJPEG has no separate
 * data channel, so the text is drawn directly onto the image).
 * @param {CanvasRenderingContext2D} ctx
 */
function draw_info_overlay(ctx) {
	const info = core.view?.chrImportedInfo;
	if (!info)
		return;

	ctx.save();
	ctx.textBaseline = 'top';
	ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
	ctx.shadowBlur = 6;
	ctx.shadowOffsetX = 0;
	ctx.shadowOffsetY = 2;

	const x = 40;
	let y = 40;

	ctx.font = 'bold 44px "Segoe UI", Roboto, sans-serif';
	ctx.fillStyle = info.class_color || '#ffffff';
	ctx.fillText(info.name || '', x, y);
	y += 56;

	ctx.font = 'bold 28px "Segoe UI", Roboto, sans-serif';
	let stats_x = x;
	if (info.achievement_points !== null && info.achievement_points !== undefined) {
		const text = info.achievement_points + ' pts';
		ctx.fillStyle = '#f0b132';
		ctx.fillText(text, stats_x, y);
		stats_x += ctx.measureText(text).width + 24;
	}
	if (info.item_level !== null && info.item_level !== undefined) {
		ctx.fillStyle = '#e8e8e8';
		ctx.fillText(info.item_level + ' ILVL', stats_x, y);
	}
	y += 40;

	ctx.font = '24px "Segoe UI", Roboto, sans-serif';
	ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
	let desc = info.descriptor || '';
	if (info.guild)
		desc += ' ‹' + info.guild + '›';
	if (info.realm) {
		desc += ' ' + info.realm;
		if (info.region)
			desc += ' (' + info.region + ')';
	}
	ctx.fillText(desc, x, y);

	ctx.restore();
}

/**
 * Capture the active viewer and feed the enabled outputs.
 */
function capture_frame() {
	const want_mjpeg = clients.size > 0;
	const want_spout = spout_active && spout !== null;

	if (!want_mjpeg && !want_spout)
		return;

	const canvas = get_active_canvas();
	if (!canvas || canvas.width === 0 || canvas.height === 0)
		return;

	// --- MJPEG browser source (fixed 1080p, opaque chroma background) ---
	if (want_mjpeg && !mjpeg_in_flight) {
		if (mjpeg_canvas === null) {
			mjpeg_canvas = document.createElement('canvas');
			mjpeg_canvas.width = OUTPUT_W;
			mjpeg_canvas.height = OUTPUT_H;
			mjpeg_ctx = mjpeg_canvas.getContext('2d', { alpha: false });
		}

		try {
			mjpeg_ctx.fillStyle = core.view.config.obsServerChromaColor || DEFAULT_CHROMA;
			mjpeg_ctx.fillRect(0, 0, OUTPUT_W, OUTPUT_H);

			// fit the viewer canvas into the 1080p frame, preserving aspect
			const scale = Math.min(OUTPUT_W / canvas.width, OUTPUT_H / canvas.height);
			const w = canvas.width * scale;
			const h = canvas.height * scale;
			mjpeg_ctx.drawImage(canvas, (OUTPUT_W - w) / 2, (OUTPUT_H - h) / 2, w, h);

			draw_info_overlay(mjpeg_ctx);
		} catch (e) {
			log.write('[obs-server] failed to compose frame: %s', e.message);
		}

		const quality = Math.min(Math.max(core.view.config.obsServerQuality ?? DEFAULT_QUALITY, 1), 100) / 100;

		mjpeg_in_flight = true;
		mjpeg_canvas.toBlob(async (blob) => {
			try {
				if (!blob)
					return;

				const buffer = Buffer.from(await blob.arrayBuffer());
				write_mjpeg_frame(buffer);
			} catch (e) {
				log.write('[obs-server] failed to send frame: %s', e.message);
			} finally {
				mjpeg_in_flight = false;
			}
		}, 'image/jpeg', quality);
	}

	// --- Spout (transparent RGBA, downscaled) ---
	if (want_spout) {
		const { width, height } = get_output_dimensions(canvas.width, canvas.height);

		if (spout_canvas === null) {
			spout_canvas = document.createElement('canvas');
			spout_ctx = spout_canvas.getContext('2d', { alpha: true });
		}

		if (spout_canvas.width !== width || spout_canvas.height !== height) {
			spout_canvas.width = width;
			spout_canvas.height = height;
		}

		try {
			spout_ctx.clearRect(0, 0, width, height);
			spout_ctx.drawImage(canvas, 0, 0, width, height);
			const img = spout_ctx.getImageData(0, 0, width, height);
			spout.send(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), width, height);
		} catch (e) {
			log.write('[obs-server] spout send failed: %s', e.message);
		}
	}
}

/**
 * Write a single MJPEG part to every connected client. Slow clients are skipped
 * for that frame to avoid unbounded memory growth.
 * @param {Buffer} buffer
 */
function write_mjpeg_frame(buffer) {
	const header = '--' + MJPEG_BOUNDARY + '\r\nContent-Type: image/jpeg\r\nContent-Length: ' + buffer.length + '\r\n\r\n';

	for (const res of clients) {
		try {
			if (res.writableLength > 4 * 1024 * 1024)
				continue;

			res.write(header);
			res.write(buffer);
			res.write('\r\n');
		} catch (e) {
			// Broken connections are removed by their own 'close' handler.
		}
	}
}

function get_fps() {
	const fps = core.view.config.obsServerFPS ?? DEFAULT_FPS;
	return Math.min(Math.max(fps, 1), 60);
}

function frame_loop(now) {
	if (!frame_running)
		return;

	raf_id = requestAnimationFrame(frame_loop);

	// throttle to the target FPS (read live so changes apply without a restart)
	const interval = 1000 / get_fps();
	if (now - last_capture >= interval - 1) {
		last_capture = now;
		capture_frame();
	}
}

function start_frame_timer() {
	if (frame_running)
		return;

	frame_running = true;
	last_capture = 0;
	raf_id = requestAnimationFrame(frame_loop);
}

function stop_frame_timer() {
	frame_running = false;
	if (raf_id !== null) {
		cancelAnimationFrame(raf_id);
		raf_id = null;
	}
}

/**
 * Start/stop the capture timer based on whether any sink is active. Restarts to
 * pick up an FPS change when already running.
 */
function update_frame_timer() {
	const should_run = clients.size > 0 || spout_active;

	if (should_run)
		start_frame_timer();
	else
		stop_frame_timer();
}

/**
 * Start the Spout sender, loading the native addon on first use.
 */
function start_spout() {
	if (spout_active)
		return;

	if (spout === null) {
		try {
			spout = require(path.join(constants.INSTALL_PATH, 'spout.node'));
		} catch (e) {
			if (!spout_warned) {
				spout_warned = true;
				core.setToast('error', 'Spout output is unavailable in this build (native module failed to load).', null, -1);
			}
			log.write('[obs-server] failed to load spout addon: %s', e.message);
			return;
		}
	}

	try {
		if (!spout.init('wow.export'))
			throw new Error('Spout initialisation returned false');
	} catch (e) {
		core.setToast('error', `Spout output failed to start: ${e.message}`, null, -1);
		log.write('[obs-server] spout init failed: %s', e.message);
		return;
	}

	spout_active = true;
	log.write('[obs-server] spout sender started');
	core.setToast('success', 'Spout output started - add a "Spout2 Capture" source in OBS (sender: wow.export).', null, 6000);
	update_frame_timer();
}

/**
 * Stop the Spout sender.
 */
function stop_spout() {
	if (!spout_active)
		return;

	spout_active = false;

	try {
		spout?.release();
	} catch (e) {
		log.write('[obs-server] spout release failed: %s', e.message);
	}

	log.write('[obs-server] spout sender stopped');
	update_frame_timer();
}

/**
 * Handle an incoming HTTP request: the overlay page and the MJPEG stream.
 */
function handle_request(req, res) {
	const url = (req.url || '/').split('?')[0];

	if (url === '/' || url === '/index.html') {
		res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
		res.end(OVERLAY_HTML);
		return;
	}

	if (url === '/stream.mjpeg') {
		res.writeHead(200, {
			'Content-Type': 'multipart/x-mixed-replace; boundary=' + MJPEG_BOUNDARY,
			'Cache-Control': 'no-store, no-cache, must-revalidate',
			'Pragma': 'no-cache',
			'Connection': 'close',
			'Access-Control-Allow-Origin': '*'
		});

		// keep the socket responsive
		req.socket.setNoDelay(true);

		clients.add(res);
		log.write('[obs-server] client connected (%d active)', clients.size);
		update_frame_timer();

		req.on('close', () => {
			clients.delete(res);
			log.write('[obs-server] client disconnected (%d active)', clients.size);
			update_frame_timer();
		});

		return;
	}

	res.writeHead(404, { 'Content-Type': 'text/plain' });
	res.end('Not found');
}

/**
 * Start the HTTP server on the given port, bound to localhost only.
 */
function start(port) {
	if (server !== null)
		stop_server();

	current_port = port;
	server = http.createServer(handle_request);

	server.on('error', (err) => {
		server = null;
		current_port = null;

		if (err.code === 'EADDRINUSE')
			core.setToast('error', `OBS browser source: port ${port} is already in use. Choose a different port in Settings.`, null, -1);
		else
			core.setToast('error', `OBS browser source failed to start: ${err.message}`, null, -1);

		log.write('[obs-server] error: %s', err.message);
	});

	// Bind to loopback only so the feed is never exposed to the network.
	server.listen(port, '127.0.0.1', () => {
		log.write('[obs-server] listening on http://127.0.0.1:%d/', port);
		core.setToast('success', `OBS browser source running at http://localhost:${port}/`, null, 6000);
	});
}

/**
 * Stop the HTTP browser source and disconnect any clients. Leaves Spout running.
 */
function stop_server() {
	mjpeg_in_flight = false;

	for (const res of clients) {
		try {
			res.end();
		} catch (e) {
			// ignore
		}
	}

	clients.clear();

	if (server !== null) {
		server.close();
		server = null;
		current_port = null;
		log.write('[obs-server] stopped');
	}

	update_frame_timer();
}

/**
 * Stop everything (browser source + Spout output).
 */
function stop() {
	stop_server();
	stop_spout();
}

/**
 * Reconcile the running outputs with the current configuration.
 */
function apply_config() {
	const cfg = core.view.config;
	const port = cfg.obsServerPort ?? DEFAULT_PORT;

	// MJPEG browser source.
	if (cfg.obsServerEnabled) {
		if (server === null || current_port !== port)
			start(port);
	} else {
		stop_server();
	}

	// Spout output (independent of the browser source).
	if (cfg.obsSpoutEnabled)
		start_spout();
	else
		stop_spout();

	// Apply any FPS change to the (possibly already running) capture timer.
	update_frame_timer();
}

module.exports = { start, stop, apply_config };
