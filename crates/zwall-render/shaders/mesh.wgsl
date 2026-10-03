@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let uv = canvas_uv(pos.xy) + px(0.5);
    let t = T() * 0.05;
    let w = uv + 0.35 * vec2f(fbm(uv * 1.3 + t), fbm(uv * 1.3 - t + 4.0));
    let c1 = vec3f(1.0, 0.48, 0.35);
    let c2 = vec3f(0.79, 0.29, 1.0);
    let c3 = vec3f(0.29, 0.48, 1.0);
    let c4 = vec3f(0.13, 0.83, 0.65);
    let a = 0.5 + 0.5 * sin(w.x * 2.2 + t * 3.0);
    let b = 0.5 + 0.5 * sin(w.y * 2.7 - t * 2.0 + 1.0);
    var col = mix(mix(c1, c2, a), mix(c3, c4, a), b);
    col = mix(vec3f(0.07, 0.04, 0.12), col, 0.55 + 0.35 * F.intensity);
    col += (hash21(pos.xy + fract(F.time)) - 0.5) * 0.04;
    return out(col, pos.xy);
}
