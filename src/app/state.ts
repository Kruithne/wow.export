/* Copyright (c) wow.export contributors. All rights reserved. */
/* Licensed under the MIT license. See LICENSE in project root for license information. */
import { defineComponent } from 'vue';

const stateContainer: { state: ReturnType<typeof defineComponent> | null } = {
	state: null
};

export default stateContainer;