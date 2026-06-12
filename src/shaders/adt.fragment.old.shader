#version 300 es
precision highp float;
precision highp sampler2DArray;

in highp vec2 vTextureCoord;
in vec4 vVertexColor;

out vec4 fragColor;

uniform int uLayerCount;
uniform sampler2DArray uDiffuseLayers;
uniform sampler2DArray uHeightLayers;
uniform sampler2D uAlphaBlend0;
uniform sampler2D uAlphaBlend1;
uniform sampler2D uAlphaBlend2;
uniform sampler2D uAlphaBlend3;
uniform sampler2D uAlphaBlend4;
uniform sampler2D uAlphaBlend5;
uniform sampler2D uAlphaBlend6;

uniform float uLayerScales[8];
uniform float uHeightScales[8];
uniform float uHeightOffsets[8];
uniform float uDiffuseIndices[8];
uniform float uHeightIndices[8];

void main() {
	float alphas[8];
	alphas[0] = 1.0;
	alphas[1] = uLayerCount > 1 ? texture(uAlphaBlend0, mod(vTextureCoord, 1.0)).r : 0.0;
	alphas[2] = uLayerCount > 2 ? texture(uAlphaBlend1, mod(vTextureCoord, 1.0)).r : 0.0;
	alphas[3] = uLayerCount > 3 ? texture(uAlphaBlend2, mod(vTextureCoord, 1.0)).r : 0.0;
	alphas[4] = uLayerCount > 4 ? texture(uAlphaBlend3, mod(vTextureCoord, 1.0)).r : 0.0;
	alphas[5] = uLayerCount > 5 ? texture(uAlphaBlend4, mod(vTextureCoord, 1.0)).r : 0.0;
	alphas[6] = uLayerCount > 6 ? texture(uAlphaBlend5, mod(vTextureCoord, 1.0)).r : 0.0;
	alphas[7] = uLayerCount > 7 ? texture(uAlphaBlend6, mod(vTextureCoord, 1.0)).r : 0.0;

	float overlay_sum = alphas[1] + alphas[2] + alphas[3] + alphas[4] + alphas[5] + alphas[6] + alphas[7];
	alphas[0] = 1.0 - clamp(overlay_sum, 0.0, 1.0);

	vec3 final_color = vec3(0.0);
	float weight_sum = 0.0;
	for (int i = 0; i < 8; i++) {
		if (i >= uLayerCount)
			break;

		vec2 tc = vTextureCoord * (8.0 / uLayerScales[i]);
		final_color += texture(uDiffuseLayers, vec3(tc, uDiffuseIndices[i])).rgb * alphas[i];
		weight_sum += alphas[i];
	}
	final_color /= weight_sum; // weight_sum == max(1, overlay_sum), never zero

	fragColor = vec4(final_color * vVertexColor.rgb * 2.0, 1.0);
}
