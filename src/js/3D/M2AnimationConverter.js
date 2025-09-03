/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
 */

class M2AnimationConverter {
	/**
	 * Convert M2 animation data to Three.js AnimationClip
	 * @param {Object} m2 - M2Loader instance with animation and bone data
	 * @param {number} animationIndex - Index of animation to convert
	 * @returns {THREE.AnimationClip|null} Three.js AnimationClip or null if invalid
	 */
	static convertAnimation(m2, animationIndex) {
		if (!m2.animations || !m2.bones || animationIndex >= m2.animations.length)
			return null;

		const animation = m2.animations[animationIndex];
		const tracks = [];
		
		// Duration in seconds (M2 uses milliseconds)
		const durationSeconds = animation.duration / 1000;
		
		for (let boneIndex = 0; boneIndex < m2.bones.length; boneIndex++) {
			const bone = m2.bones[boneIndex];
			const boneName = bone.boneID >= 0 ? `bone_${bone.boneID}` : `bone_idx_${boneIndex}`;
			
			// position
			this._convertTrack(
				bone.translation, 
				animationIndex, 
				boneName + '.position',
				'VectorKeyframeTrack',
				animation.duration,
				durationSeconds,
				tracks
			);
			
			// rotation
			this._convertTrack(
				bone.rotation,
				animationIndex,
				boneName + '.quaternion', 
				'QuaternionKeyframeTrack',
				animation.duration,
				durationSeconds,
				tracks
			);
			
			// scale
			this._convertTrack(
				bone.scale,
				animationIndex,
				boneName + '.scale',
				'VectorKeyframeTrack', 
				animation.duration,
				durationSeconds,
				tracks
			);
		}
		
		if (tracks.length === 0)
			return null;
		
		return new THREE.AnimationClip(
			`animation_${animation.id}_${animation.variationIndex}`,
			durationSeconds,
			tracks
		);
	}

	/**
	 * Convert an M2Track to Three.js KeyframeTrack
	 * @param {M2Track} track - M2 animation track
	 * @param {number} animationIndex - Animation index
	 * @param {string} name - Track name (boneName.property)
	 * @param {string} trackType - Three.js track type
	 * @param {number} animationDurationMs - Animation duration in milliseconds  
	 * @param {number} animationDurationSeconds - Animation duration in seconds
	 * @param {Array} tracks - Output tracks array
	 * @private
	 */
	static _convertTrack(track, animationIndex, name, trackType, animationDurationMs, animationDurationSeconds, tracks) {
		if (!track || !track.timestamps || !track.values)
			return;

		if (animationIndex >= track.timestamps.length || animationIndex >= track.values.length)
			return;

		const timestamps = track.timestamps[animationIndex];
		const values = track.values[animationIndex];
		
		if (!timestamps || !values || timestamps.length !== values.length || timestamps.length === 0)
			return;
		
		const normalizedTimes = timestamps.map(t => (t / animationDurationMs) * animationDurationSeconds);
		const flatValues = values.flat();
		const interpolation = track.interpolation === 0 ? THREE.InterpolateDiscrete : THREE.InterpolateLinear;
		
		let keyframeTrack;
		switch (trackType) {
			case 'VectorKeyframeTrack':
				keyframeTrack = new THREE.VectorKeyframeTrack(name, normalizedTimes, flatValues);
				break;
			case 'QuaternionKeyframeTrack':
				keyframeTrack = new THREE.QuaternionKeyframeTrack(name, normalizedTimes, flatValues);
				break;
			default:
				return;
		}
		
		keyframeTrack.setInterpolation(interpolation);
		tracks.push(keyframeTrack);
	}

	/**
	 * Get list of available animations from M2 data
	 * @param {Object} m2 - M2Loader instance
	 * @returns {Array} Array of animation info objects
	 */
	static getAnimationList(m2) {
		if (!m2.animations)
			return [];

		return m2.animations.map((animation, index) => ({
			index,
			id: animation.id,
			variationIndex: animation.variationIndex,
			duration: animation.duration,
			name: `Animation ${animation.id}.${animation.variationIndex}`
		}));
	}

	/**
	 * Check if M2 data has animation support
	 * @param {Object} m2 - M2Loader instance
	 * @returns {boolean} True if animations are available
	 */
	static hasAnimations(m2) {
		return m2.animations && m2.animations.length > 0 && m2.bones && m2.bones.length > 0;
	}
}

module.exports = M2AnimationConverter;