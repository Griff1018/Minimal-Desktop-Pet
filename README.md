# Desktop Pet To-Do

**English** | [简体中文](README.zh-CN.md)

A Windows desktop pet that keeps your to-do list and class timetable. The pet sits on your desktop, shows pending tasks in a speech bubble ordered by priority, and nudges you to rest your eyes, drink water and move around. Draw your own character and drop the PNGs in.

## Features

- **Tasks**: title + content, file links, images, priority (red / amber / green), optional due date and time (24h).
- **Speech bubble**: lists tasks by priority. Click one to focus it, or open it in its own window. A faint "work left to do" hint stays by the pet when the list is closed.
- **Calendar**: a full calendar in the manager, plus a mini calendar in the bubble with today's tasks and classes.
- **Timetable**: weekly courses with name, time slot, online / offline / online + offline, teacher, place, credits, term range and every-N-weeks interval. Shown in both calendars.
- **ICS import** (e.g. a university timetable export): preview before importing, repeated events merged into weekly rules, duplicates skipped, and overlapping online / offline entries of the same course merged only if you choose to.
- **Stats**: course count, credits, weekly study hours. Overlapping online / offline slots count once.
- **Reminders and cheers**: eye, water and movement reminders with configurable intervals, plus encouraging messages that disappear after a configurable time.
- **Pet window**: drag, resize, always on top, click-through outside the pet. The bubble flips above / below and the controls move away from screen edges.
- **Mini radio**: always shown beside the pet. Previous / play-pause / next, volume down / mute / up, and the current song title (scrolls if long). Works with any player that uses Windows media controls (Spotify, browsers, etc.). Click ⏻ to collapse it to a 📻 icon; it can also be hidden in settings.
- **Fade when idle**: the bubble and radio become semi-transparent a few seconds after the mouse leaves them and return to full opacity on hover. Can be turned off in settings.
- **Themes**: light (blue line-art) and dark (VS Code style). One setting switches the pet bubble, task window and manager window together.

## Install

Download `Setup` from the [Releases](../../releases) page and run it.

- The installer registers the app to **start with Windows** (current user). Uninstalling removes it.
- It is unsigned, so Windows SmartScreen may warn: *More info → Run anyway*.
- Your data is stored in `%APPDATA%\desktop-pet-todo\data` and survives updates.

## Use your own character

Open the tray icon menu → **Open character folder** (`%APPDATA%\desktop-pet-todo\pet` for the installed app, `assets/pet` when running from source) and put transparent PNGs there:

| State | Files | When shown |
| --- | --- | --- |
| idle | `idle.png` | default |
| talk | `talk.png` | bubble open |
| urgent | `urgent.png` | urgent task pending |
| happy | `happy.png` | tasks done |
| sleep | `sleep.png` | no tasks |
| drag | `drag.png` | being dragged |

Add frames with `_1`, `_2`, … (e.g. `idle_1.png`, `idle_2.png`) for animation. A square canvas around 800×800 is recommended. Changes are picked up automatically. See `assets/pet/README.txt` for details. Without images the pet falls back to an emoji.

## Custom app icon

Put a square, transparent `icon.png` (512×512 recommended, at least 256×256) at `build/icon.png`. It is used for the tray, the manager and task windows, and, after `npm run dist`, for the installer and the exe. Without it a small blue face is drawn.

## Run from source

Requires Node.js 18+.

```bash
npm install
npm start          # or double-click 启动桌宠.bat
npm run dist       # build the installer into dist/
```

When running from source, data lives in `data/` inside the project (git-ignored).

## Customize

- Reminder and cheer texts: [renderer/pet.js](renderer/pet.js) (`CHEER_NORMAL`, `CHEER_URGENT` and the reminder `texts` arrays).
- Reminder intervals, bubble time, theme, pet size, radio and fade on / off: in the manager's settings.

## Project layout

```
main.js          Electron main process (windows, tray, drag/resize, data IPC)
preload.js       Safe API exposed to the pages
renderer/        Pet, manager, task window, timetable, ICS parser, themes
assets/pet/      Character sprites
build/           Installer script (auto-start) and icon.png
```

## License

Add a license of your choice (e.g. MIT) before publishing.
