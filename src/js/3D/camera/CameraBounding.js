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
}

module.exports = CameraBounding;