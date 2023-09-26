/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */
const fs = require('fs');
const fsp = fs.promises;
const SFTPClient = require('ssh2-sftp-client');

(async () => {
	let sftp;

	try {
		const sftp_config = {
			host: process.env.SFTP_HOST,
			port: process.env.SFTP_PORT ?? 22,
			username: process.env.SFTP_USER,
			password: process.env.SFTP_PASS,
			privateKey: process.env.SFTP_PRIVATE_KEY
		};

		// Load private key from disk if defined.
		if (typeof sftp_config.privateKey === 'string') {
			console.log('Loading private key...');
			sftp_config.privateKey = await fsp.readFile(sftp_config.privateKey);
		}

		console.log('Establishing SFTP connection...');

		sftp = new SFTPClient();
		await sftp.connect(sftp_config);

		await sftp.mkdir(process.env.SFTP_REMOTE_UPDATE_DIR, true);
		await sftp.uploadDir('./website', process.env.SFTP_REMOTE_UPDATE_DIR);
	} catch (e) {
		console.error('Publish failed due to error: %s', e.message);
		console.error(e.stack);
	} finally {
		if (sftp)
			await sftp.end();
	}
})();