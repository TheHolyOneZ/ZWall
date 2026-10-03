

@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var depthTex: texture_2d<f32>;

@group(0) @binding(4) var motionTex: texture_2d<f32>;

@fragment
fn fs_main(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let dim = vec2f(textureDimensions(tex));
    let screen = ripple_warp(pos.xy + F.origin) / F.canvas;

    let scale = max(F.canvas.x / dim.x, F.canvas.y / dim.y) * 1.08;
    let size = dim * scale / F.canvas;
    let breathe = 1.0 + 0.006 * sin(F.time * 0.2);
    let uv0 = ((screen - 0.5) / size) / breathe + 0.5;
    let shift = F.cursor * vec2f(0.024, 0.015) * F.depth;

    var uv = uv0;
    for (var i = 0; i < 3; i++) {
        let d = textureSampleLevel(depthTex, samp, uv, 0.0).r;
        uv = uv0 - shift * (d - 0.4);
    }
    let m = textureSampleLevel(motionTex, samp, uv, 0.0) * F.grade.w;
    let t = F.time;

    let near = 1.0 - smoothstep(0.0, 0.3, distance(screen, F.cursor * 0.5 + 0.5));
    var off = m.g * vec2f(sin(uv.y * 140.0 + t * 2.2), 0.6 * cos(uv.x * 90.0 + t * 1.7)) * (0.0014 + 0.0026 * near);
    off.x += m.b * sin(t * 1.1 + uv.y * 18.0 + uv.x * 6.0) * 0.0022;
    off.x += m.r * sin(t * 0.07 + uv.y * 3.0) * 0.003;
    var c = textureSampleLevel(tex, samp, uv + off, 0.0).rgb;
    let l = dot(c, vec3f(0.299, 0.587, 0.114));

    if (m.r > 0.01) {
        let px = 3.0 / dim;
        let around = (textureSampleLevel(tex, samp, uv + off + vec2f(px.x, 0.0), 0.0).rgb + textureSampleLevel(tex, samp, uv + off - vec2f(px.x, 0.0), 0.0).rgb
            + textureSampleLevel(tex, samp, uv + off + vec2f(0.0, px.y), 0.0).rgb + textureSampleLevel(tex, samp, uv + off - vec2f(0.0, px.y), 0.0).rgb) * 0.25;
        let speck = smoothstep(0.06, 0.25, l - dot(around, vec3f(0.299, 0.587, 0.114)));
        let beat = hash21(floor(uv * dim / 3.0));
        c *= 1.0 + speck * m.r * (0.75 * sin(t * (1.5 + 2.0 * beat) + beat * 6.28));
    }

    c += m.g * 0.22 * (0.3 + l) * pow(max(0.0, sin(uv.x * 220.0 + uv.y * 60.0 - t * 2.4) * sin(uv.y * 170.0 + t * 1.3)), 6.0);

    c *= 1.0 + m.a * 0.18 * sin(t * 2.0 + hash21(floor(uv * 8.0)) * 6.28);
    let glint = ripple_band(pos.xy + F.origin) * 0.12;

    return vec4f(clamp((grade(c * (0.5 + 0.5 * F.intensity)) + glint) * F.grade.rgb, vec3f(0.0), vec3f(1.0)), 1.0);
}
