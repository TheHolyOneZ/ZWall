@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let uv = canvas_uv(pos.xy);
    let t = T();
    var col = mix(vec3f(0.008, 0.016, 0.06), vec3f(0.02, 0.07, 0.10), uv.y);


    let sp = (uv + px(0.15)) * 260.0;
    let h = hash21(floor(sp));
    if (h > 0.982) {
        let d = length(fract(sp) - 0.5);
        col += vec3f(0.85, 0.9, 1.0) * smoothstep(0.12, 0.0, d) * (0.55 + 0.45 * sin(t * 1.7 + h * 60.0));
    }


    let p = uv + px(0.45);
    for (var i = 0; i < 3; i++) {
        let fi = f32(i);
        let x = p.x * (0.9 + fi * 0.35) + t * 0.018 * (1.0 + fi * 0.6);
        let edge = 0.42 + 0.07 * fi + 0.07 * sin(x * 2.1 + fi * 1.7) + 0.09 * (fbm(vec2f(x * 1.3, t * 0.04 + fi * 3.0)) - 0.5);
        let d = p.y - edge;
        let rays = 0.55 + 0.45 * noise(vec2f(x * 38.0, t * 0.25 + fi));
        let glow = select(exp(d * 7.0), exp(-d * 55.0), d > 0.0) * rays;
        let tint = mix(vec3f(0.13, 0.95, 0.62), vec3f(0.45, 0.33, 1.0), clamp(-d * 3.2 + fi * 0.2, 0.0, 1.0));
        col += tint * glow * (0.55 - fi * 0.12) * F.intensity;
    }


    let m = uv + px(1.0);
    let ridge = 0.80 - 0.05 * abs(sin(m.x * 2.4 + 1.3)) - 0.07 * fbm(vec2f(m.x * 3.5, 2.0));
    col = mix(col, vec3f(0.004, 0.008, 0.02), smoothstep(ridge - 0.002, ridge + 0.002, m.y));
    return out(col, pos.xy);
}
