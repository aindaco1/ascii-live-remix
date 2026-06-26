const GPU_BACKGROUND = [3 / 255, 4 / 255, 5 / 255];

const ASCII_CHARS = " .'`^\":;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function fract(value) {
    return value - Math.floor(value);
}

function applyBasicColorAdjustments(r, g, b, params) {
    let rr = r / 255;
    let gg = g / 255;
    let bb = b / 255;
    const saturationBoost = Number(params?.saturationBoost ?? 1);
    const contrastBoost = Number(params?.contrastBoost ?? 1);
    const brightness = Number(params?.brightness ?? 1);
    const gamma = Math.max(0.01, Number(params?.gamma ?? 1));
    const avg = (rr + gg + bb) / 3;
    rr = clamp(avg + (rr - avg) * saturationBoost, 0, 1);
    gg = clamp(avg + (gg - avg) * saturationBoost, 0, 1);
    bb = clamp(avg + (bb - avg) * saturationBoost, 0, 1);
    rr = clamp((rr - 0.5) * contrastBoost + 0.5, 0, 1);
    gg = clamp((gg - 0.5) * contrastBoost + 0.5, 0, 1);
    bb = clamp((bb - 0.5) * contrastBoost + 0.5, 0, 1);
    rr = clamp(Math.pow(rr * brightness, 1 / gamma), 0, 1);
    gg = clamp(Math.pow(gg * brightness, 1 / gamma), 0, 1);
    bb = clamp(Math.pow(bb * brightness, 1 / gamma), 0, 1);
    return [rr, gg, bb];
}

function processCanvasColorLegacy(r, g, b, params) {
    const [rr, gg, bb] = applyBasicColorAdjustments(r, g, b, params);
    if ((params?.quantizeBits || 0) > 0) {
        const mask = (255 << params.quantizeBits) & 255;
        return [
            Math.round(rr * 255) & mask,
            Math.round(gg * 255) & mask,
            Math.round(bb * 255) & mask
        ];
    }
    return [Math.round(rr * 255), Math.round(gg * 255), Math.round(bb * 255)];
}

function processStreamColorLegacy(r, g, b, params) {
    return processCanvasColorLegacy(r, g, b, params);
}

function shaderHash(x, y) {
    let p3x = fract(x * 0.1031);
    let p3y = fract(y * 0.1031);
    let p3z = fract(x * 0.1031);
    const dot = p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33);
    p3x += dot;
    p3y += dot;
    p3z += dot;
    return fract((p3x + p3y) * p3z);
}

function processGpuCellColor(r, g, b, params) {
    let [rr, gg, bb] = applyBasicColorAdjustments(r, g, b, params);
    const quantizeBits = Math.max(0, Math.round(params?.quantizeBits || 0));
    if (quantizeBits > 0) {
        const quantum = Math.pow(2, quantizeBits);
        rr = Math.floor(rr * 255 / quantum) * quantum / 255;
        gg = Math.floor(gg * 255 / quantum) * quantum / 255;
        bb = Math.floor(bb * 255 / quantum) * quantum / 255;
    }

    const bgBlend = clamp(params?.bgBlend || 0, 0, 1);
    rr = rr * (1 - bgBlend) + GPU_BACKGROUND[0] * bgBlend;
    gg = gg * (1 - bgBlend) + GPU_BACKGROUND[1] * bgBlend;
    bb = bb * (1 - bgBlend) + GPU_BACKGROUND[2] * bgBlend;
    return [Math.round(rr * 255), Math.round(gg * 255), Math.round(bb * 255)];
}

function charsetChars(params) {
    if (params?.charset === 'blocks') return ' ░▒▓█';
    if (params?.charset === 'asciline') return ' .:-=+*#%@';
    if (params?.charset === 'classic-camera') return ' .,:;i1tfLCG08@';
    return ASCII_CHARS;
}

function glyphForLuma(luma, params) {
    const chars = charsetChars(params);
    const idx = Math.min(chars.length - 1, Math.floor(luma / 256 * chars.length));
    return chars[idx] || ' ';
}

export {
    ASCII_CHARS,
    applyBasicColorAdjustments,
    charsetChars,
    clamp,
    fract,
    glyphForLuma,
    processCanvasColorLegacy,
    processGpuCellColor,
    processStreamColorLegacy,
    shaderHash
};
