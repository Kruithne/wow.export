import { ref } from "vue";

let state = null;

export default function() {
	if (state != null)
		return state;

	const selectedFileDataID = ref(0);
	const texturePreviewURL = ref(''); // Active URL of the texture preview image.
	const overrideTextureList = ref([]); // Override list of textures.
	const overrideTextureName = ref(''); // Override texture name.
	const userInputFilterTextures = ref(''); // Value of the 'filter' field for textures.
	const selectionTextures = ref([]); // Current user selection of texture files.
	const texturePreviewWidth = ref(256); // Active width of the texture preview.
	const texturePreviewHeight = ref(256); // Active height of the texture preview.
	const texturePreviewInfo = ref(''); // Text information for a displayed texture.

	state = {
		selectedFileDataID,
		texturePreviewURL,
		overrideTextureList,
		overrideTextureName,
		userInputFilterTextures,
		selectionTextures,
		texturePreviewWidth,
		texturePreviewHeight,
		texturePreviewInfo,
	};

	return state;
}
