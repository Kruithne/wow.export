/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import Log from '../../log';

export default class RenderCache {
	users: WeakMap<THREE.Material, number> = new WeakMap();
	textures: WeakMap<THREE.Material, THREE.Texture> = new WeakMap();

	/**
	 * Register a material to the cache.
	 * @param material
	 * @param tex
	 */
	register(material: THREE.Material, tex: THREE.Texture): void {
		this.users.set(material, 0);
		this.textures.set(material, tex);
	}

	/**
	 * Potentially retire the provided materials, if no users remain.
	 * @param material
	 */
	retire(...materials: THREE.Array<Material>): void {
		for (const material of materials) {
			if (!material)
				continue;

			const currentUsers = this.users.get(material);
			if (!currentUsers)
				continue;

			const newUsers = currentUsers - 1;
			if (newUsers < 1) {
				// No more users, retire the material.
				Log.write('Disposing of abandoned material %s', material.uuid);

				material.dispose();
				this.textures.get(material)?.dispose();

				this.users.delete(material);
				this.textures.delete(material);
			} else {
				// Material still in use, do not retire yet.
				this.users.set(material, newUsers);
			}
		}
	}

	/**
	 * Add another user for the provided material.
	 * @param material
	 */
	addUser(material: THREE.Material): void {
		const currentUsers = this.users.get(material);
		if (!currentUsers)
			return;
		this.users.set(material, currentUsers + 1);
	}
}