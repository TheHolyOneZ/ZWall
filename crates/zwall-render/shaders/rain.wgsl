

fn n1(t: f32) -> f32 { return fract(sin(t * 12345.564) * 7658.76); }
fn n13(p: f32) -> vec3f {
    var p3 = fract(vec3f(p) * vec3f(0.1031, 0.11369, 0.13787));
    p3 += dot(p3, p3.yzx + 19.19);
    return fract(vec3f((p3.x + p3.y) * p3.z, (p3.x + p3.z) * p3.y, (p3.y + p3.z) * p3.x));
}
fn saw(b: f32, t: f32) -> f32 { return smoothstep(0.0, b, t) * smoothstep(1.0, b, t); }


fn city(uv: vec2f) -> vec3f {
    var c = mix(vec3f(0.035, 0.05, 0.12), vec3f(0.10, 0.07, 0.16), smoothstep(0.0, 1.0, uv.y));

    c += vec3f(0.35, 0.16, 0.10) * smoothstep(0.55, 1.1, uv.y) * 0.5;
    for (var layer = 0; layer < 2; layer++) {
        let s = 4.0 + f32(layer) * 3.5;
        let p = uv * s;
        let id = floor(p);
        for (var y = -1; y <= 1; y++) {
            for (var x = -1; x <= 1; x++) {
                let cell = id + vec2f(f32(x), f32(y));
                let h = hash22(cell + f32(layer) * 31.0);
                if (h.y < 0.45) { continue; }
                let centre = cell + 0.15 + h * 0.7;
                let r = 0.25 + 0.3 * fract(h.x * 7.0);
                let d = length(p - centre);
                let disc = smoothstep(r, r * 0.55, d);
                var hue = vec3f(1.0, 0.58, 0.28);
                if (h.x > 0.62) { hue = vec3f(0.35, 0.55, 1.0); } else if (h.x > 0.45) { hue = vec3f(1.0, 0.35, 0.55); }

                let low = smoothstep(0.15, 0.7, centre.y / s);
                c += hue * disc * (0.10 + 0.08 * f32(layer)) * low;
            }
        }
    }
    return c;
}

fn drop_layer(uv0: vec2f, t: f32) -> vec2f {
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
    let ti = fract(t + n.z);

    let y = 1.0 - ((saw(0.85, ti) - 0.5) * 0.9 + 0.5);
    let p = vec2f(x, y);
    let d = length((st - p) * a.yx);
    let main = smoothstep(0.4, 0.0, d);
    let r = sqrt(smoothstep(0.0, y, st.y));
    let cd = abs(st.x - x);
    var trail = smoothstep(0.23 * r, 0.15 * r * r, cd);
    let behind = smoothstep(0.02, -0.02, st.y - y);
    trail *= behind * r * r;
    let yd = fract(big.y * 10.0) + (st.y - 0.5);
    let beads = smoothstep(0.3, 0.0, length(st - vec2f(x, yd)));
    return vec2f(main + beads * r * behind, trail);
}

fn static_drops(uv0: vec2f, t: f32) -> f32 {
    let uv = uv0 * 40.0;
    let id = floor(uv);
    let st = fract(uv) - 0.5;
    let n = n13(id.x * 107.45 + id.y * 3543.654);
    let p = (n.xy - 0.5) * 0.7;
    let d = length(st - p);
    let fade = saw(0.025, fract(t + n.z));
    return smoothstep(0.3, 0.0, d) * fract(n.z * 10.0) * fade;
}

fn drops(uv: vec2f, t: f32) -> vec2f {
    let s = static_drops(uv, t);
    let m1 = drop_layer(uv, t);
    let m2 = drop_layer(uv * 1.85, t);
    let c = smoothstep(0.3, 1.0, s + m1.x + m2.x);
    return vec2f(c, max(m1.y, m2.y));
}

@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let uv = canvas_uv(pos.xy);
    let t = T() * 0.2;
    let glass = uv + px(0.9);
    let c = drops(glass, t);
    let e = vec2f(0.0015, 0.0);
    let cx = drops(glass + e, t).x;
    let cy = drops(glass + e.yx, t).x;
    let normal = vec2f(cx - c.x, cy - c.x);

    let behind = uv + px(0.25);
    var col = city(behind + normal * 0.9 * F.intensity);

    let fog = 1.0 - c.y * 0.5;
    col = mix(col * 1.12, col * 0.82, fog * 0.6);
    col += vec3f(0.9, 0.95, 1.0) * c.x * 0.05;
    return out(col, pos.xy);
}
