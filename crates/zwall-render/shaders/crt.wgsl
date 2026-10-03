
@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let res = F.canvas;
    var p = (pos.xy + F.origin) / res * 2.0 - 1.0;

    p *= 1.0 + dot(p, p) * 0.04;
    if (abs(p.x) > 1.0 || abs(p.y) > 1.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
    let uv = (p * 0.5 + 0.5) * vec2f(res.x / res.y, 1.0) + px(0.3);
    let t = T();

    let cell = floor(vec2f(uv.x * 60.0, uv.y * 32.0 + t * 1.2));
    let on = step(0.55, hash21(cell)) * step(0.3, fract(sin(cell.y * 12.9) * 43758.5));
    let glyph = on * smoothstep(0.5, 0.35, abs(fract(uv.x * 60.0) - 0.5)) * smoothstep(0.5, 0.3, abs(fract(uv.y * 32.0 + t * 1.2) - 0.5));
    var col = vec3f(0.1, 1.0, 0.45) * glyph * 0.55;
    col += vec3f(0.02, 0.09, 0.05);

    col *= 0.75 + 0.25 * sin(pos.y * 3.14159);
    col += vec3f(0.05, 0.25, 0.12) * smoothstep(0.08, 0.0, abs(fract(uv.y * 0.5 - t * 0.07) - 0.5)) * F.intensity;

    col *= 1.0 - dot(p, p) * 0.35;
    return out(col, pos.xy);
}
