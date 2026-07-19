import type { PanoramaExtent } from './metadata';
import { clampFov, perspectiveCameraBasis } from './perspective';

const VERTEX_SHADER = `#version 300 es
precision highp float;

out vec2 v_uv;

void main() {
  vec2 positions[3] = vec2[3](
    vec2(-1.0, -1.0),
    vec2(3.0, -1.0),
    vec2(-1.0, 3.0)
  );
  vec2 position = positions[gl_VertexID];
  v_uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 out_color;

uniform sampler2D u_panorama;
uniform vec4 u_extent;
uniform vec3 u_forward;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec2 u_frustum;
uniform float u_center_yaw;

const float PI = 3.14159265358979323846;
const float TAU = 6.28318530717958647692;

void main() {
  vec2 ndc = v_uv * 2.0 - 1.0;
  vec3 direction = normalize(
    u_forward
      + u_right * (ndc.x * u_frustum.x)
      + u_up * (ndc.y * u_frustum.y)
  );

  float source_yaw = atan(direction.x, direction.z);
  float yaw_delta = source_yaw - u_center_yaw;
  if (yaw_delta > PI) source_yaw -= TAU;
  if (yaw_delta < -PI) source_yaw += TAU;
  float source_pitch = asin(clamp(direction.y, -1.0, 1.0));

  float source_u = (source_yaw - u_extent.x) / u_extent.y;
  float source_v = (source_pitch - u_extent.z) / u_extent.w;
  if (source_u < 0.0 || source_u > 1.0 || source_v < 0.0 || source_v > 1.0) {
    out_color = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  out_color = texture(u_panorama, vec2(source_u, source_v));
}
`;

export interface PerspectiveRenderOptions {
  width: number;
  height: number;
  pixelRatio: number;
  yaw: number;
  pitch: number;
  fovDegrees: number;
  tilt: number;
  roll: number;
  extent: PanoramaExtent;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Could not allocate a WebGL shader');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'unknown shader compilation error';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) {
    throw new Error('Could not allocate a WebGL program');
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'unknown WebGL link error';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function requiredUniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (!location) {
    throw new Error(`Perspective shader uniform is missing: ${name}`);
  }
  return location;
}

export class PerspectiveRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vertexArray: WebGLVertexArrayObject;
  private readonly texture: WebGLTexture;
  private readonly extentUniform: WebGLUniformLocation;
  private readonly forwardUniform: WebGLUniformLocation;
  private readonly rightUniform: WebGLUniformLocation;
  private readonly upUniform: WebGLUniformLocation;
  private readonly frustumUniform: WebGLUniformLocation;
  private readonly centerYawUniform: WebGLUniformLocation;
  private textureWidth = 0;
  private textureHeight = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
    });
    if (!gl) {
      throw new Error('WebGL 2 is unavailable');
    }
    this.gl = gl;
    this.program = createProgram(gl);
    this.extentUniform = requiredUniform(gl, this.program, 'u_extent');
    this.forwardUniform = requiredUniform(gl, this.program, 'u_forward');
    this.rightUniform = requiredUniform(gl, this.program, 'u_right');
    this.upUniform = requiredUniform(gl, this.program, 'u_up');
    this.frustumUniform = requiredUniform(gl, this.program, 'u_frustum');
    this.centerYawUniform = requiredUniform(gl, this.program, 'u_center_yaw');

    const vertexArray = gl.createVertexArray();
    const texture = gl.createTexture();
    if (!vertexArray || !texture) {
      throw new Error('Could not allocate perspective renderer resources');
    }
    this.vertexArray = vertexArray;
    this.texture = texture;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vertexArray);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.uniform1i(requiredUniform(gl, this.program, 'u_panorama'), 0);
    gl.clearColor(0, 0, 0, 1);
  }

  render(video: HTMLVideoElement, options: PerspectiveRenderOptions): void {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }
    const gl = this.gl;
    const width = Math.max(1, Math.round(options.width * options.pixelRatio));
    const height = Math.max(1, Math.round(options.height * options.pixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vertexArray);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (this.textureWidth !== video.videoWidth || this.textureHeight !== video.videoHeight) {
      this.textureWidth = video.videoWidth;
      this.textureHeight = video.videoHeight;
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        this.textureWidth,
        this.textureHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
    }
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      video,
    );

    const extent = options.extent;
    gl.uniform4f(
      this.extentUniform,
      extent.yaw_min,
      extent.yaw_max - extent.yaw_min,
      extent.pitch_min,
      extent.pitch_max - extent.pitch_min,
    );
    const basis = perspectiveCameraBasis({
      yaw: options.yaw,
      pitch: options.pitch,
      fovDegrees: options.fovDegrees,
      aspect: options.width / options.height,
      tilt: options.tilt,
      roll: options.roll,
    });
    gl.uniform3f(
      this.forwardUniform,
      basis.forward.x,
      basis.forward.y,
      basis.forward.z,
    );
    gl.uniform3f(this.rightUniform, basis.right.x, basis.right.y, basis.right.z);
    gl.uniform3f(this.upUniform, basis.up.x, basis.up.y, basis.up.z);
    const tanHalfVerticalFov = Math.tan((clampFov(options.fovDegrees) * Math.PI) / 360);
    gl.uniform2f(
      this.frustumUniform,
      tanHalfVerticalFov * (options.width / options.height),
      tanHalfVerticalFov,
    );
    gl.uniform1f(
      this.centerYawUniform,
      Math.atan2(basis.forward.x, basis.forward.z),
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    this.gl.deleteTexture(this.texture);
    this.gl.deleteVertexArray(this.vertexArray);
    this.gl.deleteProgram(this.program);
  }
}
