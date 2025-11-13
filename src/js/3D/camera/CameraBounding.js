/*!
	wow.export (https://github.com/Kruithne/wow.export)
	Authors: Kruithne <kruithne@gmail.com>
	License: MIT
*/
class CameraBounding {
	static calculateOptimalDistance(boundingBox, camera, options = {}) {
		if (boundingBox.isEmpty())
			return 10;
		
		const size = boundingBox.getSize(new THREE.Vector3());
		const fovRadians = camera.fov * (Math.PI / 180);
		const padding = options.padding || 1.2;
		const useAspectRatio = options.useAspectRatio !== undefined ? options.useAspectRatio : true;
		
		if (useAspectRatio && camera.aspect) {
			const distanceForHeight = (size.y / 2) / Math.tan(fovRadians / 2);
			const distanceForWidth = (size.x / 2) / Math.tan(fovRadians / 2);
			
			const distance = Math.max(distanceForHeight, distanceForWidth);
			
			return (distance + size.z / 2) * padding;
		} else {
			const maxDim = Math.max(size.x, size.y, size.z);
			const distance = maxDim / (2 * Math.tan(fovRadians / 2));
			return distance * padding;
		}
	}
	
	static positionCameraForBoundingBox(boundingBox, camera, options = {}) {
		const viewDirection = options.viewDirection || new THREE.Vector3(1, 0.5, 1).normalize();
		const padding = options.padding || 1.2;
		const lookAtCenter = options.lookAtCenter !== undefined ? options.lookAtCenter : true;
		
		if (boundingBox.isEmpty()) {
			camera.position.set(10, 5, 10);
			if (lookAtCenter)
				camera.lookAt(0, 0, 0);
			
			return camera.position.clone();
		}
		
		const center = boundingBox.getCenter(new THREE.Vector3());
		const distance = this.calculateOptimalDistance(boundingBox, camera, { padding: padding });
		
		const direction = viewDirection.clone().normalize();
		camera.position.copy(center).add(direction.multiplyScalar(distance));
		
		if (lookAtCenter)
			camera.lookAt(center);
		
		camera.updateProjectionMatrix();
		
		return camera.position.clone();
	}
	
	static updateCameraAndControls(boundingBox, camera, controls = null, options = {}) {
		if (boundingBox.isEmpty())
			return;
		
		const center = boundingBox.getCenter(new THREE.Vector3());
		const viewDirection = options.viewDirection || new THREE.Vector3(1, 0.5, 1).normalize();
		const padding = options.padding || 1.2;
		const maxDistanceMultiplier = options.maxDistanceMultiplier || 3;
		
		this.positionCameraForBoundingBox(boundingBox, camera, {
			viewDirection: viewDirection,
			padding: padding,
			lookAtCenter: true
		});
		
		if (controls) {
			controls.target.copy(center);
			
			const distance = this.calculateOptimalDistance(boundingBox, camera, { padding: padding });
			controls.maxDistance = distance * maxDistanceMultiplier;
			
			if (controls.update)
				controls.update();
		}
		
		return {
			center,
			distance: camera.position.distanceTo(center)
		};
	}
	
	static fitObjectInView(object, camera, controls = null, options = {}) {
		const boundingBox = new THREE.Box3();
		boundingBox.setFromObject(object);
		
		return this.updateCameraAndControls(boundingBox, camera, controls, options);
	}
	
	static getBoundingBoxInfo(boundingBox) {
		if (boundingBox.isEmpty())
			return { isEmpty: true };
		
		const center = boundingBox.getCenter(new THREE.Vector3());
		const size = boundingBox.getSize(new THREE.Vector3());
		const maxDim = Math.max(size.x, size.y, size.z);
		
		return {
			isEmpty: false,
			center,
			size,
			maxDim,
			min: boundingBox.min.clone(),
			max: boundingBox.max.clone()
		};
	}
	
	static fitCharacterInView(object, camera, controls = null, options = {}) {
		const boundingBox = new THREE.Box3();
		boundingBox.setFromObject(object);
		
		if (boundingBox.isEmpty())
			return null;
		
		const center = boundingBox.getCenter(new THREE.Vector3());
		const size = boundingBox.getSize(new THREE.Vector3());
		
		const view_height_percentage = options.viewHeightPercentage ?? 0.9;
		const vertical_offset_factor = options.verticalOffsetFactor ?? -0.5;
		
		const fov_radians = camera.fov * (Math.PI / 180);
		const distance = (size.y / view_height_percentage) / (2 * Math.tan(fov_radians / 2));
		
		console.log('calculated distance:', distance.toFixed(2));
		
		const view_direction = new THREE.Vector3(0, 0.20, 1.0).normalize();
		camera.position.copy(center).add(view_direction.multiplyScalar(distance));
		
		console.log('camera pos:', camera.position.x.toFixed(2), camera.position.y.toFixed(2), camera.position.z.toFixed(2));
		
		const adjusted_target = center.clone();
		adjusted_target.y += size.y * vertical_offset_factor;
		
		console.log('look target:', adjusted_target.x.toFixed(2), adjusted_target.y.toFixed(2), adjusted_target.z.toFixed(2));
		
		camera.lookAt(adjusted_target);
		camera.updateProjectionMatrix();
		
		if (controls) {
			controls.target.copy(adjusted_target);
			
			if (controls.maxDistance !== undefined)
				controls.maxDistance = distance * 3;
			
			if (controls.update)
				controls.update();
		}
		
		return {
			center: adjusted_target,
			distance: camera.position.distanceTo(adjusted_target)
		};
	}
}

module.exports = CameraBounding;