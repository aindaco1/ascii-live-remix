/**
 * WebGL2 ASCII Renderer
 * Fallback GPU-accelerated rendering supporting video and image sources.
 *
 * Video: texImage2D() per frame
 * Image: texImage2D() once on init
 */

const CELL_PASS_VERT = `#version 300 es
in vec2 a_position;
out vec2 v_texCoord;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_position * 0.5 + 0.5;
}`;

const CELL_PASS_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform vec2 u_gridSize;
uniform float u_saturationBoost;
uniform float u_contrastBoost;
uniform float u_brightness;
uniform float u_gamma;
uniform float u_bgBlend;
uniform int u_quantizeBits;
uniform float u_jitterAmount;
uniform float u_jitterSpeed;
uniform float u_sampleX;
uniform float u_sampleY;
uniform float u_time;
uniform int u_mirrorX;
in vec2 v_texCoord;
out vec4 fragColor;

// Hash for per-cell jitter
float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
    p3 += dot(p3, vec3(p3.y + 33.33, p3.z + 33.33, p3.x + 33.33));
    return fract((p3.x + p3.y) * p3.z);
}

void main() {
    vec2 cellCoord = floor(v_texCoord * u_gridSize);
    vec2 cellCenter = (cellCoord + vec2(u_sampleX, u_sampleY)) / u_gridSize;

    // Jitter sample point within the cell (animated by time)
    vec2 cellSize = 1.0 / u_gridSize;
    vec2 seed = cellCoord + u_time * u_jitterSpeed * vec2(7.13, 11.71);
    float jx = (hash(seed) - 0.5) * cellSize.x * u_jitterAmount;
    float jy = (hash(seed + vec2(37.0, 91.0)) - 0.5) * cellSize.y * u_jitterAmount;
    vec2 sampleUV = clamp(cellCenter + vec2(jx, jy), vec2(0.0), vec2(1.0));
    if (u_mirrorX == 1) {
        sampleUV.x = 1.0 - sampleUV.x;
    }

    vec4 c = texture(u_source, sampleUV);

    float avg = (c.r + c.g + c.b) * 0.333333333;
    vec3 boosted = clamp(vec3(
        avg + (c.r - avg) * u_saturationBoost,
        avg + (c.g - avg) * u_saturationBoost,
        avg + (c.b - avg) * u_saturationBoost
    ), 0.0, 1.0);
    boosted = clamp((boosted - 0.5) * u_contrastBoost + 0.5, 0.0, 1.0);
    boosted = clamp(pow(boosted * u_brightness, vec3(1.0 / max(0.01, u_gamma))), 0.0, 1.0);

    if (u_quantizeBits > 0) {
        float quantum = pow(2.0, float(u_quantizeBits));
        boosted = floor(boosted * 255.0 / quantum) * quantum / 255.0;
    }

    boosted = mix(boosted, vec3(3.0 / 255.0, 4.0 / 255.0, 5.0 / 255.0), clamp(u_bgBlend, 0.0, 1.0));

    fragColor = vec4(boosted, 1.0);
}`;

const RENDER_PASS_VERT = `#version 300 es
in vec2 a_position;
out vec2 v_texCoord;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_position * 0.5 + 0.5;
}`;

const RENDER_PASS_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_cellColors;
uniform vec2 u_gridSize;
uniform vec2 u_cellSize;
uniform vec2 u_canvasSize;
in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    vec2 pixel = v_texCoord * u_canvasSize;
    vec2 cellCoord = floor(pixel / u_cellSize);
    cellCoord = clamp(cellCoord, vec2(0.0), u_gridSize - 1.0);
    vec4 color = texelFetch(u_cellColors, ivec2(cellCoord), 0);
    fragColor = color;
}`;

export class WebGL2Renderer {
    constructor(options = {}) {
        this.source = options.source; // MediaSource object
        this.targetElement = options.targetElement;

        this.cols = options.cols || 120;
        this.fps = options.fps || 24;
        this.frameInterval = 1000 / this.fps;
        this.saturationBoost = options.saturationBoost || 1.4;
        this.contrastBoost = options.contrastBoost || 1.0;
        this.brightness = options.brightness || 1.0;
        this.gamma = options.gamma || 1.0;
        this.bgBlend = options.bgBlend || 0;
        this.quantizeBits = options.quantizeBits || 0;
        this.jitterAmount = options.jitterAmount || 0;
        this.jitterSpeed = options.jitterSpeed || 1;
        this.sampleX = options.sampleX ?? 0.5;
        this.sampleY = options.sampleY ?? 0.5;
        this.rowsOverride = options.rows || 0;
        this.autoRows = options.autoRows !== false;
        this.aspectCorrection = options.aspectCorrection || 1;
        this.smoothing = options.smoothing !== false;
        this.cellWidth = options.cellWidth || 8;
        this.cellHeight = options.cellHeight || 12;
        this.mirrorX = options.mirrorX === true;
        this.preserveDrawingBuffer = options.preserveDrawingBuffer === true;
        this.opaqueCanvas = options.opaqueCanvas === true;
        this.desynchronized = options.desynchronized === true;

        this.running = false;
        this.animationId = null;
        this.frameTimer = null;
        this.window = window;
        this.lastFrameTime = 0;
        this.lastRafAt = 0;
        this.initialized = false;
        this.frameCount = 0;
        this.fpsFrameCount = 0;
        this.lastFpsUpdate = 0;
        this.currentFps = 0;

        this.canvas = null;
        this.gl = null;
        this.cellProgram = null;
        this.renderProgram = null;
        this.sourceTexture = null;
        this.cellColorTexture = null;
        this.cellFramebuffer = null;
        this.quadVAO = null;

        this.rows = 0;
        this.canvasWidth = 0;
        this.canvasHeight = 0;
    }

    init() {
        const doc = this.targetElement.ownerDocument || document;
        this.window = doc.defaultView || window;
        this.canvas = doc.createElement('canvas');
        this.canvas.className = 'ascii-canvas';
        this.targetElement.innerHTML = '';
        this.targetElement.appendChild(this.canvas);

        this.gl = this.canvas.getContext('webgl2', {
            antialias: false,
            alpha: !this.opaqueCanvas,
            preserveDrawingBuffer: this.preserveDrawingBuffer,
            desynchronized: this.desynchronized
        });
        if (!this.gl) throw new Error('WebGL2 not available');

        this._updateDimensions();

        const gl = this.gl;

        this.cellProgram = this._createProgram(CELL_PASS_VERT, CELL_PASS_FRAG);
        this.renderProgram = this._createProgram(RENDER_PASS_VERT, RENDER_PASS_FRAG);

        // Fullscreen quad VAO
        this.quadVAO = gl.createVertexArray();
        gl.bindVertexArray(this.quadVAO);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, -1, 1, 1, 1,
            -1, -1, 1, 1, 1, -1
        ]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);

        // Source texture
        this.sourceTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
        this._applySourceSmoothing();
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

        // For images, upload texture once
        if (this.source.isImage) {
            const sourceEl = this.source.canvas || this.source.element;
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceEl);
        }

        this._createCellTexture();

        this.initialized = true;
        console.log(`[WebGL2] ${this.source.type} source, ${this.cols}x${this.rows} cells, ${this.canvasWidth}x${this.canvasHeight}px`);
    }

    _createProgram(vertSrc, fragSrc) {
        const gl = this.gl;

        const vert = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vert, vertSrc);
        gl.compileShader(vert);
        if (!gl.getShaderParameter(vert, gl.COMPILE_STATUS)) {
            throw new Error('Vertex shader: ' + gl.getShaderInfoLog(vert));
        }

        const frag = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(frag, fragSrc);
        gl.compileShader(frag);
        if (!gl.getShaderParameter(frag, gl.COMPILE_STATUS)) {
            throw new Error('Fragment shader: ' + gl.getShaderInfoLog(frag));
        }

        const prog = gl.createProgram();
        gl.attachShader(prog, vert);
        gl.attachShader(prog, frag);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            throw new Error('Link: ' + gl.getProgramInfoLog(prog));
        }

        gl.deleteShader(vert);
        gl.deleteShader(frag);
        return prog;
    }

    _updateDimensions() {
        const sw = this.source.width || 640;
        const sh = this.source.height || 480;
        this.rows = this.autoRows
            ? Math.max(1, Math.round(this.cols * (sh / sw) * (this.cellWidth / this.cellHeight) * this.aspectCorrection))
            : Math.max(1, Math.round(this.rowsOverride || this.rows || 1));
        this.canvasWidth = this.cols * this.cellWidth;
        this.canvasHeight = this.rows * this.cellHeight;
        this.canvas.width = this.canvasWidth;
        this.canvas.height = this.canvasHeight;
        this.canvas.style.aspectRatio = `${sw} / ${sh}`;
        this.canvas.style.width = '100%';
        this.canvas.style.height = 'auto';
        this.canvas.style.maxWidth = '100%';
        this.canvas.style.maxHeight = '100%';
        this.canvas.style.imageRendering = 'pixelated';
    }

    _createCellTexture() {
        const gl = this.gl;
        if (this.cellColorTexture) gl.deleteTexture(this.cellColorTexture);
        if (this.cellFramebuffer) gl.deleteFramebuffer(this.cellFramebuffer);

        this.cellColorTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.cellColorTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.cols, this.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        this.cellFramebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.cellFramebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.cellColorTexture, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    _applySourceSmoothing() {
        if (!this.gl || !this.sourceTexture) return;
        const gl = this.gl;
        const filter = this.smoothing ? gl.LINEAR : gl.NEAREST;
        gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    }

    _renderFrame() {
        if (!this.initialized) return;

        this.frameCount++;
        const gl = this.gl;

        // For video, update texture every frame
        if (this.source.isVideo) {
            const sourceEl = this.source.canvas || this.source.element;
            gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
            try {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceEl);
            } catch (e) { return; }
        }

        // Pass 1: cell colors
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.cellFramebuffer);
        gl.viewport(0, 0, this.cols, this.rows);
        gl.useProgram(this.cellProgram);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
        gl.uniform1i(gl.getUniformLocation(this.cellProgram, 'u_source'), 0);
        gl.uniform2f(gl.getUniformLocation(this.cellProgram, 'u_gridSize'), this.cols, this.rows);
        gl.uniform1f(gl.getUniformLocation(this.cellProgram, 'u_saturationBoost'), this.saturationBoost);
        gl.uniform1f(gl.getUniformLocation(this.cellProgram, 'u_contrastBoost'), this.contrastBoost);
        gl.uniform1f(gl.getUniformLocation(this.cellProgram, 'u_brightness'), this.brightness);
        gl.uniform1f(gl.getUniformLocation(this.cellProgram, 'u_gamma'), this.gamma);
        gl.uniform1f(gl.getUniformLocation(this.cellProgram, 'u_bgBlend'), this.bgBlend);
        gl.uniform1i(gl.getUniformLocation(this.cellProgram, 'u_quantizeBits'), this.quantizeBits);
        gl.uniform1f(gl.getUniformLocation(this.cellProgram, 'u_jitterAmount'), this.jitterAmount);
        gl.uniform1f(gl.getUniformLocation(this.cellProgram, 'u_jitterSpeed'), this.jitterSpeed);
        gl.uniform1f(gl.getUniformLocation(this.cellProgram, 'u_sampleX'), this.sampleX);
        gl.uniform1f(gl.getUniformLocation(this.cellProgram, 'u_sampleY'), this.sampleY);
        gl.uniform1f(gl.getUniformLocation(this.cellProgram, 'u_time'), this.frameCount / Math.max(1, this.fps));
        gl.uniform1i(gl.getUniformLocation(this.cellProgram, 'u_mirrorX'), this.mirrorX ? 1 : 0);

        gl.bindVertexArray(this.quadVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Pass 2: render to canvas
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvasWidth, this.canvasHeight);
        gl.useProgram(this.renderProgram);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.cellColorTexture);
        gl.uniform1i(gl.getUniformLocation(this.renderProgram, 'u_cellColors'), 0);
        gl.uniform2f(gl.getUniformLocation(this.renderProgram, 'u_gridSize'), this.cols, this.rows);
        gl.uniform2f(gl.getUniformLocation(this.renderProgram, 'u_cellSize'), this.cellWidth, this.cellHeight);
        gl.uniform2f(gl.getUniformLocation(this.renderProgram, 'u_canvasSize'), this.canvasWidth, this.canvasHeight);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindVertexArray(null);
    }

    renderFrame() {
        const beforeFrame = this.frameCount;
        this._renderFrame();
        if (this.frameCount !== beforeFrame) {
            const now = this.window.performance?.now?.() ?? performance.now();
            this._recordFrame(now);
        }
    }

    _recordFrame(ts) {
        this.fpsFrameCount++;
        if (!this.lastFpsUpdate) {
            this.lastFpsUpdate = ts;
            return;
        }
        const elapsed = ts - this.lastFpsUpdate;
        if (elapsed >= 1000) {
            this.currentFps = this.fpsFrameCount * 1000 / elapsed;
            this.fpsFrameCount = 0;
            this.lastFpsUpdate = ts;
        }
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.lastRafAt = this.window.performance?.now?.() ?? performance.now();

        const tick = (ts) => {
            if (!this.running) return;
            if (ts - this.lastFrameTime >= this.frameInterval) {
                const beforeFrame = this.frameCount;
                this._renderFrame();
                if (this.frameCount !== beforeFrame) this._recordFrame(ts);
                this.lastFrameTime = ts;
            }
        };
        const loop = (ts) => {
            this.lastRafAt = this.window.performance?.now?.() ?? performance.now();
            tick(ts);
            if (!this.running) return;
            this.animationId = this.window.requestAnimationFrame(loop);
        };
        this.animationId = this.window.requestAnimationFrame(loop);
        const fallbackInterval = Math.max(8, Math.min(50, this.frameInterval));
        this.frameTimer = this.window.setInterval(() => {
            if (!this.running) return;
            const now = this.window.performance?.now?.() ?? performance.now();
            const staleMs = Math.max(80, this.frameInterval * 2);
            if (now - this.lastRafAt >= staleMs) tick(now);
        }, fallbackInterval);
    }

    stop() {
        this.running = false;
        if (this.animationId) {
            this.window.cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this.frameTimer) {
            this.window.clearInterval(this.frameTimer);
            this.frameTimer = null;
        }
    }

    destroy() {
        this.stop();
        const gl = this.gl;
        if (gl) {
            if (this.cellColorTexture) gl.deleteTexture(this.cellColorTexture);
            if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
            if (this.cellFramebuffer) gl.deleteFramebuffer(this.cellFramebuffer);
            if (this.cellProgram) gl.deleteProgram(this.cellProgram);
            if (this.renderProgram) gl.deleteProgram(this.renderProgram);
        }
        this.initialized = false;
    }

    getStats() {
        return {
            backend: 'webgl2',
            sourceType: this.source?.type,
            cols: this.cols,
            rows: this.rows,
            fps: this.fps,
            currentFps: this.currentFps,
            canvasSize: `${this.canvasWidth}x${this.canvasHeight}`
        };
    }
}
