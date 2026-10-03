
@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let g = hash21(floor(pos.xy) + fract(F.time * 24.0) * 97.0);
    let v = length((pos.xy + F.origin) / F.canvas - 0.5);
    let dark = smoothstep(0.35, 0.85, v) * 0.35;

    let a = clamp(abs(g - 0.5) * 0.18 * F.intensity + dark, 0.0, 1.0);
    let c = select(vec3f(0.0), vec3f(1.0), g > 0.5 && dark < 0.05);
    return vec4f(c * a, a);
}
