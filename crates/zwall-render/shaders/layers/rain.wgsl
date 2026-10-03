
fn n1(t: f32) -> f32 { return fract(sin(t * 12345.564) * 7658.76); }
fn n13(p: f32) -> vec3f {
    var p3 = fract(vec3f(p) * vec3f(0.1031, 0.11369, 0.13787));
    p3 += dot(p3, p3.yzx + 19.19);
    return fract(vec3f((p3.x + p3.y) * p3.z, (p3.x + p3.z) * p3.y, (p3.y + p3.z) * p3.x));
}
fn saw(b: f32, t: f32) -> f32 { return smoothstep(0.0, b, t) * smoothstep(1.0, b, t); }

fn drop_layer(uv0: vec2f, t: f32) -> f32 {
    let big = uv0;
    var uv = uv0;
    uv.y -= t * 0.75;
    let a = vec2f(6.0, 1.0);
    let grid = a * 2.0;
    var id = floor(uv * grid);
    uv.y += n1(id.x);
    id = floor(uv * grid);
    let n = n13(id.x * 35.2 + id.y * 2376.1);
    let st = fract(uv * grid) - vec2f(0.5, 0.0);
    var x = n.x - 0.5;
    let yw = big.y * 20.0;
    x += sin(yw + sin(yw)) * (0.5 - abs(x)) * (n.z - 0.5);
    x *= 0.7;
    let y = 1.0 - ((saw(0.85, fract(t + n.z)) - 0.5) * 0.9 + 0.5);
    let d = length((st - vec2f(x, y)) * a.yx);
    return smoothstep(0.4, 0.0, d);
}

@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let uv = canvas_uv(pos.xy) + px(0.9);
    let t = T() * 0.2;

    let bp = uv * 40.0;
    let n = n13(floor(bp).x * 107.45 + floor(bp).y * 3543.654);
    let bead = smoothstep(0.3, 0.0, length(fract(bp) - 0.5 - (n.xy - 0.5) * 0.7)) * fract(n.z * 10.0) * saw(0.025, fract(t + n.z));
    let m = smoothstep(0.3, 1.0, bead + drop_layer(uv, t) + drop_layer(uv * 1.85, t));

    let e = 0.0025;
    let below = smoothstep(0.3, 1.0, drop_layer(uv + vec2f(0.0, e), t));
    let light = clamp((m - below) * 10.0, 0.0, 1.0) * smoothstep(0.5, 0.9, m);
    let rim = clamp(m * (1.0 - m) * 4.0, 0.0, 1.0);
    let dark = rim * 0.35 + m * 0.05;

    let a = clamp(dark + light * 0.7, 0.0, 1.0) * F.intensity;
    let col = vec3f(0.95, 0.97, 1.0) * light * 0.7 * F.intensity;
    return vec4f(col, a);
}
