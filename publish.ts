/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import log from '@kogs/logger';
import path from 'node:path';
import util from 'node:util';
import fs from 'node:fs';
import SFTPClient from 'ssh2-sftp-client';

const remote_update_dir = process.env.SFTP_REMOTE_UPDATE_DIR;
const remote_package_dir = process.env.SFTP_REMOTE_PACKAGE_DIR;

const sftp = new SFTPClient();
await sftp.connect({
	host: process.env.SFTP_HOST,
	port: parseInt(process.env.SFTP_PORT as string) ?? 22,
	username: process.env.SFTP_USER,
	password: process.env.SFTP_PASS
});

// Get all files from /bin/update and upload to process.env
const updateFiles = fs.readdirSync(path.join('./bin', 'update'));
const to_rename = new Map();

// Upload files with .tmp extension to prevent clients from downloading incomplete files.
for (const file of updateFiles) {
	const local = path.join('./bin', 'update', file);
	const remote = util.format(remote_update_dir, file);

	const remote_tmp = remote + '.tmp';

	log.info('Uploading {%s} to {%s}', local, remote_tmp);

	await sftp.mkdir(path.dirname(remote), true);
	await sftp.put(local, remote_tmp);

	to_rename.set(remote_tmp, remote);
}

// Rename all files from .tmp to their original name.
for (const [old_path, new_path] of to_rename)
	await sftp.rename(old_path, new_path);

// Upload all .zip files from ./bin/packages to the SFTP server.
// From the deployment CI this will be the latest package.
const packageFiles = fs.readdirSync(path.join('./bin', 'packages'));
for (const file of packageFiles) {
	const local = path.join('./bin', 'packages', file);
	const remote = util.format(remote_package_dir, file);

	log.info('Uploading {%s} to {%s}', local, remote);

	await sftp.mkdir(path.dirname(remote), true);
	await sftp.put(local, remote);
}