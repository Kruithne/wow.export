<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<template>
	<div class="ui-menu-button" :class="{ disabled, dropdown, open }">
		<input type="button" :value="selected.label ?? selected.value" :class="{ disabled }" @click="handleClick" />
		<div class="arrow" @click.stop="openMenu"></div>
		<context-menu :node="open" @close="open = false">
			<span v-for="option in options" @click="select(option)">
				{{ option.label ?? option.value }}
			</span>
		</context-menu>
	</div>
</template>

<script lang="ts" setup>
	import { ref, computed } from 'vue';

	type Option = {
		label: string;
		value: string;
	};

	const props = defineProps({
		/** Array of options to display in the menu. */
		'options': { type: Array<Option>, required: true },

		/** Default option to select. */
		'default': { type: [String, Number], required: true },

		/** If true, the component is disabled. */
		'disabled': { type: [Boolean, Number], default: false },

		/** If true, the full button prompts the context menu, not just the arrow. */
		'dropdown': Boolean
	});

	const emit = defineEmits(['click', 'change']);

	const selectedObj = ref<Option | null>(null);
	const open = ref(false);

	const defaultObj = computed(() => props.options.find((e: Option) => e.value === props.default) ?? props.options[0]);
	const selected = computed(() => selectedObj.value ?? defaultObj.value);

	function select(option: Option): void {
		open.value = false;
		selectedObj.value = option;
		emit('change', option.value);
	}

	function openMenu(): void {
		open.value = !open.value && !props.disabled;
	}

	function handleClick(event: MouseEvent): void {
		props.dropdown ? openMenu() : emit('click', event);
	}
</script>