fn stars(uv: vec2f, scale: f32, size: f32, t: f32) -> f32 {
    let p = uv * scale;
    let id = floor(p);
    let h = hash22(id);
    if (h.x < 0.72) { return 0.0; }
    let c = vec2f(0.2) + h * 0.6;
    let d = length(fract(p) - c);
    let tw = 0.6 + 0.4 * sin(t * (1.0 + h.y * 3.0) + h.x * 40.0);
    return smoothstep(size, 0.0, d) * tw + smoothstep(size * 5.0, 0.0, d) * 0.08;
}

@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let uv = canvas_uv(pos.xy);
    let t = T();
    let n = fbm((uv + px(0.1)) * 2.2 + vec2f(t * 0.004, 0.0));
    var col = vec3f(0.012, 0.01, 0.035);
    col += vec3f(0.22, 0.12, 0.45) * smoothstep(0.45, 0.85, n) * 0.7;
    col += vec3f(0.08, 0.16, 0.40) * smoothstep(0.5, 0.9, fbm(uv * 3.1 + 7.0)) * 0.5;
    let drift = vec2f(t * 0.003, 0.0);
    col += vec3f(0.75, 0.8, 1.0) * stars(uv + px(0.2) + drift * 0.3, 90.0, 0.06, t);
    col += vec3f(0.85, 0.88, 1.0) * stars(uv + px(0.5) + drift * 0.6, 45.0, 0.05, t) * 0.9;
    col += vec3f(1.0, 0.95, 0.9) * stars(uv + px(1.0) + drift, 20.0, 0.035, t) * F.intensity;
    return out(col, pos.xy);
}
