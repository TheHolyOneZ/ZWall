

@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let uv = canvas_uv(pos.xy) + px(0.4);
    let t = T() * 0.03;
    let a = vec3f(0.84, 0.47, 0.33);
    let b = vec3f(0.16, 0.2, 0.3);
    let w = 0.5 + 0.5 * sin(uv.x * 1.3 + uv.y * 2.1 + t * 2.0 + fbm(uv * 1.2 + t) * 2.5);
    var col = mix(b, a, smoothstep(0.1, 0.95, w));
    col *= 0.85 + 0.15 * (1.0 - length(canvas_uv(pos.xy) / vec2f(aspect(), 1.0) - 0.5));

    let g = hash21(floor(pos.xy) + fract(F.time * 24.0) * 97.0) - 0.5;
    col += g * 0.09 * F.intensity;
    return out(col, pos.xy);
}
