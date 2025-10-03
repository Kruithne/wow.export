#version 300 es

in vec3 aVertexPosition;
in vec2 aTextureCoord;
in vec4 aVertexColor;

out highp vec2 vTextureCoord;
out vec4 vVertexColor;

uniform vec2 uTranslation;
uniform vec2 uResolution;
uniform float uZoom;

void main() {
	vec2 position = vec2(aVertexPosition.x, aVertexPosition.z) + uTranslation;
	vec2 zeroToOne = position / uResolution;
	vec2 zeroToTwo = zeroToOne * 2.0;
	vec2 clipSpace = zeroToTwo - 1.0;
	gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, uZoom);
	vTextureCoord = aTextureCoord * vec2(16.0, -16.0);
	vVertexColor = aVertexColor;
}