use crate::server::Hub;
use std::{
    io::Read,
    path::Path,
    process::Stdio,
    sync::Arc,
};
use zwall_ipc::{LibraryItem, Request};

pub fn duration(path: &str) -> Option<f32> {
    let out = crate::desktop::command("ffprobe").args(["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path]).output().ok()?;
    String::from_utf8_lossy(&out.stdout).trim().parse().ok()
}

pub fn video_size(path: &str) -> Option<(u32, u32)> {
    let out = crate::desktop::command("ffprobe").args(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", path]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let (w, h) = text.trim().trim_end_matches('x').split_once('x')?;
    Some((w.parse().ok()?, h.parse().ok()?))
}

fn has_audio(path: &str) -> bool {
    crate::desktop::command("ffprobe")
        .args(["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path])
        .output()
        .is_ok_and(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
}

const W: usize = 64;
const H: usize = 36;
const FPS: f32 = 10.0;

fn frames(path: &str, from: f32, to: f32) -> anyhow::Result<Vec<Vec<u8>>> {
    let mut child = crate::desktop::command("ffmpeg")
        .args(["-v", "error", "-ss", &format!("{from:.3}"), "-t", &format!("{:.3}", (to - from).max(0.1)), "-i", path])
        .args(["-vf", &format!("fps={FPS},scale={W}:{H}"), "-f", "rawvideo", "-pix_fmt", "gray", "-"])
        .stdout(Stdio::piped())
        .spawn()?;
    let mut raw = Vec::new();
    child.stdout.take().unwrap().read_to_end(&mut raw)?;
    child.wait()?;
    Ok(raw.chunks_exact(W * H).map(|c| c.to_vec()).collect())
}

fn diff(a: &[u8], b: &[u8]) -> u64 {
    a.iter().zip(b).map(|(x, y)| (*x as i32 - *y as i32).unsigned_abs() as u64).sum()
}

pub fn best_end(path: &str, start: f32, end: f32) -> anyhow::Result<f32> {
    let first = frames(path, start, start + 0.1)?.into_iter().next().ok_or_else(|| anyhow::anyhow!("no frames"))?;
    let search_from = start + (end - start) * 0.6;
    let tail = frames(path, search_from, end)?;
    let best = tail.iter().enumerate().min_by_key(|(_, f)| diff(f, &first)).map(|(i, _)| i).unwrap_or(tail.len().saturating_sub(1));
    Ok((search_from + best as f32 / FPS).min(end))
}

pub fn make(hub: Arc<Hub>, path: String, start: f32, end: f32, crossfade: f32, find_best: bool) {
    std::thread::spawn(move || {
        let name = hub.snapshot().library.iter().find(|i| i.path == path).map(|i| i.name.clone()).unwrap_or_else(|| Path::new(&path).file_stem().map_or("video".into(), |s| s.to_string_lossy().into_owned()));
        hub.set_job(&path, Some("Making a seamless loop…".into()));
        let result = (|| -> anyhow::Result<String> {
            let total = duration(&path).ok_or_else(|| anyhow::anyhow!("ffprobe couldn't read the video"))?;
            let start = start.clamp(0.0, total);
            let mut end = end.clamp(start + 0.5, total);
            if find_best {
                end = best_end(&path, start, end)?;
                log::info!("loop: best end for {path} is {end:.2}s");
            }
            let len = end - start;
            anyhow::ensure!(len >= 1.0, "the loop needs to be at least a second long");
            let f = crossfade.clamp(0.1, len / 3.0);
            let dir = crate::desktop::data_dir().join("library");
            std::fs::create_dir_all(&dir)?;
            let stem = Path::new(&path).file_stem().map_or("video".into(), |s| s.to_string_lossy().into_owned());
            let out = dir.join(format!("{stem}-loop-{:.0}-{:.0}.mp4", start * 10.0, end * 10.0));

            let mut filter = format!(
                "[0:v]split[a][b];[a]trim=start={f},setpts=PTS-STARTPTS[main];[b]trim=0:{f},setpts=PTS-STARTPTS[head];[main][head]xfade=transition=fade:duration={f}:offset={off}[v]",
                off = len - 2.0 * f
            );
            let audio = has_audio(&path);
            if audio {
                filter.push_str(&format!(";[0:a]asplit[aa][ab];[aa]atrim=start={f},asetpts=PTS-STARTPTS[am];[ab]atrim=0:{f},asetpts=PTS-STARTPTS[ah];[am][ah]acrossfade=d={f}[aud]"));
            }
            let mut cmd = crate::desktop::command("ffmpeg");
            cmd.args(["-v", "error", "-y", "-ss", &format!("{start:.3}"), "-t", &format!("{len:.3}"), "-i", &path, "-filter_complex", &filter, "-map", "[v]"]);
            if audio {
                cmd.args(["-map", "[aud]", "-c:a", "aac", "-b:a", "160k"]);
            }
            cmd.args(["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]).arg(&out);
            let o = cmd.output()?;
            anyhow::ensure!(o.status.success(), "ffmpeg: {}", String::from_utf8_lossy(&o.stderr).lines().last().unwrap_or("failed"));
            let out = out.to_string_lossy().into_owned();
            let looped = if name.ends_with("(loop)") { name.clone() } else { format!("{name} (loop)") };
            hub.request(Request::AddToLibrary(LibraryItem { path: out.clone(), name: looped.clone(), kind: "video".into(), added: 0, from_watch: None }));
            crate::previews::request(hub.clone(), out.clone());
            Ok(format!("{looped} is on your shelf, {:.1} s long", len - f))
        })();
        hub.set_job(&path, None);
        match result {
            Ok(msg) => hub.notice(msg),
            Err(e) => hub.notice_error(format!("Couldn't make the loop: {e:#}")),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_difference() {
        assert_eq!(diff(&[0, 10, 20], &[0, 10, 20]), 0);
        assert_eq!(diff(&[0, 10], &[5, 0]), 15);
    }
}
