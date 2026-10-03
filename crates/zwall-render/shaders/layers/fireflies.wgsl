
fn flies(uv: vec2f, t: f32, scale: f32) -> f32 {
    var s = 0.0;
    let p = uv * scale;
    let id = floor(p);
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let cell = id + vec2f(f32(x), f32(y));
            let h = hash22(cell);
            if (h.x < 0.6) { continue; }
            let c = cell + 0.5 + 0.4 * vec2f(sin(t * (0.3 + h.y) + h.x * 20.0), cos(t * (0.25 + h.x * 0.5) + h.y * 30.0));
            let d = length(p - c);
            let blink = pow(0.5 + 0.5 * sin(t * (0.8 + h.y) + h.x * 50.0), 3.0);
            s += (smoothstep(0.08, 0.0, d) + smoothstep(0.6, 0.0, d) * 0.2) * blink;
        }
    }
    return s;
}

@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let uv = canvas_uv(pos.xy);
    let t = T();
    let a = clamp(flies(uv + px(0.5), t, 9.0) * 0.6 + flies(uv + px(1.2), t * 0.8, 5.0), 0.0, 1.0) * F.intensity;
    return vec4f(vec3f(0.95, 1.0, 0.5) * a, a);
}
