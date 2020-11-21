precision highp float;

varying highp vec2 vTextureCoord;
varying vec4 vVertexColor;

uniform sampler2D pt_layer0;
uniform sampler2D pt_layer1;
uniform sampler2D pt_layer2;
uniform sampler2D pt_layer3;

uniform float layerScale0;
uniform float layerScale1;
uniform float layerScale2;
uniform float layerScale3;

uniform sampler2D pt_blend1;
uniform sampler2D pt_blend2;
uniform sampler2D pt_blend3;

vec3 mixTextures(vec3 tex0, vec3 tex1, float alpha) {
	return (alpha * (tex1.rgb-tex0.rgb) + tex0.rgb);
}

void main() {
	vec2 tc0 = vTextureCoord * (8.0 / layerScale0);
	vec2 tc1 = vTextureCoord * (8.0 / layerScale1);
	vec2 tc2 = vTextureCoord * (8.0 / layerScale2);
	vec2 tc3 = vTextureCoord * (8.0 / layerScale3);

	float blendTex0 = texture2D(pt_blend1, mod(vTextureCoord, 1.0)).r;
	float blendTex1 = texture2D(pt_blend2, mod(vTextureCoord, 1.0)).r;
	float blendTex2 = texture2D(pt_blend3, mod(vTextureCoord, 1.0)).r;

	vec3 tex1 = texture2D(pt_layer0, tc0).rgb;
	vec3 tex2 = texture2D(pt_layer1, tc1).rgb;
	vec3 tex3 = texture2D(pt_layer2, tc2).rgb;
	vec3 tex4 = texture2D(pt_layer3, tc3).rgb;

	vec4 mix = vec4(mixTextures(mixTextures(mixTextures(tex1, tex2, blendTex0), tex3, blendTex1), tex4, blendTex2), 1);
	gl_FragColor = vec4(mix.rgb * vVertexColor.rgb * 2.0, 1);
}