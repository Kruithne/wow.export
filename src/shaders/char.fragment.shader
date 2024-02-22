precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_texture;
uniform float u_blendMode;

void main() {
	if(u_blendMode == 0.0 || u_blendMode == 1.0 || u_blendMode == 9.0 || u_blendMode == 15.0) {
		gl_FragColor = texture2D(u_texture, v_texCoord);
	}else{
		gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
	}
}