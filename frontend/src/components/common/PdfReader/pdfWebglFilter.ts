import type { PdfFilterChain } from './pdfFilters';
import { invertFilterFromChain } from './pdfFilters';

const vertexShaderSource = `
  attribute vec2 a_position;
  attribute vec2 a_texturePosition;
  varying vec2 v_texturePosition;

  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texturePosition = a_texturePosition;
  }
`;

const fragmentShaderSource = `
  precision mediump float;

  uniform sampler2D u_image;
  uniform float u_invertStrength;
  varying vec2 v_texturePosition;

  void main() {
    vec4 color = texture2D(u_image, v_texturePosition);
    vec3 inverted = vec3(1.0) - color.rgb;
    color.rgb = mix(color.rgb, inverted, u_invertStrength);
    gl_FragColor = color;
  }
`;

type PdfWebglFilterRenderer = {
  render: (source: HTMLCanvasElement, chain: PdfFilterChain) => void;
  destroy: () => void;
};

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);

  if (!shader) {
    throw new Error('Не удалось создать WebGL shader.');
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'Неизвестная ошибка компиляции shader.';
    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
}

function createProgram(gl: WebGLRenderingContext) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  const program = gl.createProgram();

  if (!program) {
    throw new Error('Не удалось создать WebGL program.');
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'Неизвестная ошибка линковки WebGL program.';
    gl.deleteProgram(program);
    throw new Error(message);
  }

  return program;
}

function getWebglContext(canvas: HTMLCanvasElement) {
  return canvas.getContext('webgl', {
    alpha: true,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  });
}

export function isPdfWebglAvailable() {
  const canvas = document.createElement('canvas');

  return getWebglContext(canvas) !== null;
}

export function createPdfWebglFilterRenderer(canvas: HTMLCanvasElement): PdfWebglFilterRenderer {
  const gl = getWebglContext(canvas);

  if (!gl) {
    throw new Error('WebGL недоступен в этом браузере.');
  }

  const program = createProgram(gl);
  const positionLocation = gl.getAttribLocation(program, 'a_position');
  const texturePositionLocation = gl.getAttribLocation(program, 'a_texturePosition');
  const invertStrengthLocation = gl.getUniformLocation(program, 'u_invertStrength');
  const imageLocation = gl.getUniformLocation(program, 'u_image');
  const positionBuffer = gl.createBuffer();
  const texturePositionBuffer = gl.createBuffer();
  const texture = gl.createTexture();

  if (
    positionLocation < 0 ||
    texturePositionLocation < 0 ||
    !invertStrengthLocation ||
    !imageLocation ||
    !positionBuffer ||
    !texturePositionBuffer ||
    !texture
  ) {
    gl.deleteProgram(program);
    throw new Error('WebGL не поддерживает необходимые операции фильтрации.');
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.bindBuffer(gl.ARRAY_BUFFER, texturePositionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]),
    gl.STATIC_DRAW,
  );
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return {
    render(source, chain) {
      if (gl.isContextLost()) {
        throw new Error('WebGL-контекст фильтра страницы был потерян.');
      }

      const invertFilter = invertFilterFromChain(chain);
      const invertStrength = invertFilter?.enabled ? invertFilter.strength : 0;

      gl.viewport(0, 0, source.width, source.height);
      gl.useProgram(program);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      const textureUploadError = gl.getError();

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, texturePositionBuffer);
      gl.enableVertexAttribArray(texturePositionLocation);
      gl.vertexAttribPointer(texturePositionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(invertStrengthLocation, invertStrength);
      gl.uniform1i(imageLocation, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      const drawError = gl.getError();

      if (textureUploadError !== gl.NO_ERROR || drawError !== gl.NO_ERROR) {
        throw new Error('WebGL завершил обработку страницы с ошибкой.');
      }
    },
    destroy() {
      gl.deleteTexture(texture);
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(texturePositionBuffer);
      gl.deleteProgram(program);
    },
  };
}
