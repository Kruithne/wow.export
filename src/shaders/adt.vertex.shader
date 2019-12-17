attribute vec3 aVertexPosition;
attribute vec2 aTextureCoord;

varying highp vec2 vTextureCoord;
uniform vec2 uTranslation;
uniform vec2 uResolution;

void main() {
	vec2 position = vec2(aVertexPosition.x, aVertexPosition.z) + uTranslation;
	vec2 zeroToOne = position / uResolution;
	vec2 zeroToTwo = zeroToOne * 2.0;
	vec2 clipSpace = zeroToTwo - 1.0;
	gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
	//gl_Position = vec4(position, 0.0, 1.0);
	//gl_Position = vec4(aVertexPosition.x, aVertexPosition.y, aVertexPosition.z, 1.0) + uTranslation;
	vTextureCoord = aTextureCoord * vec2(16.0, -16.0);
}