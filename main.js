const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// 界面语言设为简体中文：原生日期选择等控件显示中文，时间为 24 小时制
app.commandLine.appendSwitch('lang', 'zh-CN');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const DATA_DIR = path.join(__dirname, 'data');
const IMG_DIR = path.join(DATA_DIR, 'images');
const PET_DIR = path.join(__dirname, 'assets', 'pet');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const COURSES_FILE = path.join(DATA_DIR, 'courses.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
// 窗口 = 宠物 + 一侧的气泡区（Windows 不允许窗口高过屏幕，所以只留一侧；气泡翻到另一侧时窗口跟着换边）
let curSide = 'above';
let curZone = 560;
const calcZone = (petH, wa) => Math.max(200, Math.min(560, wa.height - petH - 20));
const winHeight = (h) => h + curZone;
// 宽度 = 宠物 + 两侧各一个“气泡宽度 + 按钮”，这样宠物贴边时对话框仍能整个移进屏幕（不超过屏幕宽度）
const petWidth = (h, wa) => Math.min(wa.width, Math.round(h * 1.2) + 2 * (370 + 40));
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
const STATES = ['idle', 'talk', 'urgent', 'happy', 'sleep', 'drag'];

fs.mkdirSync(IMG_DIR, { recursive: true });
fs.mkdirSync(PET_DIR, { recursive: true });

// ---------- 数据 ----------
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

let tasks = readJson(TASKS_FILE, []);
let courses = readJson(COURSES_FILE, []);
let settings = {
  cheerEnabled: true,
  cheerSeconds: 8,
  reminderSeconds: 12,
  eyeMinutes: 20,
  waterMinutes: 45,
  moveMinutes: 60,
  bubbleSeconds: 10,
  bubbleWidth: 330,
  bubbleHeight: 380,
  bubblePos: 'auto',
  bubbleTheme: 'light',
  bubbleOff: { above: { x: 0, y: 0 }, below: { x: 0, y: 0 } },
  petHeight: 220,
  visible: true,
  ...readJson(SETTINGS_FILE, {}),
};
// 旧版保存的是窗口顶部坐标（上方气泡区 340 / 560），新版保存宠物顶部坐标 petTop
if (settings.winY != null && settings.winVer !== 4) {
  settings.petTop = settings.winY + (settings.winVer === 3 ? 560 : 340);
  settings.winVer = 4;
  delete settings.winY;
}
// 窗口加宽后，保存的是宠物中心 x（原 winX 是窗口左边，旧宽度约 450）
if (settings.winX != null) {
  settings.petCX = settings.winX + Math.max(450, Math.round(settings.petHeight * 1.2) + 80) / 2;
  delete settings.winX;
}
settings.visible = true; // 启动时一律显示宠物（上次若被隐藏，托盘点击可再隐藏）
// 对话框改为“自适应高度，超过上限才滚动”，旧的尺寸设置重置为新默认值
if (settings.bubbleVer !== 2) {
  settings.bubbleWidth = 330;
  settings.bubbleHeight = 380;
  settings.bubbleVer = 2;
}
delete settings.bubbleCount;
const saveTasks = () => writeJson(TASKS_FILE, tasks);
const saveSettings = () => writeJson(SETTINGS_FILE, settings);

function compare(a, b) {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const da = a.due ? new Date(a.due).getTime() : Infinity;
  const db = b.due ? new Date(b.due).getTime() : Infinity;
  if (da !== db) return da - db;
  return a.createdAt - b.createdAt;
}
function decorated() {
  const pending = tasks.filter((t) => !t.done).sort(compare);
  const done = tasks.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  return [...pending, ...done].map((t) => ({
    ...t,
    imageUrls: (t.images || []).map((n) => pathToFileURL(path.join(IMG_DIR, n)).href),
  }));
}

function imageEntry(name) {
  return { name, url: pathToFileURL(path.join(IMG_DIR, name)).href };
}
function importImageFile(src) {
  const ext = path.extname(src).slice(1).toLowerCase() || 'png';
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  fs.copyFileSync(src, path.join(IMG_DIR, name));
  return imageEntry(name);
}
function removeImages(names) {
  for (const n of names) {
    try {
      fs.unlinkSync(path.join(IMG_DIR, path.basename(n)));
    } catch {}
  }
}

// ---------- 角色素材 ----------
// 计算图片不透明区域的包围盒（占整图的比例），用来让对话框能挪进角色画布的透明留白里
const boxCache = new Map();
function opaqueBox(full, mtime) {
  const key = full + '|' + mtime;
  if (boxCache.has(key)) return boxCache.get(key);
  let box = null;
  try {
    const img = nativeImage.createFromPath(full);
    const { width, height } = img.getSize();
    if (width && height) {
      const buf = img.toBitmap();
      const step = Math.max(1, Math.floor(Math.max(width, height) / 400));
      let l = width, t = height, r = -1, b = -1;
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          if (buf[(y * width + x) * 4 + 3] > 16) {
            if (x < l) l = x;
            if (x > r) r = x;
            if (y < t) t = y;
            if (y > b) b = y;
          }
        }
      }
      if (r >= l && b >= t) box = { l: l / width, t: t / height, r: Math.min(1, (r + step) / width), b: Math.min(1, (b + step) / height) };
    }
  } catch {}
  boxCache.set(key, box);
  return box;
}
function scanSprites() {
  const result = {};
  let files = [];
  try {
    files = fs.readdirSync(PET_DIR);
  } catch {}
  const re = new RegExp(`^(${STATES.join('|')})(?:[_-]?(\\d+))?\\.(${IMAGE_EXT.join('|')})$`, 'i');
  for (const f of files) {
    const m = f.match(re);
    if (!m) continue;
    const state = m[1].toLowerCase();
    const idx = m[2] ? parseInt(m[2], 10) : 0;
    const full = path.join(PET_DIR, f);
    const mtime = Math.floor(fs.statSync(full).mtimeMs);
    const url = pathToFileURL(full).href + '?v=' + mtime;
    (result[state] ||= []).push({ idx, url });
    const box = opaqueBox(full, mtime);
    if (box) (result._boxes ||= {})[url] = box;
  }
  for (const s of Object.keys(result)) {
    if (s === '_boxes') continue;
    result[s] = result[s].sort((a, b) => a.idx - b.idx).map((x) => x.url);
  }
  return result;
}

// ---------- 窗口 ----------
let petWin = null;
let managerWin = null;
let tray = null;

const taskWins = new Map(); // 任务 id → 独立的任务详情窗口
const broadcast = (channel, payload) => {
  for (const w of [petWin, managerWin, ...taskWins.values()]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
};
const broadcastTasks = () => broadcast('tasks', decorated());
const broadcastCourses = () => broadcast('courses', courses);

function petBounds() {
  settings.petHeight = Math.min(settings.petHeight, maxPetHeight(screen.getPrimaryDisplay().workArea));
  const petH = settings.petHeight;
  const wa = screen.getPrimaryDisplay().workArea;
  let cx = settings.petCX ?? wa.x + wa.width - Math.round(petH * 0.6) - 30;
  let petTop = settings.petTop ?? wa.y + wa.height - petH;
  // 保证宠物本体在某个屏幕内
  const d = screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(petTop + petH / 2) }).workArea;
  curZone = calcZone(petH, d);
  const w = petWidth(petH, d);
  cx = Math.min(Math.max(cx, d.x + 50), d.x + d.width - 50);
  petTop = Math.min(Math.max(petTop, d.y), d.y + d.height - petH);
  return { x: Math.round(cx - w / 2), y: curSide === 'above' ? petTop - curZone : petTop, width: w, height: winHeight(petH) };
}

// 宠物在屏幕上的权威位置（脚底以上的“宠物顶部”和水平中心）。窗口怎么变（换边、缩放）都以它为准，
// 不从窗口坐标反推，避免高 DPI 取整误差累积，也保证气泡换边时宠物绝不动
let petPos = { cx: 0, top: 0 };
// 窗口尺寸也用“名义值”，绝不从 getBounds() 读回再设置：高 DPI 下 DIP→像素取整会让读回的尺寸大 1px，
// 再设回去又大 1px……拖动时窗口就会一点点变大、来回抖，连带任务栏上的小组件一起抖
let winSize = { w: 0, h: 0 };
const windowYFor = (side, top) => Math.round(side === 'above' ? top - curZone : top);

function createPetWindow() {
  const bounds = petBounds();
  petPos = { cx: bounds.x + bounds.width / 2, top: curSide === 'above' ? bounds.y + curZone : bounds.y };
  winSize = { w: bounds.width, h: bounds.height };
  petWin = new BrowserWindow({
    ...bounds,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    show: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.setIgnoreMouseEvents(true, { forward: true });
  petWin.loadFile(path.join(__dirname, 'renderer', 'pet.html'));
  petWin.on('closed', () => (petWin = null));
}

function openManager() {
  if (managerWin && !managerWin.isDestroyed()) {
    if (managerWin.isMinimized()) managerWin.restore();
    managerWin.show();
    managerWin.focus();
    return;
  }
  managerWin = new BrowserWindow({
    width: 560,
    height: 780,
    minWidth: 440,
    title: '待办管理',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  managerWin.loadFile(path.join(__dirname, 'renderer', 'manager.html'));
  managerWin.on('closed', () => (managerWin = null));
}

function openTaskWindow(id) {
  const old = taskWins.get(id);
  if (old && !old.isDestroyed()) {
    if (old.isMinimized()) old.restore();
    old.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 480,
    height: 620,
    minWidth: 340,
    minHeight: 300,
    title: '任务详情',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'task.html'), { hash: encodeURIComponent(id) });
  win.on('closed', () => taskWins.delete(id));
  taskWins.set(id, win);
}
ipcMain.on('task:openWindow', (_e, id) => openTaskWindow(String(id)));

function togglePet() {
  if (!petWin) return;
  settings.visible = !petWin.isVisible();
  petWin.setIgnoreMouseEvents(true, { forward: true });
  settings.visible ? petWin.showInactive() : petWin.hide();
  saveSettings();
}

function makeTrayIcon() {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const i = (y * size + x) * 4;
      if (d <= 14) {
        // BGRA
        buf[i] = 90; buf[i + 1] = 160; buf[i + 2] = 255; buf[i + 3] = 255;
        const ex = Math.abs(Math.abs(x - c) - 5);
        if (ex < 2 && Math.abs(y - 13) < 2.5) { buf[i] = buf[i + 1] = buf[i + 2] = 60; }
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function createTray() {
  tray = new Tray(makeTrayIcon());
  tray.setToolTip('桌宠待办');
  const menu = Menu.buildFromTemplate([
    { label: '待办管理', click: openManager },
    { label: '显示 / 隐藏宠物', click: togglePet },
    { label: '打开角色素材文件夹', click: () => shell.openPath(PET_DIR) },
    { label: '重新加载角色', click: () => broadcast('sprites', scanSprites()) },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', togglePet);
  tray.on('double-click', openManager);
}

// ---------- IPC ----------
ipcMain.handle('tasks:get', () => decorated());
ipcMain.handle('tasks:add', (_e, t) => {
  tasks.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: String(t.title || '').trim(),
    text: String(t.text || '').trim(),
    priority: [1, 2, 3].includes(t.priority) ? t.priority : 2,
    due: t.due || null,
    links: t.links || [],
    images: t.images || [],
    done: false,
    createdAt: Date.now(),
  });
  saveTasks();
  broadcastTasks();
});
ipcMain.handle('tasks:update', (_e, id, patch) => {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  if (patch.images) removeImages((t.images || []).filter((n) => !patch.images.includes(n)));
  Object.assign(t, patch);
  if (patch.done === false) delete t.doneAt;
  saveTasks();
  broadcastTasks();
});
ipcMain.handle('tasks:complete', (_e, id) => {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = true;
  t.doneAt = Date.now();
  saveTasks();
  broadcastTasks();
  if (petWin) petWin.webContents.send('task-completed');
});
ipcMain.handle('tasks:delete', (_e, id) => {
  const t = tasks.find((x) => x.id === id);
  if (t) removeImages(t.images || []);
  tasks = tasks.filter((x) => x.id !== id);
  saveTasks();
  broadcastTasks();
});
ipcMain.handle('tasks:clearDone', () => {
  tasks.filter((t) => t.done).forEach((t) => removeImages(t.images || []));
  tasks = tasks.filter((t) => !t.done);
  saveTasks();
  broadcastTasks();
});

// ---------- 课程表 ----------
const reTime = /^([01]\d|2[0-3]):[0-5]\d$/;
const reDate = /^\d{4}-\d{2}-\d{2}$/;
function cleanCourse(c, id) {
  const wd = Math.round(+c.weekday);
  return {
    id: id || c.id || `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: String(c.name || '').trim().slice(0, 100),
    teacher: String(c.teacher || '').trim().slice(0, 60),
    mode: c.mode === 'online' ? 'online' : 'offline',
    place: String(c.place || '').trim().slice(0, 300),
    weekday: wd >= 1 && wd <= 7 ? wd : 1,
    start: reTime.test(c.start) ? c.start : '09:00',
    end: reTime.test(c.end) ? c.end : '10:00',
    from: reDate.test(c.from || '') ? c.from : null,
    until: reDate.test(c.until || '') ? c.until : null,
    interval: Math.min(Math.max(Math.round(+c.interval) || 1, 1), 8),
    exceptions: Array.isArray(c.exceptions) ? c.exceptions.filter((d) => reDate.test(d)) : [],
    source: c.source === 'ics' ? 'ics' : 'manual',
    uid: String(c.uid || '').slice(0, 200),
  };
}
const commitCourses = () => {
  writeJson(COURSES_FILE, courses);
  broadcastCourses();
};
ipcMain.handle('courses:get', () => courses);
ipcMain.handle('courses:add', (_e, list) => {
  for (const c of [].concat(list)) {
    const cc = cleanCourse({ ...c, id: undefined });
    if (cc.name) courses.push(cc);
  }
  commitCourses();
});
ipcMain.handle('courses:update', (_e, id, patch) => {
  const i = courses.findIndex((c) => c.id === id);
  if (i < 0) return;
  courses[i] = cleanCourse({ ...courses[i], ...patch }, id);
  commitCourses();
});
ipcMain.handle('courses:delete', (_e, id) => {
  courses = courses.filter((c) => c.id !== id);
  commitCourses();
});
ipcMain.handle('courses:clear', () => {
  courses = [];
  commitCourses();
});
ipcMain.handle('courses:import', (_e, { list, replaceIcs }) => {
  if (replaceIcs) courses = courses.filter((c) => c.source !== 'ics');
  for (const c of list || []) {
    const cc = cleanCourse({ ...c, id: undefined, source: 'ics' });
    if (cc.name) courses.push(cc);
  }
  commitCourses();
});
ipcMain.handle('dialog:ics', async () => {
  const r = await dialog.showOpenDialog(managerWin, { properties: ['openFile'], filters: [{ name: '日历文件 (.ics)', extensions: ['ics'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  return { name: path.basename(r.filePaths[0]), text: fs.readFileSync(r.filePaths[0], 'utf8') };
});

ipcMain.handle('dialog:files', async () => {
  const r = await dialog.showOpenDialog(managerWin, { properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths.map((p) => ({ type: 'file', target: p, name: path.basename(p) }));
});
ipcMain.handle('dialog:images', async () => {
  const r = await dialog.showOpenDialog(managerWin, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: IMAGE_EXT }],
  });
  return r.canceled ? [] : r.filePaths.map(importImageFile);
});
ipcMain.handle('image:import', (_e, p) => importImageFile(p));
ipcMain.handle('image:saveBuffer', (_e, buf, ext) => {
  const safeExt = IMAGE_EXT.includes(ext) ? ext : 'png';
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${safeExt}`;
  fs.writeFileSync(path.join(IMG_DIR, name), Buffer.from(buf));
  return imageEntry(name);
});

ipcMain.handle('open:target', async (_e, target) => {
  if (/^https?:\/\//i.test(target)) {
    await shell.openExternal(target);
    return '';
  }
  return shell.openPath(target); // 失败时返回错误信息
});
ipcMain.handle('open:image', (_e, name) => shell.openPath(path.join(IMG_DIR, path.basename(name))));

ipcMain.handle('settings:get', () => settings);
// 以“宠物底边中点”为锚点缩放。anchor 由调用方在缩放开始时固定下来，
// 否则每次从窗口当前位置反推，在高 DPI 的取整误差下会逐帧累积，宠物就会慢慢飘走
function petAnchor() {
  return { cx: petPos.cx, bottom: petPos.top + settings.petHeight };
}
// 宠物最大高度：窗口 = 宠物 + 气泡区(至少 200)，而 Windows 不允许窗口比屏幕高，
// 所以小屏幕上宠物不能拉到 600，否则下半身会被窗口边缘切掉
const maxPetHeight = (wa) => Math.min(600, Math.max(80, wa.height - 220));
function applyPetSize(h, anchor) {
  h = Math.max(Math.round(h), 80);
  if (!petWin) return void (settings.petHeight = Math.min(h, 600));
  const { cx, bottom } = anchor || petAnchor();
  const wa = screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(bottom - 1) }).workArea;
  h = Math.min(h, maxPetHeight(wa));
  settings.petHeight = h;
  const w = petWidth(h, wa);
  curZone = calcZone(h, wa);
  petPos = { cx, top: bottom - h };
  winSize = { w, h: winHeight(h) };
  petWin.setBounds({
    x: Math.round(cx - w / 2),
    y: windowYFor(curSide, bottom - h),
    width: w,
    height: winHeight(h),
  });
  // 气泡区高度随宠物大小变化，要跟窗口同时通知页面；等 150ms 的定时刷新会让页面里的布局比窗口大，下半身被切
  petWin.webContents.send('zone', curZone);
  broadcast('settings', settings);
}
function savePetPos() {
  if (!petWin) return;
  settings.petCX = petPos.cx;
  settings.petTop = petPos.top;
  saveSettings();
}
ipcMain.handle('settings:set', (_e, patch) => {
  if (patch.cheerEnabled !== undefined) settings.cheerEnabled = String(patch.cheerEnabled) === 'true';
  for (const k of ['eyeMinutes', 'waterMinutes', 'moveMinutes', 'cheerSeconds', 'reminderSeconds']) {
    if (patch[k] !== undefined && Number.isFinite(+patch[k])) settings[k] = Math.min(Math.max(Math.round(+patch[k]), 0), 600);
  }
  for (const k of ['bubbleSeconds', 'bubbleWidth', 'bubbleHeight']) {
    if (patch[k] !== undefined && Number.isFinite(+patch[k])) settings[k] = +patch[k];
  }
  settings.bubbleWidth = Math.min(Math.max(settings.bubbleWidth, 200), 370);
  settings.bubbleHeight = Math.min(Math.max(settings.bubbleHeight, 120), 480);
  if (['light', 'dark'].includes(patch.bubbleTheme)) settings.bubbleTheme = patch.bubbleTheme;
  if (['auto', 'above', 'below'].includes(patch.bubblePos)) settings.bubblePos = patch.bubblePos;
  if (patch.bubbleOff) {
    const num = (v) => (Number.isFinite(+v) ? Math.round(+v) : 0);
    for (const k of ['above', 'below']) {
      const o = patch.bubbleOff[k];
      if (o) settings.bubbleOff[k] = { x: num(o.x), y: num(o.y) };
    }
  }
  if (patch.petHeight !== undefined && Number.isFinite(+patch.petHeight)) applyPetSize(+patch.petHeight);
  saveSettings();
  broadcast('settings', settings);
});

ipcMain.handle('sprites:get', () => scanSprites());

// 拖动 / 缩放都由主进程按全局鼠标位置驱动，避免 DPI 缩放下窗口相对鼠标漂移
let loop = null;
const stopLoop = () => {
  clearInterval(loop);
  loop = null;
};
ipcMain.on('pet:dragStart', () => {
  if (!petWin) return;
  stopLoop();
  const c = screen.getCursorScreenPoint();
  const start = { ...petPos };
  const petH = settings.petHeight;
  let lastX = null;
  let lastY = null;
  loop = setInterval(() => {
    if (!petWin) return stopLoop();
    const p = screen.getCursorScreenPoint();
    // 可以拖出屏幕一部分，但宠物至少要有约 35% 留在屏幕内，免得整只拖丢
    const wa = screen.getDisplayNearestPoint(p).workArea;
    const cx = Math.min(Math.max(start.cx + p.x - c.x, wa.x - 0.15 * petH), wa.x + wa.width + 0.15 * petH);
    const top = Math.min(Math.max(start.top + p.y - c.y, wa.y - 0.65 * petH), wa.y + wa.height - 0.35 * petH);
    petPos = { cx, top };
    const x = Math.round(cx - winSize.w / 2);
    const y = windowYFor(curSide, top);
    if (x === lastX && y === lastY) return; // 位置没变就不动窗口，减少无谓的重排
    lastX = x;
    lastY = y;
    petWin.setBounds({ x, y, width: winSize.w, height: winSize.h });
  }, 16); // 约 60Hz，跟显示器刷新对齐（原来 8ms 比刷新还快，反而更抖）
});
ipcMain.handle('pet:getEnv', () => {
  if (!petWin) return null;
  const c = { x: Math.round(petPos.cx), y: Math.round(petPos.top + settings.petHeight / 2) };
  return { x: Math.round(petPos.cx - winSize.w / 2), y: windowYFor(curSide, petPos.top), z: curZone, side: curSide, wa: screen.getDisplayNearestPoint(c).workArea };
});
ipcMain.handle('pet:setSide', (_e, side) => {
  if (!petWin || (side !== 'above' && side !== 'below') || side === curSide) return;
  curSide = side;
  // 宠物位置 petPos 不变，只把窗口移到另一侧
  petWin.setBounds({ x: Math.round(petPos.cx - winSize.w / 2), y: windowYFor(side, petPos.top), width: winSize.w, height: winSize.h });
});
ipcMain.on('pet:resizeStart', (_e, sign) => {
  if (!petWin) return;
  stopLoop();
  const c = screen.getCursorScreenPoint();
  const h0 = settings.petHeight;
  const anchor = petAnchor();
  loop = setInterval(() => {
    if (!petWin) return stopLoop();
    applyPetSize(h0 + (screen.getCursorScreenPoint().x - c.x) * 2 * (sign < 0 ? -1 : 1), anchor);
  }, 16);
});
ipcMain.on('pet:loopEnd', () => {
  stopLoop();
  savePetPos();
  saveSettings();
});
ipcMain.on('pet:resizeBy', (_e, delta) => {
  applyPetSize(settings.petHeight + delta);
  savePetPos();
  saveSettings();
});
ipcMain.on('pet:ignoreMouse', (_e, ignore) => {
  if (petWin) petWin.setIgnoreMouseEvents(ignore, { forward: true });
});
ipcMain.on('manager:open', openManager);
ipcMain.on('pet:menu', () => {
  Menu.buildFromTemplate([
    { label: '添加待办…', click: openManager },
    { label: '显示 / 隐藏任务气泡', click: () => petWin && petWin.webContents.send('toggle-bubble') },
    { type: 'separator' },
    { label: '打开角色素材文件夹', click: () => shell.openPath(PET_DIR) },
    { label: '重新加载角色', click: () => broadcast('sprites', scanSprites()) },
    { label: '隐藏宠物（托盘可找回）', click: togglePet },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]).popup({ window: petWin });
});

// ---------- 启动 ----------
app.whenReady().then(() => {
  createPetWindow();
  createTray();
  let timer = null;
  try {
    fs.watch(PET_DIR, () => {
      clearTimeout(timer);
      timer = setTimeout(() => broadcast('sprites', scanSprites()), 300);
    });
  } catch {}
});
app.on('second-instance', () => {
  if (petWin && !petWin.isVisible()) togglePet();
  openManager();
});
app.on('window-all-closed', (e) => e.preventDefault()); // 常驻托盘
