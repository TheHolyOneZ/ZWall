#[cfg(target_os = "linux")]
#[path = "video_linux.rs"]
mod imp;

#[cfg(windows)]
#[path = "video_windows.rs"]
mod imp;

pub use imp::Video;
#[cfg(windows)]
pub use imp::mpv_exe;
