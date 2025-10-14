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

	vec3 alpha_sum = vec3(
		alphas[1] + alphas[2] + alphas[3] + alphas[4] + alphas[5] + alphas[6] + alphas[7]
	);

	float layer_weights[8];
	layer_weights[0] = 1.0 - clamp(alpha_sum.x, 0.0, 1.0);
	for (int i = 1; i < 8; i++)
		layer_weights[i] = alphas[i];

	float layer_pcts[8];
	for (int i = 0; i < 8; i++) {
		vec2 tc = vTextureCoord * (8.0 / uLayerScales[i]);
		float height_val = texture(uHeightLayers, vec3(tc, uHeightIndices[i])).a;
		layer_pcts[i] = layer_weights[i] * (height_val * uHeightScales[i] + uHeightOffsets[i]);
	}

	float max_pct = 0.0;
	for (int i = 0; i < 8; i++)
		max_pct = max(max_pct, layer_pcts[i]);

	for (int i = 0; i < 8; i++)
		layer_pcts[i] = layer_pcts[i] * (1.0 - clamp(max_pct - layer_pcts[i], 0.0, 1.0));

	float pct_sum = 0.0;
	for (int i = 0; i < 8; i++)
		pct_sum += layer_pcts[i];

	for (int i = 0; i < 8; i++)
		layer_pcts[i] = layer_pcts[i] / pct_sum;

	vec3 final_color = vec3(0.0);
	for (int i = 0; i < 8; i++) {
		vec2 tc = vTextureCoord * (8.0 / uLayerScales[i]);
		vec4 layer_sample = texture(uDiffuseLayers, vec3(tc, uDiffuseIndices[i]));
		final_color += layer_sample.rgb * layer_pcts[i];
	}

	fragColor = vec4(final_color * vVertexColor.rgb * 2.0, 1.0);
}
