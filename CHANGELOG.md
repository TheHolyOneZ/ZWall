# Changelog

All notable changes to **ZWall** are listed here. Versions follow [Semantic Versioning](https://semver.org/).

Installers for every version are available on the official website:
**[zsync.eu/zwall](https://zsync.eu/zwall/)**.

---

## [0.1.2] — 2026-10-26

### Fixed
- **Windows: imported videos showed only a placeholder and their title instead of a thumbnail** ([#1](https://github.com/TheHolyOneZ/ZWall/issues/1)). Video previews were made with ffmpeg, which the Windows installer doesn't include, so on most PCs the preview was never created. When ffmpeg isn't there, ZWall now takes a still frame with the mpv that ships with the installer. This works for local drives, mapped drives and network paths (NAS). With ffmpeg installed you still get the moving preview.
- **Windows: imported videos had no length or resolution in their details.** These came from ffprobe, which is part of ffmpeg. They are now read through mpv when ffprobe is missing.
- **Video resolution showed as 0 × 0 with newer ffmpeg versions** (Linux too). Newer ffprobe versions add an extra separator to its output, which ZWall couldn't read.

---

## [0.1.1] — 2026-10-19

### Fixed
- **The wallpaper engine wouldn't start ("The wallpaper engine is asleep" and *Wake it* did nothing).** This affected every 0.1.0 install on Linux and Windows:
  - **Linux (.deb / .rpm):** `/usr/bin/zwall-engine` was installed without the execute permission, so the system refused to run it. The engine is now packaged as an executable.
  - **Windows:** the engine needs the Microsoft Visual C++ runtime (`vcruntime140.dll`, `msvcp140.dll`, …), which isn't on every PC and wasn't in the installer. The installer now ships it next to the engine, so nothing extra has to be installed.
- **KDE Plasma (Wayland): photo depth didn't move on the desktop.** It worked in the app's preview, but on the real desktop the 3D parallax never followed the mouse. On Plasma Wayland the engine had no way to see the pointer. It now gets the pointer position from KWin, so near things move more than far ones on the desktop too.
- **KDE Plasma: "Bring it to life" did nothing on the desktop.** The map that marks sky, water and plants was thrown away when Plasma loaded it (an image stored with transparent pixels), so the wallpaper stayed still. The map is now stored so Plasma reads it correctly; existing maps are rebuilt automatically.
- **Updates reach the desktop right away.** When an update changes ZWall's Plasma wallpaper plugin, the engine now restarts the Plasma desktop once, so the new version is used without logging out. Your panels blink once while this happens.
- **Linux packages list everything the engine needs:** the `.deb` and `.rpm` now also depend on the Wayland EGL, XCB and C++ runtime libraries the engine links against.

### Changed
- **The app starts the engine by itself** when you open it, so you no longer have to press *Wake it*.
- **No more silent failures.** If the engine can't start, *Wake it* and the tray's *Start wallpaper engine* show why, for example "it isn't executable", "a DLL it needs is missing" or the engine's last log line, plus where its log is.
- **The engine keeps a log on Linux too:** `~/.local/share/zwall/engine.log` (Windows: `%LOCALAPPDATA%\ZWall\engine.log`).

### Build
- Every build now installs the finished package and checks that the engine really starts, on both Linux and Windows. It also checks that every DLL the Windows engine needs is part of Windows or ships with it. A broken engine can't be released again.

---

## [0.1.0] — 2026-10-03

First public release.
