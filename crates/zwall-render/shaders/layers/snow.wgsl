
fn flake(uv: vec2f, t: f32, scale: f32, speed: f32, size: f32) -> f32 {
    var p = uv * scale;
    p.y -= t * speed;
    p.x += sin(p.y * 0.35 + t * 0.4) * 0.35;
    let id = floor(p);
    let h = hash22(id);
    if (h.x < 0.35) { return 0.0; }
    let d = length(fract(p) - (0.2 + h * 0.6) - vec2f(sin(t * (0.6 + h.y) + h.x * 30.0), 0.0) * 0.12);
    return smoothstep(size, size * 0.2, d);
}

@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let uv = canvas_uv(pos.xy);
    let t = T();
    let a = clamp(flake(uv + px(0.3), t, 38.0, 0.9, 0.07) * 0.45 + flake(uv + px(0.7), t, 20.0, 1.4, 0.08) * 0.7 + flake(uv + px(1.2), t, 9.0, 2.2, 0.06), 0.0, 1.0) * F.intensity;
    return vec4f(vec3f(0.97, 0.98, 1.0) * a, a);
}
