
fn flakes(uv: vec2f, t: f32, scale: f32, speed: f32, size: f32) -> f32 {
    var p = uv * scale;
    p.y -= t * speed;
    p.x += sin(p.y * 0.35 + t * 0.4) * 0.35;
    let id = floor(p);
    let h = hash22(id);
    if (h.x < 0.35) { return 0.0; }
    let c = 0.2 + h * 0.6;
    let wobble = vec2f(sin(t * (0.6 + h.y) + h.x * 30.0), 0.0) * 0.12;
    let d = length(fract(p) - c - wobble);
    return smoothstep(size, size * 0.2, d);
}

@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let uv = canvas_uv(pos.xy);
    let t = T();
    var col = mix(vec3f(0.05, 0.07, 0.12), vec3f(0.16, 0.19, 0.26), smoothstep(0.0, 1.0, uv.y));

    col += vec3f(0.35, 0.42, 0.55) * exp(-length((uv - vec2f(aspect() * 0.35, 0.72)) * vec2f(0.6, 2.2)) * 3.0) * 0.35;
    let hill = 0.8 + 0.04 * sin((uv.x + px(0.4).x) * 3.0 + 1.0) + 0.05 * fbm(vec2f(uv.x * 2.5, 3.0));
    col = mix(col, vec3f(0.78, 0.82, 0.9) * 0.55, smoothstep(hill, hill + 0.003, uv.y + px(0.4).y));
    col += vec3f(0.85, 0.9, 1.0) * flakes(uv + px(0.2), t, 38.0, 0.9, 0.07) * 0.45;
    col += vec3f(0.9, 0.93, 1.0) * flakes(uv + px(0.6), t, 20.0, 1.4, 0.08) * 0.7;
    col += vec3f(1.0) * flakes(uv + px(1.1), t, 9.0, 2.2, 0.06) * F.intensity;
    return out(col, pos.xy);
}
