<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<template>
	<div class="image ui-model-viewer" ref="root"></div>
</template>

<script lang="ts" setup>
	import { OrbitControls } from '../3D/lib/OrbitControls';
	import * as THREE from 'three';
	import { ref, onMounted, onBeforeUnmount } from 'vue';

	const props = defineProps({
		/** The context to render. */
		'context': { type: Object, required: true }
	});

	const root = ref<HTMLDivElement>();

	const renderer: THREE.WebGLRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
	const controls = new OrbitControls(props.context.camera, renderer.domElement);

	const isRendering = ref(false);

	function render(): void {
		if (!isRendering.value)
			return;

		requestAnimationFrame(render);

		controls.update();
		renderer.render(props.context.scene, props.context.camera);
	}

	function onResize(): void {
		// We need to remove the canvas from the container so that the layout updates
		// correctly and then we can update the AR/canvas size based on that layout.
		root.value.removeChild(renderer.domElement);

		props.context.camera.aspect = root.value.clientWidth / root.value.clientHeight;
		props.context.camera.updateProjectionMatrix();
		renderer.setSize(root.value.clientWidth, root.value.clientHeight, false);

		// Add the canvas back now that we have the proper measurements applied.
		root.value.appendChild(renderer.domElement);
	}

	onMounted(() => {
		root.value.appendChild(renderer.domElement);

		//this.controls.enableKeys = false;
		props.context.controls = controls;

		onResize();
		window.addEventListener('resize', onResize);

		isRendering.value = true;
		render();
	});

	onBeforeUnmount(() => {
		isRendering.value = false;
		controls.dispose();
		renderer.dispose();
		window.removeEventListener('resize', onResize);
	});
</script>