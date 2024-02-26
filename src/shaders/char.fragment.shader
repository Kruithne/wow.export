precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_baseTexture;
uniform sampler2D u_texture;
uniform float u_blendMode;

void main() {
	if(u_blendMode == 0.0 || u_blendMode == 1.0 || u_blendMode == 9.0 || u_blendMode == 15.0) {
		gl_FragColor = texture2D(u_texture, v_texCoord);
	}else if(u_blendMode == 4.0) { // MULTIPLY
		vec4 base = texture2D(u_baseTexture, v_texCoord);
		vec4 blend = texture2D(u_texture, v_texCoord);
		gl_FragColor = base * blend;
	} else if (u_blendMode == 7.0) { // SCREEN
		vec4 base = texture2D(u_baseTexture, v_texCoord);
		vec4 blend = texture2D(u_texture, v_texCoord);
		vec4 result;
		result.rgb = 1.0 - (1.0 - base.rgb) * (1.0 - blend.rgb);
		result.a = blend.a;
		gl_FragColor = result;
	} else if (u_blendMode == 6.0) { // OVERLAY
		vec4 base = texture2D(u_baseTexture, v_texCoord);
		vec4 blend = texture2D(u_texture, v_texCoord);
		vec4 result;
		result.r = (blend.r < 0.5) ? (2.0 * base.r * blend.r) : (1.0 - 2.0 * (1.0 - base.r) * (1.0 - blend.r));
		result.g = (blend.g < 0.5) ? (2.0 * base.g * blend.g) : (1.0 - 2.0 * (1.0 - base.g) * (1.0 - blend.g));
		result.b = (blend.b < 0.5) ? (2.0 * base.b * blend.b) : (1.0 - 2.0 * (1.0 - base.b) * (1.0 - blend.b));
		result.a = blend.a;
		gl_FragColor = result;
	}else{
		gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
	}
}