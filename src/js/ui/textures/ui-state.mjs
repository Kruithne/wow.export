import { ref } from "vue";

let shared = null;

export default function() {
	if (shared != null)
		return shared;

	const texturePreviewURL = ref(''); // Active URL of the texture preview image.

	shared = {
		texturePreviewURL,
	};

	return shared;
}
