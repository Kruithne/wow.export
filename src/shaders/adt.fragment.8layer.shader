#version 300 es
precision highp float;

in highp vec2 vTextureCoord;
in vec4 vVertexColor;

out vec4 fragColor;

uniform vec4 pc_heightScale[2];   // 8 values across 2 vec4s
uniform vec4 pc_heightOffset[2];  // 8 values across 2 vec4s

uniform highp sampler2DArray diffuseArray;  // 8 diffuse textures
uniform highp sampler2DArray heightArray;   // 8 height textures (if enabled)

uniform float layerScale[8];
uniform int layerTextureIds[8];  // Maps layer index to texture array index

uniform sampler2D pt_blend1;  // RGB for layers 1,2,3
uniform sampler2D pt_blend2;  // RGB for layers 4,5,6
uniform sampler2D pt_blend3;  // R for layer 7

void main() {
	vec2 tc[8];
	for (int i = 0; i < 8; i++) {
		tc[i] = vTextureCoord * (8.0 / layerScale[i]);
	}

	vec3 blend1 = texture(pt_blend1, mod(vTextureCoord, 1.0)).rgb;
	vec3 blend2 = texture(pt_blend2, mod(vTextureCoord, 1.0)).rgb;
	float blend3 = texture(pt_blend3, mod(vTextureCoord, 1.0)).r;

	// combine into 7 blend weights for layers 1-7
	float blendWeights[7] = float[7](
		blend1.r, blend1.g, blend1.b,
		blend2.r, blend2.g, blend2.b,
		blend3
	);

	// calculate layer 0 (base) weight
	float totalBlend = 0.0;
	for (int i = 0; i < 7; i++) {
		totalBlend += blendWeights[i];
	}

	float layerWeights[8];
	layerWeights[0] = 1.0 - clamp(totalBlend, 0.0, 1.0);
	for (int i = 1; i < 8; i++) {
		layerWeights[i] = blendWeights[i - 1];
	}

	// apply height-based blending
	float layerPct[8];
	for (int i = 0; i < 8; i++) {
		int scaleIdx = i / 4;  // 0 for layers 0-3, 1 for layers 4-7
		int vecIdx = i % 4;    // 0-3 within the vec4
		int texIndex = layerTextureIds[i];

		float heightSample = texture(heightArray, vec3(tc[i], float(texIndex))).a;
		float heightScale = pc_heightScale[scaleIdx][vecIdx];
		float heightOffset = pc_heightOffset[scaleIdx][vecIdx];

		layerPct[i] = layerWeights[i] * (heightSample * heightScale + heightOffset);
	}

	// normalize using max-based smoothing
	float maxPct = layerPct[0];
	for (int i = 1; i < 8; i++) {
		maxPct = max(maxPct, layerPct[i]);
	}

	for (int i = 0; i < 8; i++) {
		layerPct[i] = layerPct[i] * (1.0 - clamp(maxPct - layerPct[i], 0.0, 1.0));
	}

	// normalize to sum to 1.0
	float totalPct = 0.0;
	for (int i = 0; i < 8; i++) {
		totalPct += layerPct[i];
	}

	for (int i = 0; i < 8; i++) {
		layerPct[i] /= totalPct;
	}

	// blend diffuse textures (including alpha channel)
	vec4 finalColor = vec4(0.0);
	for (int i = 0; i < 8; i++) {
		int texIndex = layerTextureIds[i];  // get the actual texture array index
		vec4 diffuseSample = texture(diffuseArray, vec3(tc[i], float(texIndex)));
		finalColor += diffuseSample * layerPct[i];
	}

	fragColor = vec4(finalColor.rgb * vVertexColor.rgb * 2.0, 1.0);
}
