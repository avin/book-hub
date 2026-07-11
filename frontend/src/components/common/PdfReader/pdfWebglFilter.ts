import {
  pdfSoftTextEnhancementDefaults,
  pdfTextEnhancementDefaults,
  pdfVisualAdjustmentDefaults,
  type PdfFilterChain,
} from './pdfFilters';

const noPdfFilterType = 0;
const textEnhancementPdfFilterType = 1;
const invertPdfFilterType = 2;
const visualAdjustmentPdfFilterType = 3;
const warmthPdfFilterType = 4;
const grayscalePdfFilterType = 5;
const softTextEnhancementPdfFilterType = 6;
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
  uniform int u_firstFilter;
  uniform int u_secondFilter;
  uniform int u_thirdFilter;
  uniform int u_fourthFilter;
  uniform int u_fifthFilter;
  uniform int u_sixthFilter;
  uniform vec2 u_texelSize;
  uniform float u_strokeWidth;
  uniform float u_threshold;
  uniform float u_contrast;
  uniform float u_grayLevels;
  uniform float u_toneShift;
  uniform float u_invertStrength;
  uniform float u_brightness;
  uniform float u_visualContrast;
  uniform float u_gamma;
  uniform float u_warmthStrength;
  uniform float u_grayscaleStrength;
  uniform float u_softStrokeWidth;
  uniform float u_softStrength;
  varying vec2 v_texturePosition;

  const int FILTER_NONE = 0;
  const int FILTER_TEXT_ENHANCEMENT = 1;
  const int FILTER_INVERT = 2;
  const int FILTER_VISUAL_ADJUSTMENT = 3;
  const int FILTER_WARMTH = 4;
  const int FILTER_GRAYSCALE = 5;
  const int FILTER_SOFT_TEXT_ENHANCEMENT = 6;

  float luminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  vec4 applyTextEnhancement(vec4 source) {
    float darkest = luminance(source.rgb);
    float radius = min(u_strokeWidth, 2.0);

    for (int x = -2; x <= 2; x += 1) {
      for (int y = -2; y <= 2; y += 1) {
        if (abs(float(x)) + abs(float(y)) <= radius) {
          vec2 offset = vec2(float(x), float(y)) * u_texelSize;
          darkest = min(darkest, luminance(texture2D(u_image, v_texturePosition + offset).rgb));
        }
      }
    }

    float contrasted = clamp((darkest - 0.5) * u_contrast + 0.5, 0.0, 1.0);
    float levels = max(u_grayLevels - 1.0, 1.0);
    float quantized = floor(contrasted * levels + 0.5) / levels;
    float shiftedThreshold = clamp(u_threshold + u_toneShift * 0.25, 0.0, 1.0);
    float edge = max(0.002, 0.03 / max(u_strokeWidth, 0.05));
    float enhanced = smoothstep(shiftedThreshold - edge, shiftedThreshold + edge, quantized);

    return vec4(vec3(enhanced), source.a);
  }

  vec4 applySoftTextEnhancement(vec4 source) {
    float currentInk = 1.0 - luminance(source.rgb);
    float strongestInk = currentInk;
    float radius = max(u_softStrokeWidth, 0.0);
    vec2 horizontal = vec2(radius, 0.0) * u_texelSize;
    vec2 vertical = vec2(0.0, radius) * u_texelSize;
    vec2 diagonal = vec2(radius * 0.70710678) * u_texelSize;

    strongestInk = max(strongestInk, 1.0 - luminance(texture2D(u_image, v_texturePosition + horizontal).rgb));
    strongestInk = max(strongestInk, 1.0 - luminance(texture2D(u_image, v_texturePosition - horizontal).rgb));
    strongestInk = max(strongestInk, 1.0 - luminance(texture2D(u_image, v_texturePosition + vertical).rgb));
    strongestInk = max(strongestInk, 1.0 - luminance(texture2D(u_image, v_texturePosition - vertical).rgb));
    strongestInk = max(strongestInk, 1.0 - luminance(texture2D(u_image, v_texturePosition + diagonal).rgb));
    strongestInk = max(strongestInk, 1.0 - luminance(texture2D(u_image, v_texturePosition - diagonal).rgb));
    strongestInk = max(strongestInk, 1.0 - luminance(texture2D(u_image, v_texturePosition + vec2(diagonal.x, -diagonal.y)).rgb));
    strongestInk = max(strongestInk, 1.0 - luminance(texture2D(u_image, v_texturePosition + vec2(-diagonal.x, diagonal.y)).rgb));

    float darkening = max(strongestInk - currentInk, 0.0) * u_softStrength;
    source.rgb = clamp(source.rgb - vec3(darkening), 0.0, 1.0);
    return source;
  }

  vec4 applyFilter(vec4 color, int filterId) {
    if (filterId == FILTER_TEXT_ENHANCEMENT) {
      return applyTextEnhancement(color);
    }

    if (filterId == FILTER_SOFT_TEXT_ENHANCEMENT) {
      return applySoftTextEnhancement(color);
    }

    if (filterId == FILTER_INVERT) {
      vec3 inverted = vec3(1.0) - color.rgb;
      color.rgb = mix(color.rgb, inverted, u_invertStrength);
    }

    if (filterId == FILTER_VISUAL_ADJUSTMENT) {
      color.rgb = clamp((color.rgb - 0.5) * u_visualContrast + 0.5 + u_brightness, 0.0, 1.0);
      color.rgb = pow(color.rgb, vec3(1.0 / u_gamma));
    }

    if (filterId == FILTER_WARMTH) {
      vec3 warmed = color.rgb * vec3(1.08, 1.02, 0.84);
      color.rgb = mix(color.rgb, clamp(warmed, 0.0, 1.0), u_warmthStrength);
    }

    if (filterId == FILTER_GRAYSCALE) {
      vec3 gray = vec3(luminance(color.rgb));
      color.rgb = mix(color.rgb, gray, u_grayscaleStrength);
    }

    return color;
  }

  void main() {
    vec4 color = texture2D(u_image, v_texturePosition);
    color = applyFilter(color, u_firstFilter);
    color = applyFilter(color, u_secondFilter);
    color = applyFilter(color, u_thirdFilter);
    color = applyFilter(color, u_fourthFilter);
    color = applyFilter(color, u_fifthFilter);
    color = applyFilter(color, u_sixthFilter);
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
  const firstFilterLocation = gl.getUniformLocation(program, 'u_firstFilter');
  const secondFilterLocation = gl.getUniformLocation(program, 'u_secondFilter');
  const thirdFilterLocation = gl.getUniformLocation(program, 'u_thirdFilter');
  const fourthFilterLocation = gl.getUniformLocation(program, 'u_fourthFilter');
  const fifthFilterLocation = gl.getUniformLocation(program, 'u_fifthFilter');
  const sixthFilterLocation = gl.getUniformLocation(program, 'u_sixthFilter');
  const texelSizeLocation = gl.getUniformLocation(program, 'u_texelSize');
  const strokeWidthLocation = gl.getUniformLocation(program, 'u_strokeWidth');
  const thresholdLocation = gl.getUniformLocation(program, 'u_threshold');
  const contrastLocation = gl.getUniformLocation(program, 'u_contrast');
  const grayLevelsLocation = gl.getUniformLocation(program, 'u_grayLevels');
  const toneShiftLocation = gl.getUniformLocation(program, 'u_toneShift');
  const invertStrengthLocation = gl.getUniformLocation(program, 'u_invertStrength');
  const brightnessLocation = gl.getUniformLocation(program, 'u_brightness');
  const visualContrastLocation = gl.getUniformLocation(program, 'u_visualContrast');
  const gammaLocation = gl.getUniformLocation(program, 'u_gamma');
  const warmthStrengthLocation = gl.getUniformLocation(program, 'u_warmthStrength');
  const grayscaleStrengthLocation = gl.getUniformLocation(program, 'u_grayscaleStrength');
  const softStrokeWidthLocation = gl.getUniformLocation(program, 'u_softStrokeWidth');
  const softStrengthLocation = gl.getUniformLocation(program, 'u_softStrength');
  const imageLocation = gl.getUniformLocation(program, 'u_image');
  const positionBuffer = gl.createBuffer();
  const texturePositionBuffer = gl.createBuffer();
  const texture = gl.createTexture();

  if (
    positionLocation < 0 ||
    texturePositionLocation < 0 ||
    !firstFilterLocation ||
    !secondFilterLocation ||
    !thirdFilterLocation ||
    !fourthFilterLocation ||
    !fifthFilterLocation ||
    !sixthFilterLocation ||
    !texelSizeLocation ||
    !strokeWidthLocation ||
    !thresholdLocation ||
    !contrastLocation ||
    !grayLevelsLocation ||
    !toneShiftLocation ||
    !invertStrengthLocation ||
    !brightnessLocation ||
    !visualContrastLocation ||
    !gammaLocation ||
    !warmthStrengthLocation ||
    !grayscaleStrengthLocation ||
    !softStrokeWidthLocation ||
    !softStrengthLocation ||
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

      const filterType = (filter: (typeof chain)[number] | undefined) => {
        if (!filter?.enabled) {
          return noPdfFilterType;
        }

        switch (filter.id) {
          case 'textEnhancement':
            return textEnhancementPdfFilterType;
          case 'invert':
            return invertPdfFilterType;
          case 'visualAdjustment':
            return visualAdjustmentPdfFilterType;
          case 'warmth':
            return warmthPdfFilterType;
          case 'grayscale':
            return grayscalePdfFilterType;
          case 'softTextEnhancement':
            return softTextEnhancementPdfFilterType;
        }
      };
      const firstFilter = chain[0];
      const secondFilter = chain[1];
      const thirdFilter = chain[2];
      const fourthFilter = chain[3];
      const fifthFilter = chain[4];
      const sixthFilter = chain[5];
      const enhancementFilter = chain.find((filter) => filter.id === 'textEnhancement');
      const softEnhancementFilter = chain.find((filter) => filter.id === 'softTextEnhancement');
      const invertFilter = chain.find((filter) => filter.id === 'invert');
      const visualAdjustmentFilter = chain.find((filter) => filter.id === 'visualAdjustment');
      const warmthFilter = chain.find((filter) => filter.id === 'warmth');
      const grayscaleFilter = chain.find((filter) => filter.id === 'grayscale');

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
      gl.uniform1i(firstFilterLocation, filterType(firstFilter));
      gl.uniform1i(secondFilterLocation, filterType(secondFilter));
      gl.uniform1i(thirdFilterLocation, filterType(thirdFilter));
      gl.uniform1i(fourthFilterLocation, filterType(fourthFilter));
      gl.uniform1i(fifthFilterLocation, filterType(fifthFilter));
      gl.uniform1i(sixthFilterLocation, filterType(sixthFilter));
      gl.uniform2f(texelSizeLocation, 1 / source.width, 1 / source.height);
      gl.uniform1f(
        strokeWidthLocation,
        enhancementFilter?.strokeWidth ?? pdfTextEnhancementDefaults.strokeWidth,
      );
      gl.uniform1f(
        thresholdLocation,
        enhancementFilter?.threshold ?? pdfTextEnhancementDefaults.threshold,
      );
      gl.uniform1f(
        contrastLocation,
        enhancementFilter?.contrast ?? pdfTextEnhancementDefaults.contrast,
      );
      gl.uniform1f(
        grayLevelsLocation,
        enhancementFilter?.grayLevels ?? pdfTextEnhancementDefaults.grayLevels,
      );
      gl.uniform1f(
        toneShiftLocation,
        enhancementFilter?.toneShift ?? pdfTextEnhancementDefaults.toneShift,
      );
      gl.uniform1f(invertStrengthLocation, invertFilter?.enabled ? invertFilter.strength : 0);
      gl.uniform1f(
        brightnessLocation,
        visualAdjustmentFilter?.brightness ?? pdfVisualAdjustmentDefaults.brightness,
      );
      gl.uniform1f(
        visualContrastLocation,
        visualAdjustmentFilter?.contrast ?? pdfVisualAdjustmentDefaults.contrast,
      );
      gl.uniform1f(
        gammaLocation,
        visualAdjustmentFilter?.gamma ?? pdfVisualAdjustmentDefaults.gamma,
      );
      gl.uniform1f(warmthStrengthLocation, warmthFilter?.enabled ? warmthFilter.strength : 0);
      gl.uniform1f(
        grayscaleStrengthLocation,
        grayscaleFilter?.enabled ? grayscaleFilter.strength : 0,
      );
      gl.uniform1f(
        softStrokeWidthLocation,
        softEnhancementFilter?.strokeWidth ?? pdfSoftTextEnhancementDefaults.strokeWidth,
      );
      gl.uniform1f(
        softStrengthLocation,
        softEnhancementFilter?.enabled
          ? softEnhancementFilter.strength
          : pdfSoftTextEnhancementDefaults.strength,
      );
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
