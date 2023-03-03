<!-- Copyright (c) wow.export contributors. All rights reserved. -->
<!-- Licensed under the MIT license. See LICENSE in project root for license information. -->

<script lang="ts" setup>
	import { state, showPreviousScreen, installBlenderAddon, openBlenderAddonFolder } from '../core';
</script>

<template>
	<div id="blender-info">
		<div id="blender-info-header">
			<h1>Installing the wow.export Add-on for Blender 2.8+</h1>
			<p>Blender users can make use of our special importer add-on which makes importing advanced objects as simple as a single click. WMO objects are imported with any exported doodad sets included. ADT map tiles are imported complete with all WMOs and doodads positioned as they would be in-game.</p>
		</div>
		<div id="blender-info-buttons">
			<input type="button" value="Install Automatically (Recommended)" @click="installBlenderAddon" :class="{ disabled: state.isBusy }"/>
			<input type="button" value="Install Manually (Advanced)" @click="openBlenderAddonFolder"/>
			<input type="button" value="Go Back" @click="showPreviousScreen"/>
		</div>
	</div>
</template>