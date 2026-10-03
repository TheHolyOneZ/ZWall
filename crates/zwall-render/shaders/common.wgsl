

struct Frame {
    resolution: vec2f,
    canvas: vec2f,
    origin: vec2f,
    cursor: vec2f,
    time: f32,
    speed: f32,
    intensity: f32,
    depth: f32,
    tint: vec4f,
    ripple: vec4f,
    grade: vec4f,
};

@group(0) @binding(0) var<uniform> F: Frame;

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}


fn ripple_band(p: vec2f) -> f32 {
    if (F.ripple.w <= 0.0) { return 0.0; }
    let r = length((p - F.ripple.xy) / F.canvas.y);
    let front = F.ripple.z * 0.55;
    return exp(-pow((r - front) * 14.0, 2.0)) * F.ripple.w * exp(-F.ripple.z * 1.6);
}
fn ripple_warp(p: vec2f) -> vec2f {
    let band = ripple_band(p);
    if (band <= 0.0001) { return p; }
    let d = p - F.ripple.xy;
    let r = length(d / F.canvas.y);
    let front = F.ripple.z * 0.55;
    return p + normalize(d + vec2f(0.0001)) * sin((r - front) * 60.0) * band * 0.028 * F.canvas.y;
}
fn canvas_uv(pos: vec2f) -> vec2f { return ripple_warp(pos + F.origin) / F.canvas.y; }
fn aspect() -> f32 { return F.canvas.x / F.canvas.y; }
fn T() -> f32 { return F.time * F.speed; }

fn px(depth: f32) -> vec2f { return F.cursor * vec2f(0.018, 0.010) * depth * F.depth; }

fn hash21(p: vec2f) -> f32 {
    var q = fract(p * vec2f(123.34, 456.21));
    q += dot(q, q + 45.32);
    return fract(q.x * q.y);
}
fn hash22(p: vec2f) -> vec2f {
    let n = hash21(p);
    return vec2f(n, hash21(p + n * 17.0));
}
fn noise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2f(1.0, 0.0)), u.x), mix(hash21(i + vec2f(0.0, 1.0)), hash21(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn fbm(p0: vec2f) -> f32 {
    var p = p0;
    var a = 0.5;
    var s = 0.0;
    for (var i = 0; i < 5; i++) {
        s += a * noise(p);
        p = p * 2.03 + vec2f(1.7, 9.2);
        a *= 0.5;
    }
    return s;
}

fn dither(pos: vec2f) -> vec3f { return vec3f((hash21(pos + fract(F.time)) - 0.5) / 255.0); }

fn grade(c: vec3f) -> vec3f {
    let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
    if (F.tint.w > 1.5) { return vec3f(l) * vec3f(1.0, 0.99, 0.97); }
    if (F.tint.w > 0.5) {
        let a = F.tint.rgb / max(dot(F.tint.rgb, vec3f(0.2126, 0.7152, 0.0722)), 0.05);
        return mix(c, l * a, 0.75);
    }
    return c;
}
fn out(c: vec3f, pos: vec2f) -> vec4f {
    let glint = ripple_band(pos + F.origin) * 0.12;
    return vec4f(clamp((grade(c) + glint) * F.grade.rgb, vec3f(0.0), vec3f(1.0)) + dither(pos), 1.0);
}
