<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<template>
	<input
		ref="root"
		type="text"
		:value="value"
		@focus="openDialog"
		@input="$emit('input', ($event.target as HTMLInputElement).value)"
	/>
</template>

<script lang="ts" setup>
	import { ref, onMounted, onUnmounted } from 'vue';

	const emit = defineEmits(['input']);
	defineProps({
		/** The current value of the field. */
		'value': { type: String, default: '' }
	});

	const root = ref<HTMLInputElement>();

	let fileSelector: HTMLInputElement;

	function openDialog(): void {
		// Wipe the value here so that it fires after user interaction
		// even if they pick the "same" directory.
		fileSelector.value = '';
		fileSelector.click();
		root.value.blur();
	}

	onMounted(() => {
		const node = document.createElement('input');
		node.setAttribute('type', 'file');
		node.setAttribute('nwdirectory', 'true');
		node.addEventListener('change', () => {
			root.value.value = node.value;
			emit('input', node.value);
		});

		fileSelector = node;
	});

	onUnmounted(() => {
		fileSelector.remove();
	});
</script>