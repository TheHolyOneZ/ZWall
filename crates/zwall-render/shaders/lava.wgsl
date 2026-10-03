@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let uv = canvas_uv(pos.xy) * 2.2 + px(0.6) * 2.0;
    let t = T() * 0.08;
    let q = vec2f(fbm(uv + t), fbm(uv + vec2f(5.2, 1.3) - t));
    let r = vec2f(fbm(uv + 3.0 * q + vec2f(1.7, 9.2) + t * 1.5), fbm(uv + 3.0 * q + vec2f(8.3, 2.8) - t));
    let f = fbm(uv + 3.5 * r);
    var col = mix(vec3f(0.08, 0.01, 0.0), vec3f(0.85, 0.12, 0.05), smoothstep(0.3, 0.7, f));
    col = mix(col, vec3f(1.0, 0.55, 0.1), smoothstep(0.6, 0.85, f) * F.intensity);
    col = mix(col, vec3f(1.0, 0.9, 0.55), smoothstep(0.82, 0.95, f) * F.intensity);
    return out(col, pos.xy);
}
