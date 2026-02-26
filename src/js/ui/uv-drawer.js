/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

/**
 * Generate a data URL for UV layer preview.
 * Creates a canvas with white lines representing UV coordinates overlaid on transparent background.
 * @param {Float32Array} uvCoords - UV coordinates array (pairs of u,v values 0-1)
 * @param {number} textureWidth - Width of the texture
 * @param {number} textureHeight - Height of the texture
 * @param {Uint16Array} indices - Triangle indices for the mesh
 * @returns {string} Data URL for the UV layer preview
 */
const generateUVLayerDataURL = (uvCoords, textureWidth, textureHeight, indices) => {
	const canvas = document.createElement('canvas');
	canvas.width = textureWidth;
	canvas.height = textureHeight;

	const ctx = canvas.getContext('2d');

	ctx.strokeStyle = '#ffffff';
	ctx.lineWidth = 0.5;
	ctx.globalAlpha = 1.0;

	ctx.beginPath();

	for (let i = 0; i < indices.length; i += 3) {
		const idx1 = indices[i] * 2;
		const idx2 = indices[i + 1] * 2;
		const idx3 = indices[i + 2] * 2;

		const u1 = uvCoords[idx1] * textureWidth;
		const v1 = (1 - uvCoords[idx1 + 1]) * textureHeight; // Flip V coordinate
		const u2 = uvCoords[idx2] * textureWidth;
		const v2 = (1 - uvCoords[idx2 + 1]) * textureHeight;
		const u3 = uvCoords[idx3] * textureWidth;
		const v3 = (1 - uvCoords[idx3 + 1]) * textureHeight;

		ctx.moveTo(u1, v1);
		ctx.lineTo(u2, v2);
		ctx.lineTo(u3, v3);
		ctx.lineTo(u1, v1);
	}

	ctx.stroke();

	const dataURL = canvas.toDataURL('image/png');

	canvas.width = 0;
	canvas.height = 0;

	return dataURL;
};

export {
	generateUVLayerDataURL
};
