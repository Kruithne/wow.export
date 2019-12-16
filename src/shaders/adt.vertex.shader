attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;

varying highp vec2 vTextureCoord;

void main() {
  gl_Position = vec4(aVertexPosition.x, aVertexPosition.y, 0.0, 1.0);
  vTextureCoord = aTextureCoord;
}