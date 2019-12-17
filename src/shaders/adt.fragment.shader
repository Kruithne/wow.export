precision highp float;

varying highp vec2 vTextureCoord;

uniform vec4 pc_heightScale;
uniform vec4 pc_heightOffset;

uniform sampler2D pt_layer0;
uniform sampler2D pt_layer1;
uniform sampler2D pt_layer2;
uniform sampler2D pt_layer3;

uniform float layerScale0;
uniform float layerScale1;
uniform float layerScale2;
uniform float layerScale3;

uniform sampler2D pt_height0;
uniform sampler2D pt_height1;
uniform sampler2D pt_height2;
uniform sampler2D pt_height3;

uniform sampler2D pt_blend1;
uniform sampler2D pt_blend2;
uniform sampler2D pt_blend3;

uniform vec4 vertexColor;

void main() {
	vec2 tc0 = vTextureCoord * (8.0 / layerScale0);
	vec2 tc1 = vTextureCoord * (8.0 / layerScale1);
	vec2 tc2 = vTextureCoord * (8.0 / layerScale2);
	vec2 tc3 = vTextureCoord * (8.0 / layerScale3);

	float blendTex0 = texture2D(pt_blend1, vTextureCoord).r;
	float blendTex1 = texture2D(pt_blend2, vTextureCoord).r;
	float blendTex2 = texture2D(pt_blend3, vTextureCoord).r;

	vec3 blendTex = vec3(blendTex0, blendTex1, blendTex2);

	vec4 layerWeights = vec4(1.0 - clamp(dot(vec3(1.0), blendTex), 0.0, 1.0), blendTex);
	vec4 layerPct = vec4(
		layerWeights.x * (texture2D(pt_height0, tc0).a * pc_heightScale[0] + pc_heightOffset[0]),
		layerWeights.y * (texture2D(pt_height1, tc1).a * pc_heightScale[1] + pc_heightOffset[1]),
		layerWeights.z * (texture2D(pt_height2, tc2).a * pc_heightScale[2] + pc_heightOffset[2]),
		layerWeights.w * (texture2D(pt_height3, tc3).a * pc_heightScale[3] + pc_heightOffset[3])
	);

	vec4 layerPctMax = vec4(max(max(layerPct.x, layerPct.y), max(layerPct.z, layerPct.w)));
	layerPct = layerPct * (vec4(1.0) - clamp(layerPctMax - layerPct, 0.0, 1.0));
	layerPct = layerPct / vec4(dot(vec4(1.0), layerPct));

	vec4 weightedLayer_0 = texture2D(pt_layer0, tc0) * layerPct.x;
	vec4 weightedLayer_1 = texture2D(pt_layer1, tc1) * layerPct.y;
	vec4 weightedLayer_2 = texture2D(pt_layer2, tc2) * layerPct.z;
	vec4 weightedLayer_3 = texture2D(pt_layer3, tc3) * layerPct.w;

	//gl_FragColor = vec4((weightedLayer_0.xyz + weightedLayer_1.xyz + weightedLayer_2.xyz + weightedLayer_3.xyz) * vertexColor.rgb * 2.0, 1.0);
	gl_FragColor = texture2D(pt_blend1, vTextureCoord);
	//gl_FragColor = vertexColor;
}