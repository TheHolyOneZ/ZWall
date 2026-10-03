fn dune(x: f32, base: f32, amp: f32, seed: f32) -> f32 {
    return base - amp * (0.6 * sin(x * 1.3 + seed) + 0.3 * sin(x * 2.9 + seed * 2.0) + 0.15 * fbm(vec2f(x * 3.0, seed)));
}

@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let uv = canvas_uv(pos.xy);
    let t = T();
    let s = uv + px(0.1);
    var col = mix(vec3f(0.16, 0.10, 0.29), vec3f(1.0, 0.54, 0.30), smoothstep(0.05, 0.72, s.y));
    col = mix(col, vec3f(1.0, 0.76, 0.48), smoothstep(0.55, 0.75, s.y));

    let sun = vec2f(aspect() * 0.62, 0.60);
    let sd = length((s - sun) * vec2f(1.0, 1.1));
    col += vec3f(1.0, 0.95, 0.77) * smoothstep(0.045, 0.04, sd);
    col += vec3f(1.0, 0.7, 0.4) * exp(-sd * 9.0) * 0.5;

    col += vec3f(1.0, 0.8, 0.6) * smoothstep(0.1, 0.0, abs(s.y - 0.63 - 0.01 * sin(s.x * 3.0 + t * 0.2))) * 0.08;
    let layers = array<vec3f, 3>(vec3f(0.60, 0.26, 0.36), vec3f(0.42, 0.16, 0.30), vec3f(0.22, 0.08, 0.20));
    for (var i = 0; i < 3; i++) {
        let fi = f32(i);
        let p = uv + px(0.35 + fi * 0.35);
        let h = dune(p.x + t * 0.004 * (fi + 1.0), 0.70 + fi * 0.08, 0.03 + fi * 0.015, fi * 5.0);
        let rim = smoothstep(0.012, 0.0, abs(p.y - h)) * 0.25 * (1.0 - fi * 0.3);
        col = mix(col, layers[i] * (1.0 - (p.y - h) * 0.6), smoothstep(h - 0.0015, h + 0.0015, p.y));
        col += vec3f(1.0, 0.7, 0.45) * rim * step(p.y, h + 0.012) * F.intensity;
    }
    return out(col, pos.xy);
}
