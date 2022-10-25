This guide explains how to build and deploy an update for wow.export.

## Automatic
1) Compile a new build, for example `node ./build.js win-x64`
2) Publish the new build, `node ./publish.js win-x64`

> SFTP settings will need to be configured in `sftp.conf`, ensure this file is not included in source control. See available SFTP configuration at https://www.npmjs.com/package/ssh2-sftp-client. For the `privateKey` field, provide a local path.

## Manual (Legacy)

1) Compile a new build, for example `node ./build.js win-x64`.
2) Move `update` and `update.json` out of the build and upload them to the update server for this build flavour (`win-x64` based on the example). (A)
3) Ensure on the update server the update files are publicly accessible at the update URL combined with the build flavor. For example, if the update path is `https://kruithne.net/wow.export/` then the `win-x64` files need to be available at `https://kruithne.net/wow.export/win-x64/update` and `https://kruithne.net/wow.export/win-x64/update.json`.
4) Create a ZIP archive of the remaining files (be sure both `update` and `update.json` are not included) for the build and upload where needed for new users to download.

(A) To prevent potential issues for users actively updating, a best practice would be to rename `update` and `update.json` to `update2` and `update2.json` respectively while uploading/moving, and then delete/rename afterwards.
(B) Be sure that `update` and `update.json` are *both* purged from any caching services (such as CloudFlare).