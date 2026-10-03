fn flies(uv: vec2f, t: f32, scale: f32) -> f32 {
    var s = 0.0;
    let p = uv * scale;
    let id = floor(p);
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let cell = id + vec2f(f32(x), f32(y));
            let h = hash22(cell);
            if (h.x < 0.55) { continue; }
            let c = cell + 0.5 + 0.4 * vec2f(sin(t * (0.3 + h.y) + h.x * 20.0), cos(t * (0.25 + h.x * 0.5) + h.y * 30.0));
            let d = length(p - c);
            let blink = pow(0.5 + 0.5 * sin(t * (0.8 + h.y) + h.x * 50.0), 3.0);
            s += (smoothstep(0.08, 0.0, d) + smoothstep(0.6, 0.0, d) * 0.15) * blink;
        }
    }
    return s;
}

@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let uv = canvas_uv(pos.xy);
    let t = T();
    var col = mix(vec3f(0.01, 0.03, 0.05), vec3f(0.03, 0.10, 0.06), uv.y);

    let a = uv + px(0.3);
    let far = 0.55 + 0.12 * fbm(vec2f(a.x * 6.0, 1.0));
    col = mix(col, vec3f(0.015, 0.05, 0.03), smoothstep(far, far + 0.003, a.y));
    col += vec3f(0.85, 1.0, 0.35) * flies(uv + px(0.5), t, 9.0) * 0.6;
    let b = uv + px(1.0);
    let near = 0.72 + 0.14 * fbm(vec2f(b.x * 4.0, 5.0));
    col = mix(col, vec3f(0.004, 0.015, 0.01), smoothstep(near, near + 0.003, b.y));
    col += vec3f(0.95, 1.0, 0.45) * flies(uv + px(1.2), t * 0.8, 5.0) * F.intensity;
    return out(col, pos.xy);
}
