@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let uv = canvas_uv(pos.xy);
    let t = T();
    let horizon = 0.56;
    let s = uv + px(0.15);
    var col = mix(vec3f(0.005, 0.02, 0.06), vec3f(0.03, 0.14, 0.26), smoothstep(0.0, horizon, s.y));
    let moon = vec2f(aspect() * 0.7, 0.22);
    let md = length(s - moon);
    col += vec3f(0.85, 0.92, 1.0) * smoothstep(0.035, 0.03, md) + vec3f(0.4, 0.6, 0.9) * exp(-md * 12.0) * 0.35;
    let sp = s * 300.0;
    col += vec3f(0.7) * step(0.994, hash21(floor(sp))) * step(s.y, horizon - 0.05);
    let p = uv + px(0.7);
    if (p.y > horizon) {
        let depth = (p.y - horizon) / (1.0 - horizon);
        let z = 1.0 / (depth + 0.05);
        let wx = p.x * z * 0.6;
        let wave = sin(wx * 4.0 + t * 0.9 + z) * 0.5 + sin(wx * 9.0 - t * 1.3 + z * 2.0) * 0.25 + (noise(vec2f(wx * 6.0, z * 3.0 - t * 0.5)) - 0.5);
        var water = mix(vec3f(0.02, 0.08, 0.16), vec3f(0.0, 0.02, 0.05), depth);

        let path = exp(-abs(p.x - moon.x) * (3.0 + depth * 6.0) * 2.0);
        water += vec3f(0.75, 0.88, 1.0) * smoothstep(0.55, 0.95, wave) * path * (1.2 - depth) * F.intensity;
        water += vec3f(0.08, 0.2, 0.3) * smoothstep(0.3, 0.9, wave) * 0.2;
        col = water;
    }
    return out(col, pos.xy);
}
