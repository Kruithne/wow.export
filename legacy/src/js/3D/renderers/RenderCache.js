/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/
const log = require('../../log');

class RenderCache {
	constructor() {
		this.users = new WeakMap();
		this.textures = new WeakMap();
	}

	/**
	 * Register a material to the cache.
	 * @param {THREE.material} material 
	 * @param {THREE.Texture} tex 
	 */
	register(material, tex) {
		this.users.set(material, 0);
		this.textures.set(material, tex);
	}

	/**
	 * Potentially retire the provided materials, if no users remain.
	 * @param {THREE.material} material 
	 */
	retire(...materials) {
		for (const material of materials) {
			if (!material)
				continue;

			let users = this.users.get(material) - 1;
			if (users < 1) {
				// No more users, retire the material.
				log.write('Disposing of abandoned material %s', material.uuid)

				material.dispose();
				this.textures.get(material)?.dispose();

				this.users.delete(material);
				this.textures.delete(material);
			} else {
				// Material still in use, do not retire yet.
				this.users.set(material, users);
			}
		}
	}

	/**
	 * Add another user for the provided material.
	 * @param {THREE.material} material 
	 */
	addUser(material) {
		this.users.set(material, this.users.get(material) + 1);
	}
}

module.exports = RenderCache;