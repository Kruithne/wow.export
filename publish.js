/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const chalk = require('chalk');
const path = require('path');
const util = require('util');
const fs = require('fs');
const fsp = fs.promises;
const argv = process.argv.splice(2);
const AdmZip = require('adm-zip');
const SFTPClient = require('ssh2-sftp-client');

/**
 * Defines the location of the build configuration file.
 * @type {string}
 */
const BUILD_CONFIG_FILE = path.join(__dirname, 'build.conf');

/**
 * Defines the location of the publish configuration file.
 * @type {string}
 */
const PUBLISH_CONFIG_FILE = path.join(__dirname, 'publish.conf');

/**
 * Defines the location of the SFTP connection configuration.
 * This is only necessary if not providing connection details
 * via environment variables.
 * @type {string}
 */
const SFTP_CONFIG_FILE = path.join(__dirname, 'sftp.conf');

/**
 * Defines the build manifest file, relative to the build directory.
 * @type {string}
 */
const MANIFEST_FILE = 'package.json';

/**
 * Defines the build directory.
 * @type {string}
 */
const BUILD_DIR = path.join(__dirname, 'bin');

/**
 * Pattern used to locate text surrounded by curly brackets in a string.
 * @type {RegExp}
 */
const HIGHLIGHT_PATTERN = /{([^}]+)}/g;

/**
 * Highlights all text in `message` contained within curly brackets by
 * calling `colorFunc` on each and substituting the result.
 * @param {string} message String that will be highlighted.
 * @param {function} colorFunc Colouring function.
 */
const filterHighlights = (message, colorFunc) => {
	return message.replace(HIGHLIGHT_PATTERN, (_, g1) => colorFunc(g1));
};

/**
 * Logging utility.
 * @type {Object<string, function>}
 */
const log = {
	error: (msg, ...params) => log.print('{ERR} ' + msg, chalk.red, ...params),
	warn: (msg, ...params) => log.print('{WARN} ' + msg, chalk.yellow, ...params),
	success: (msg, ...params) => log.print('{DONE} ' + msg, chalk.green, ...params),
	info: (msg, ...params) => log.print('{INFO} ' + msg, chalk.blue, ...params),
	print: (msg, colorFunc, ...params) => console.log(filterHighlights(msg, colorFunc), ...params)
};

(async () => {
	let sftp;

	try {
		const buildConfig = JSON.parse(await fsp.readFile(BUILD_CONFIG_FILE));
		const publishConfig = JSON.parse(await fsp.readFile(PUBLISH_CONFIG_FILE));

		let sftpConfig;
		if (process.env.SFTP_HOST !== undefined) {
			sftpConfig = {
				host: process.env.SFTP_HOST,
				port: process.env.SFTP_PORT ?? 22,
				username: process.env.SFTP_USER,
				password: process.env.SFTP_PASS,
				privateKey: process.env.SFTP_PRIVATE_KEY,
				remoteUpdateDir: process.env.SFTP_REMOTE_UPDATE_DIR,
				remotePackageDir: process.env.SFTP_REMOTE_PACKAGE_DIR
			};
		} else {
			sftpConfig = JSON.parse(await fsp.readFile(SFTP_CONFIG_FILE));
		}

		// Collect available build names.
		const builds = buildConfig.builds.map(build => build.name);

		// Check all provided CLI parameters for valid build names.
		const targetBuilds = [];
		if (argv.includes('*')) {
			// If * is present as a parameter, include all builds.
			targetBuilds.push(...builds);
		} else {
			for (let arg of argv) {
				arg = arg.toLowerCase();

				if (builds.includes(arg)) {
					if (!targetBuilds.includes(arg))
						targetBuilds.push(arg);
					else
						log.warn('Duplicate build {%s} provided in arguments, only publishing once.', arg);
				} else {
					log.error('Unknown build {%s}, check build configuration.', arg);
					return;
				}
			}
		}

		// User has not selected any valid builds; display available and exit.
		if (targetBuilds.length === 0) {
			log.warn('You have not selected any builds.');
			log.info('Available builds: ' + builds.map(e => '{' + e + '}').join(', '));
			return;
		}

		const uploads = [];
		const publishStart = Date.now();
		log.info('Selected builds: ' + targetBuilds.map(e => '{' + e + '}').join(', '));

		for (const build of targetBuilds) {
			const publishBuildStart = Date.now();

			const buildDir = path.join(BUILD_DIR, build);
			const buildManifestPath = path.join(buildDir, MANIFEST_FILE);
			const buildManifest = JSON.parse(await fsp.readFile(buildManifestPath));

			log.info('Packaging {%s} ({%s})...', buildManifest.version, buildManifest.guid);

			// Prepare update files for upload.
			for (const file of publishConfig.updateFiles) {
				const remote = util.format(sftpConfig.remoteUpdateDir, build, file);
				const local = path.join(buildDir, file);

				uploads.push({ local, remote, tmpProtection: true });
			}

			const zip = new AdmZip();
			zip.addLocalFolder(buildDir, '', entry => {
				// Do not package update files with the download archive.
				return !publishConfig.updateFiles.includes(entry)
			});

			const packageName = util.format(publishConfig.packageName, buildManifest.version);
			const packageOut = path.join(publishConfig.packageOut, packageName);

			// Ensure directories exist for the package.e
			await fsp.mkdir(path.dirname(packageOut), { recursive: true });

			log.info('Writing package {%s}...', packageOut);
			zip.writeZip(packageOut);

			// Store the package path for upload.
			const remoteFile = util.format(sftpConfig.remotePackageDir, build, packageName);
			uploads.push({ remote: remoteFile, local: packageOut });

			const publishBuildElapsed = (Date.now() - publishBuildStart) / 1000;
			log.success('Build {%s} version {%s} packaged in {%ds}', build, buildManifest.version, publishBuildElapsed);
		}

		if (uploads.length > 0) {
			const uploadStart = Date.now();
			log.info('Establishing SFTP connection to {%s} @ {%d}', sftpConfig.host, sftpConfig.port);

			// Load private key from disk if defined.
			if (typeof sftpConfig.privateKey === 'string')
				sftpConfig.privateKey = await fsp.readFile(sftpConfig.privateKey);

			sftp = new SFTPClient();
			await sftp.connect(sftpConfig);

			const renames = new Map();
			for (const upload of uploads) {
				log.info('Uploading {%s} to {%s}...', upload.local, upload.remote);

				if (upload.tmpProtection) {
					// Upload as a temporary file then rename on the server.
					const tmpRemote = upload.remote + '.tmp';

					await sftp.mkdir(path.dirname(upload.remote), true);
					await sftp.put(upload.local, tmpRemote);

					renames.set(tmpRemote, upload.remote);
				} else {
					// Upload files normally.
					await sftp.mkdir(path.dirname(upload.remote), true);
					await sftp.put(upload.local, upload.remote);
				}
			}

			log.info('Renaming remote temporary files...');
			for (const [from, to] of renames)
				await sftp.posixRename(from, to);

			const uploadElapsed = (Date.now() - uploadStart) / 1000;
			log.success('Uploaded {%d} files in {%ds}', uploads.length, uploadElapsed);
		}

		const publishElapsed = (Date.now() - publishStart) / 1000;
		log.success('Published all packages in {%ds}', publishElapsed);
	} catch (e) {
		log.error('Publish failed due to error: %s', e.message);
		log.error(e.stack);
	} finally {
		if (sftp)
			await sftp.end();
	}
})();