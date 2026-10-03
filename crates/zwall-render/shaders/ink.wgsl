
@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let uv = canvas_uv(pos.xy) * 1.6 + px(0.6) * 2.0;
    let t = T() * 0.045;
    let q = vec2f(fbm(uv + vec2f(0.0, t)), fbm(uv + vec2f(5.2, -t)));
    let r = vec2f(fbm(uv + 4.0 * q + vec2f(1.7 - t, 9.2)), fbm(uv + 4.0 * q + vec2f(8.3, 2.8 + t)));
    let f = fbm(uv + 4.0 * r);
    let paper = vec3f(0.93, 0.9, 0.84);
    let ink = vec3f(0.05, 0.08, 0.2);
    var col = mix(paper, ink, smoothstep(0.25, 0.75, f));
    col = mix(col, vec3f(0.12, 0.2, 0.45), smoothstep(0.55, 0.9, length(q)) * 0.6);

    col = mix(col, vec3f(0.85, 0.18, 0.12), smoothstep(0.02, 0.0, abs(r.x - 0.62)) * 0.8 * F.intensity);
    return out(col, pos.xy);
}
