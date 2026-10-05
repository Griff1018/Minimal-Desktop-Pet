const bubble = document.getElementById('bubble');
const bubbleBody = document.getElementById('bubbleBody');
const bgrip = document.getElementById('bgrip');
const bside = document.getElementById('bside');
const stage = document.getElementById('stage');
const bmove = document.getElementById('bmove');
const bflip = document.getElementById('bflip');
const bcal = document.getElementById('bcal');
const zoneTop = document.getElementById('zoneTop');
const zoneBottom = document.getElementById('zoneBottom');
const petWrap = document.getElementById('petWrap');
const sprite = document.getElementById('sprite');
const emoji = document.getElementById('emoji');

const EMOJI = { idle: '😺', talk: '😸', urgent: '🙀', happy: '😻', sleep: '😴', drag: '😿' };
const FALLBACK = { talk: null, urgent: 'idle', sleep: 'idle', happy: 'idle', drag: 'idle', idle: null };

let tasks = [];
let sprites = {};
let settings = { bubbleSeconds: 10, petHeight: 220, bubbleWidth: 330, bubbleHeight: 380, bubblePos: 'auto', bubbleTheme: 'light' };
let reminder = null; // 当前显示的定时提醒 / 完成鼓励 { icon, text, until }
let cheerText = '';
let cheerDismissed = false; // 打气话已到时间消失（任务对话框可能还开着）
let cheerTimer = null;
let cheerSide = 'right';
let bubbleMode = 'list'; // 'list' 任务列表 | 'cal' 日历 + 当天待办
let calMonth = null; // 日历当前显示的月份（当月 1 号）
let calSel = null; // 日历选中的日期 'YYYY-MM-DD'
let focusId = null; // 对话框里正在“聚焦”查看的任务
let env = null; // { x, y, wa }：窗口位置与所在屏幕工作区
let appliedX = 0;
let appliedY = 0;
let currentPos = 'above';
let dragging = false;
let happyUntil = 0;
let pinned = false;
let hideTimer = null;
let frameIdx = 0;
let shownKey = '';

const pending = () => tasks.filter((t) => !t.done);
const isOverdue = (t) => t.due && new Date(t.due).getTime() < Date.now();
const isUrgent = (t) => t.priority === 3 || isOverdue(t);
const bubbleVisible = () => !bubble.classList.contains('hidden');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function fmtDue(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- 状态与形象 ----------
function baseState() {
  const p = pending();
  if (!p.length) return 'sleep';
  return p.some(isUrgent) ? 'urgent' : 'idle';
}
function currentState() {
  if (dragging) return 'drag';
  if (Date.now() < happyUntil) return 'happy';
  if (bubbleVisible() || reminder) return 'talk';
  return baseState();
}
function resolveState(s) {
  // 沿回退链找到第一个有素材的状态：talk → 当前基础状态 → idle
  const chain = [s];
  if (s === 'talk') chain.push(baseState());
  chain.push('idle');
  return chain.find((x) => sprites[x] && sprites[x].length) || null;
}
// ---------- 悬停淡入淡出：鼠标在宠物 / 对话框 / 收音机上时完全显示，离开几秒后变半透明 ----------
const DIM_DELAY = 3000;
let dimTimer = 0;
function wake(hovering) {
  if (hovering || settings.dimEnabled === false) {
    clearTimeout(dimTimer);
    dimTimer = 0;
    document.body.classList.remove('dim');
  } else if (!dimTimer && !document.body.classList.contains('dim')) {
    dimTimer = setTimeout(() => {
      dimTimer = 0;
      document.body.classList.add('dim');
    }, DIM_DELAY);
  }
}
document.addEventListener('mouseleave', () => wake(false));

// ---------- 小收音机（一直显示，控制系统媒体键） ----------
const radioEl = document.getElementById('radio');
radioEl.addEventListener('mousedown', (e) => e.stopPropagation()); // 不触发宠物拖动
radioEl.addEventListener('click', (e) => {
  const b = e.target.closest('b[data-k]');
  if (b) window.api.mediaKey(b.dataset.k);
});
radioEl.addEventListener('wheel', (e) => e.stopPropagation()); // 滚轮不缩放宠物
for (const ev of ['dblclick', 'contextmenu']) radioEl.addEventListener(ev, (e) => e.stopPropagation());
let radioOpen = true;
try {
  radioOpen = localStorage.getItem('radioOpen') !== '0';
} catch {}
const rTitle = document.getElementById('rTitle');
const rPlay = document.getElementById('rPlay');
function setRadioOpen(open) {
  radioOpen = open;
  try {
    localStorage.setItem('radioOpen', open ? '1' : '0');
  } catch {}
  placeRadio();
  updateLayout(); // 收音机占的位置变了，宠物缩放按钮要重新避让
}
document.getElementById('rOff').addEventListener('click', () => setRadioOpen(false));
document.getElementById('rMini').addEventListener('click', () => setRadioOpen(true));
// 歌名：太长就循环滚动
function showMediaInfo(info) {
  const text = info && info.title ? `♪ ${info.title}${info.artist ? ' - ' + info.artist : ''}` : '♪ 没有在播放';
  const span = rTitle.firstElementChild;
  if (span.dataset.t !== text) {
    span.dataset.t = text;
    span.textContent = text;
    rTitle.title = text;
    rTitle.classList.remove('scroll');
    requestAnimationFrame(() => {
      if (span.scrollWidth > rTitle.clientWidth) {
        span.textContent = text + '　' + text; // 复制一份，滚动时首尾衔接
        rTitle.style.setProperty('--shift', '-50%');
        rTitle.classList.add('scroll');
      }
    });
  }
  rPlay.textContent = info && info.playing ? '⏸' : '▶';
}
window.api.onMediaInfo(showMediaInfo);
let radioWatching = false;
function placeRadio() {
  const show = settings.radioEnabled !== false;
  radioEl.classList.toggle('hidden', !show);
  radioEl.classList.toggle('collapsed', !radioOpen);
  const want = show && radioOpen;
  if (want !== radioWatching) {
    radioWatching = want;
    window.api.mediaWatch(want);
  }
  if (!show) return;
  const pr = petWrap.getBoundingClientRect();
  const vis = visRect();
  const w = radioEl.offsetWidth;
  const h = radioEl.offsetHeight;
  // 默认放在宠物左侧；那边放不下（屏幕边缘）就换到右侧。缩放把手之后会避开收音机（见 doLayout）
  const leftPos = vis.left - pr.left - w - 8;
  const rightPos = vis.right - pr.left + 8;
  // 横向可用范围（相对宠物框）：不出窗口、不出屏幕
  const wa = env ? env.wa : null;
  const xMin = Math.max(-pr.left + 2, wa ? wa.x + 2 - env.x - pr.left : -1e9);
  const xMax = Math.min(window.innerWidth - pr.left - w - 2, wa ? wa.x + wa.width - 2 - env.x - pr.left - w : 1e9);
  const fitsAt = (x) => x >= xMin && x <= xMax;
  let x = [leftPos, rightPos].find(fitsAt);
  if (x === undefined) x = Math.min(Math.max(leftPos, xMin), Math.max(xMin, xMax)); // 两边都放不下：贴着屏幕边缘，尽量不出屏
  // 纵向：贴着宠物脚边，但不能出屏幕（任务栏）或窗口
  let y = pr.height - h - pr.height * 0.04;
  const yMin = Math.max(-pr.top + 2, wa ? wa.y + 2 - env.y - pr.top : -1e9);
  const yMax = Math.min(window.innerHeight - pr.top - h - 2, wa ? wa.y + wa.height - 2 - env.y - pr.top - h : 1e9);
  y = Math.min(Math.max(y, yMin), Math.max(yMin, yMax));
  radioEl.style.left = Math.round(x) + 'px';
  radioEl.style.top = Math.round(y) + 'px';
}
function renderPet(force) {
  const s = currentState();
  const key = resolveState(s) || 'emoji:' + s;
  if (key !== shownKey || force) {
    shownKey = key;
    frameIdx = 0;
  }
  const frames = resolveState(s) ? sprites[resolveState(s)] : null;
  if (frames) {
    sprite.hidden = false;
    emoji.hidden = true;
    const url = frames[frameIdx % frames.length];
    if (sprite.getAttribute('src') !== url) sprite.src = url;
  } else {
    sprite.hidden = true;
    emoji.hidden = false;
    emoji.textContent = EMOJI[s];
  }
  placeRadio();
}
setInterval(() => {
  frameIdx++;
  renderPet();
}, 500);

// ---------- 打气话 / 定时提醒（宠物左右的半透明小对话框） ----------
const cheerEl = document.getElementById('cheer');
const hintEl = document.getElementById('hint');
// 任务列表收起、还有未完成事项时，宠物旁边一直挂着一条淡淡的提示（不自动弹出列表）
function renderHint() {
  const show = pending().length > 0 && !bubbleVisible() && !reminder;
  hintEl.classList.toggle('hidden', !show);
  if (show) placeHint();
}
// 提示条和任务对话框同一位置：在窗口当前这一侧的气泡区里，贴着宠物，套用对话框保存的偏移，并保持在屏幕内
function placeHint() {
  if (!env || hintEl.classList.contains('hidden')) return;
  const zone = env.side === 'above' ? zoneTop : zoneBottom;
  if (hintEl.parentElement !== zone) zone.append(hintEl);
  hintEl.classList.toggle('below', env.side === 'below');
  hintEl.style.transform = '';
  const r = hintEl.getBoundingClientRect();
  // 对准宠物可见部分：水平居中，紧贴头顶（在下方时贴脚下）
  const vis = visRect();
  const off = {
    x: (vis.left + vis.right) / 2 - (r.left + r.right) / 2,
    y: env.side === 'above' ? vis.top - 6 - r.bottom : vis.bottom + 6 - r.top,
  };
  const wa = env.wa;
  const sL = env.x + r.left;
  const sT = env.y + r.top;
  const clamp = (v, lo, hi) => (hi < lo ? lo : Math.min(Math.max(v, lo), hi));
  const x = clamp(off.x, Math.max(wa.x + 4 - sL, 2 - r.left), Math.min(wa.x + wa.width - 4 - (sL + r.width), window.innerWidth - 2 - r.right));
  const y = clamp(off.y, Math.max(2 - r.top, wa.y + 2 - sT), Math.min(window.innerHeight - 2 - r.bottom, wa.y + wa.height - 2 - (sT + r.height)));
  hintEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const CHEER_NORMAL = [
  '加油！一件一件来，你可以的～', '先做最小的那一步，一步一脚印', '你已经很棒了，保持节奏就好',
  '做完一项就小小奖励自己吧~', '慢慢来，比较快～', '今天也在认真生活，了不起！', '努力的你值得被鼓励~',
];
const CHEER_URGENT = [
  '有紧急的事项，请优先处理', '先处理标红的任务！，不然你就要完蛋拉~', '冲刺!♿️ 冲刺!♿️ 冲!♿️',
];
const CHEER_FEW = ['快收工啦，冲刺一下！', '只剩一点点了，胜利在望～', '最后一段路，稳稳走完！'];
const CHEER_NONE = ['任务全清空啦，你真厉害！', '今天的你超棒，好好休息一下吧～'];
const DONE_TEXTS = ['又完成一项！👏', '干得漂亮！继续保持～', '搞定！离清空更近一步啦', '这简直就是老叟洗完头，干得漂亮啊'];
function cheerPhrase() {
  const p = pending();
  if (!p.length) return pick(CHEER_NONE);
  if (p.some(isUrgent)) return pick(CHEER_URGENT);
  if (p.length <= 2) return pick(CHEER_FExW);
  return pick(CHEER_NORMAL);
}

const REMINDERS = [
  { key: 'eye', setting: 'eyeMinutes', icon: '👀', texts: [
    '盯屏幕有一阵子啦，看看 6 米外的东西 20 秒，放松一下眼睛～', '眨眨眼、转转眼珠，让眼睛休息一会儿吧', '护眼时间：远眺 20 秒，再继续加油！'] },
  { key: 'water', setting: 'waterMinutes', icon: '💧', texts: [
    '该喝水啦！来一杯吧～', '补充水分，脑子转得更快 💧', '喝口水再继续，身体会感谢你的'] },
  { key: 'move', setting: 'moveMinutes', icon: '🚶', texts: [
    '坐太久啦，站起来走动一下、伸个懒腰吧！', '起来活动活动肩颈和腿～', '离开座位走几步，回来效率更高！'] },
];
const nextDue = {};
function armReminders() {
  const now = Date.now();
  for (const r of REMINDERS) {
    const m = +settings[r.setting] || 0;
    if (!nextDue[r.key] || nextDue[r.key].m !== m) nextDue[r.key] = { m, at: now + m * 60000 };
  }
}
function showReminder(r, ms) {
  // 提醒默认按设置的秒数；0 表示不自动消失，点一下才关
  if (ms === undefined) ms = settings.reminderSeconds > 0 ? settings.reminderSeconds * 1000 : Infinity;
  reminder = { icon: r.icon, text: r.text, until: Date.now() + ms };
  renderCheer();
  renderPet();
}
function clearReminder() {
  reminder = null;
  renderCheer();
  renderPet();
}
cheerEl.addEventListener('click', () => reminder && clearReminder());
setInterval(() => {
  const now = Date.now();
  if (reminder) {
    if (now > reminder.until) clearReminder();
    return;
  }
  for (const r of REMINDERS) {
    const d = nextDue[r.key];
    if (d && d.m > 0 && now >= d.at) {
      d.at = now + d.m * 60000;
      showReminder({ icon: r.icon, text: pick(r.texts) });
      break; // 一次只弹一条，别的顺延到下一轮
    }
  }
}, 5000);

function renderCheer() {
  renderHint();
  const show = reminder || (settings.cheerEnabled !== false && bubbleVisible() && !cheerDismissed);
  if (!show) {
    cheerEl.classList.add('hidden');
    return;
  }
  const text = reminder ? reminder.text : cheerText;
  const wasHidden = cheerEl.classList.contains('hidden');
  if (wasHidden || cheerEl.dataset.text !== text) {
    cheerEl.replaceChildren();
    if (reminder) cheerEl.append(el('span', 'ico', reminder.icon));
    cheerEl.append(document.createTextNode(text));
    cheerEl.dataset.text = text;
  }
  cheerEl.classList.toggle('reminder', !!reminder);
  cheerEl.classList.remove('hidden');
  positionCheer();
}
// 放在宠物可见部分的右 / 左 / 头顶：优先保持上次的位置；每个候选位置都先夹进屏幕（任务栏、屏幕边缘）和窗口里，
// 再按“被推开多远 / 压到宠物 / 盖住任务对话框 / 盖住小收音机”打分，取最合适的一个
function placeBeside(elm) {
  if (elm.classList.contains('hidden') || !env) return;
  // 任务对话框打开时：打气话叠在对话框的外侧（对话框在宠物上方就叠在它上面，在下方就叠在它下面），宽度一致，像两层
  elm.style.width = '';
  elm.style.maxWidth = '';
  elm.classList.remove('at-stack');
  if (bubbleVisible() && !bubble.classList.contains('hidden')) {
    const br = bubble.getBoundingClientRect();
    elm.style.width = br.width + 'px';
    elm.style.maxWidth = 'none';
    const h = elm.offsetHeight;
    const above = currentPos !== 'below';
    const top = above ? br.top - h - 16 : br.bottom + 6; // 上方留出对话框左上角的 + 标记
    const wa = env.wa;
    const okY = top >= Math.max(2, wa.y + 2 - env.y) && top + h <= Math.min(window.innerHeight - 2, wa.y + wa.height - 2 - env.y);
    const okX = br.left >= 2 && br.right <= window.innerWidth - 2;
    if (okY && okX) {
      elm._side = 'stack';
      elm.style.left = Math.round(br.left) + 'px';
      elm.style.top = Math.round(top) + 'px';
      elm.classList.remove('at-right', 'at-left', 'at-top');
      elm.classList.add('at-stack');
      return;
    }
    elm.style.width = ''; // 外侧放不下：退回到宠物旁边
    elm.style.maxWidth = '';
  }
  const vis = visRect();
  const w = elm.offsetWidth;
  const h = elm.offsetHeight;
  const wa = env.wa;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  const minX = Math.max(2, wa.x + 2 - env.x);
  const maxX = Math.min(window.innerWidth - 2 - w, wa.x + wa.width - 2 - env.x - w);
  const minY = Math.max(2, wa.y + 2 - env.y);
  const maxY = Math.min(window.innerHeight - 2 - h, wa.y + wa.height - 2 - env.y - h);
  const hit = (l, t, r) => l < r.right && l + w > r.left && t < r.bottom && t + h > r.top;
  const avoid = [];
  if (bubbleVisible()) avoid.push([bubble.getBoundingClientRect(), 1000]);
  if (!radioEl.classList.contains('hidden')) {
    const rr = radioEl.getBoundingClientRect(); // 含天线
    avoid.push([{ left: rr.left, right: rr.right, top: rr.top - parseFloat(getComputedStyle(radioEl).fontSize) * 2.8, bottom: rr.bottom }, 500]);
  }
  if (!hintEl.classList.contains('hidden')) avoid.push([hintEl.getBoundingClientRect(), 300]);
  const cy = vis.top + (vis.bottom - vis.top) * 0.36 - h / 2; // 偏上一些，给脚边的收音机留位置
  const cands = [
    { side: 'right', left: vis.right + 12, top: cy },
    { side: 'left', left: vis.left - 12 - w, top: cy },
    { side: 'top', left: (vis.left + vis.right) / 2 - w / 2, top: vis.top - 12 - h },
  ].map((c) => {
    const x = clamp(c.left, minX, maxX);
    let y = clamp(c.top, minY, maxY);
    // 会盖住收音机（含天线）就整体往上挪到它上面
    for (const [r, pen] of avoid) if (pen === 500 && hit(x, y, r)) y = clamp(r.top - 8 - h, minY, maxY);
    let bad = Math.abs(x - c.left) + Math.abs(y - c.top) * 0.3;
    if (hit(x, y, { left: vis.left + 6, right: vis.right - 6, top: vis.top + 6, bottom: vis.bottom - 6 })) bad += 400; // 压到宠物
    for (const [r, pen] of avoid) if (hit(x, y, r)) bad += pen;
    if (c.side !== (elm._side || 'right')) bad += 4; // 小惯性，避免来回跳
    if (c.side === 'top') bad += 3; // 头顶是最后的选择
    return { side: c.side, x: Math.round(x), y: Math.round(y), bad };
  });
  const best = cands.reduce((a, b) => (b.bad < a.bad ? b : a));
  elm._side = best.side;
  elm.style.left = best.x + 'px';
  elm.style.top = best.y + 'px';
  elm.style.setProperty('--tail-x', Math.min(Math.max((vis.left + vis.right) / 2 - best.x, 16), w - 16) + 'px');
  elm.classList.toggle('at-right', best.side === 'right');
  elm.classList.toggle('at-left', best.side === 'left');
  elm.classList.toggle('at-top', best.side === 'top');
}
const positionCheer = () => placeBeside(cheerEl);

// ---------- 气泡 ----------
// 一节课（对话框用）：时间、课程名、线上/线下、老师、地点；今天的会标出“进行中 / 下一节”
function bubbleCourseRow(c, now) {
  const row = el('div', 'bcourse');
  const bar = el('div', 'cbar');
  bar.style.background = courseColor(c.name);
  const body = el('div', 'cbody');
  const name = el('div', 'cname');
  name.append(document.createTextNode(c.name + ' '), el('span', 'mode ' + c.mode, MODE_LABEL[c.mode]));
  if (now) {
    const cur = now.getHours() * 60 + now.getMinutes();
    if (cur >= hm2min(c.start) && cur < hm2min(c.end)) {
      row.classList.add('now');
      name.append(el('span', 'tagnow', '进行中'));
    } else if (cur < hm2min(c.start) && !coursesOnDate(courses, dateToKey(now)).some((x) => cur < hm2min(x.start) && hm2min(x.start) < hm2min(c.start))) {
      name.append(el('span', 'tagnext', '下一节'));
    }
  }
  body.append(name);
  const info = [c.teacher && `👤 ${c.teacher}`, ...courseWhere(c)].filter(Boolean).join('  ');
  if (info) body.append(el('div', 'cinfo', info));
  row.append(bar, el('div', 'ctime', `${c.start}–${c.end}`), body);
  return row;
}
// 列表视图顶部的一行：今天有几节课、下一节是什么
function todayCourseLine() {
  const now = new Date();
  const list = coursesOnDate(courses, dateToKey(now));
  if (!list.length) return null;
  const cur = now.getHours() * 60 + now.getMinutes();
  const next = list.find((c) => hm2min(c.start) > cur);
  const doing = list.find((c) => cur >= hm2min(c.start) && cur < hm2min(c.end));
  let tail = '今天的课都上完啦';
  if (doing) tail = `正在上 ${doing.name}（${MODE_LABEL[doing.mode]}，到 ${doing.end}）`;
  else if (next) tail = `下一节 ${next.start} ${next.name}（${MODE_LABEL[next.mode]}）`;
  return el('div', 'cline', `🎓 今天 ${list.length} 节课 · ${tail}`);
}

// 一条任务行（任务列表和日历下方的当天待办共用）
function bubbleTaskRow(t) {
  const row = el('div', `task p${t.priority}`);
  row.title = '点击放大查看';
  row.onclick = () => focusTask(t.id);
  row.append(el('div', 'bar'));
  const body = el('div', 'body');
  body.append(el('div', 't-title', taskTitle(t)));
  if (taskBody(t)) body.append(el('div', 't-sub', taskBody(t)));
  if (t.due) body.append(el('div', 'meta' + (isOverdue(t) ? ' over' : ''), (isOverdue(t) ? '已逾期 ' : '截止 ') + fmtDue(t.due)));
  if ((t.links && t.links.length) || (t.imageUrls && t.imageUrls.length)) {
    const chips = el('div', 'chips');
    for (const l of t.links || []) {
      const c = el('span', 'chip', '📎 ' + l.name);
      c.title = l.target;
      c.onclick = (e) => {
        e.stopPropagation();
        window.api.openTarget(l.target);
      };
      chips.append(c);
    }
    (t.imageUrls || []).forEach((u, i) => {
      const img = el('img', 'thumb');
      img.src = u;
      img.onclick = (e) => {
        e.stopPropagation();
        window.api.openImage(t.images[i]);
      };
      chips.append(img);
    });
    body.append(chips);
  }
  row.append(body);
  const btn = el('button', 'done-btn', '✓');
  btn.title = '完成';
  btn.onclick = (e) => {
    e.stopPropagation();
    window.api.completeTask(t.id);
  };
  row.append(btn);
  return row;
}

function focusTask(id) {
  focusId = id;
  renderBubble();
  updateLayout();
}
function renderBubble() {
  bubbleBody.replaceChildren();
  bcal.classList.toggle('on', bubbleMode === 'cal');
  const ft = focusId && tasks.find((t) => t.id === focusId && !t.done);
  if (focusId && !ft) focusId = null;
  if (ft) {
    renderTaskDetail(bubbleBody, ft, {
      quiet: true,
      onBack: () => focusTask(null),
      onPopout: () => window.api.openTaskWindow(ft.id),
      onDone: () => window.api.completeTask(ft.id),
    });
    return;
  }
  if (bubbleMode === 'cal') return renderBubbleCalendar();
  const p = pending();
  const head = el('div', 'head');
  if (!p.length) {
    head.textContent = '没有待办事项，好轻松～';
  } else {
    head.append(el('span', null, `待办 ${p.length} 项`));
    if (p.some(isUrgent)) head.append(el('span', 'warn', '⚠ 有紧急 / 逾期'));
  }
  bubbleBody.append(head);
  const cl = todayCourseLine();
  if (cl) bubbleBody.append(cl);

  for (const t of p) bubbleBody.append(bubbleTaskRow(t));

  const foot = el('div', 'foot');
  foot.append(el('span', null, ''));
  const open = el('span', 'link', '＋添加 / 管理');
  open.onclick = () => window.api.openManager();
  foot.append(open);
  bubbleBody.append(foot);
}

// ---------- 对话框里的日历 + 当天待办 ----------
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function renderBubbleCalendar() {
  const now = new Date();
  const todayKey = ymd(now);
  if (!calMonth) calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  if (!calSel) calSel = todayKey;
  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();

  // 每天的未完成任务
  const byDay = new Map();
  for (const t of pending()) {
    if (!t.due) continue;
    const k = t.due.slice(0, 10);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(t);
  }

  const head = el('div', 'bcal-head');
  const nav = (label, n) => {
    const b = el('span', 'bcal-nav', label);
    b.onclick = () => {
      calMonth = new Date(y, m + n, 1);
      renderBubble();
      updateLayout();
    };
    return b;
  };
  head.append(nav('‹', -1), el('span', 'ttl', `${y} 年 ${m + 1} 月`), nav('›', 1));
  const todayBtn = el('span', 'bcal-nav', '今天');
  todayBtn.onclick = () => {
    calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    calSel = todayKey;
    renderBubble();
    updateLayout();
  };
  head.append(todayBtn);
  bubbleBody.append(head);

  const grid = el('div', 'bcal-grid');
  for (const w of '一二三四五六日') grid.append(el('div', 'bcal-w', w));
  const offset = (new Date(y, m, 1).getDay() + 6) % 7; // 周一为一周之首
  const rows = Math.ceil((offset + new Date(y, m + 1, 0).getDate()) / 7);
  for (let i = 0; i < rows * 7; i++) {
    const d = new Date(y, m, 1 - offset + i);
    const k = ymd(d);
    const list = byDay.get(k) || [];
    const cell = el('div', 'bcal-d' + (d.getMonth() !== m ? ' other' : '') + (k === todayKey ? ' today' : '') + (k === calSel ? ' sel' : ''), String(d.getDate()));
    if (list.length) {
      const top = Math.max(...list.map((t) => t.priority));
      cell.append(el('span', `dot p${list.some(isOverdue) ? 3 : top}`));
    }
    if (coursesOnDate(courses, k).length) cell.append(el('span', 'cdot'));
    cell.onclick = () => {
      calSel = k;
      if (d.getMonth() !== m) calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      renderBubble();
      updateLayout();
    };
    grid.append(cell);
  }
  bubbleBody.append(grid);

  // 选中那天的待办；今天顺带列出已逾期的
  const [yy, mm, dd] = calSel.split('-').map(Number);
  const isToday = calSel === todayKey;
  const items = [...(byDay.get(calSel) || [])];
  if (isToday) for (const t of pending()) if (t.due && t.due.slice(0, 10) < todayKey) items.push(t);
  items.sort((a, b) => b.priority - a.priority || (a.due || '').localeCompare(b.due || ''));
  // 当天的课程（放在待办上面）
  const dayCourses = coursesOnDate(courses, calSel);
  if (dayCourses.length) {
    const csec = el('div', 'bcal-sec');
    csec.append(el('span', null, isToday ? '🎓 今天课程' : `🎓 ${mm} 月 ${dd} 日课程`), el('span', 'cnt', `${dayCourses.length} 节`));
    bubbleBody.append(csec);
    for (const c of dayCourses) bubbleBody.append(bubbleCourseRow(c, isToday ? now : null));
  }
  const sec = el('div', 'bcal-sec');
  sec.append(el('span', null, isToday ? '今天待办' : `${mm} 月 ${dd} 日`), el('span', 'cnt', `${items.length} 项`));
  bubbleBody.append(sec);
  if (!items.length) bubbleBody.append(el('div', 'meta', isToday ? '今天没有待办，轻松一下吧 🎉' : '这天没有待办事项'));
  for (const t of items) bubbleBody.append(bubbleTaskRow(t));

  const foot = el('div', 'foot');
  foot.append(el('span', null, ''));
  const open = el('span', 'link', '＋添加 / 管理');
  open.onclick = () => window.api.openManager();
  foot.append(open);
  bubbleBody.append(foot);
}
bcal.addEventListener('click', () => {
  bubbleMode = bubbleMode === 'cal' ? 'list' : 'cal';
  focusId = null;
  if (bubbleMode === 'cal') calSel = null; // 每次打开日历都先回到今天
  renderBubble();
  updateLayout();
});
function showBubble(auto) {
  clearTimeout(hideTimer);
  if (!bubbleVisible()) {
    cheerText = cheerPhrase();
    cheerDismissed = false;
    clearTimeout(cheerTimer);
    // cheerSeconds 为 0 时不自动消失，跟着任务对话框一起收起
    if (settings.cheerSeconds > 0) {
      cheerTimer = setTimeout(() => {
        cheerDismissed = true;
        renderCheer();
      }, settings.cheerSeconds * 1000);
    }
  }
  renderBubble();
  bubble.classList.remove('hidden');
  document.body.classList.remove('dim'); // 刚弹出时完全显示，没被悬停就几秒后变淡
  wake(false);
  renderCheer();
  updateLayout();
  if (auto) armHide();
  renderPet();
}
function hideBubble() {
  clearTimeout(hideTimer);
  focusId = null;
  bubble.classList.add('hidden');
  pinned = false;
  clearTimeout(cheerTimer);
  renderCheer();
  renderPet();
}
function armHide() {
  clearTimeout(hideTimer);
  if (!pinned && settings.bubbleSeconds > 0) hideTimer = setTimeout(hideBubble, settings.bubbleSeconds * 1000);
}
bubble.addEventListener('mouseenter', () => clearTimeout(hideTimer));
bubble.addEventListener('mouseleave', armHide);


// ---------- 防挡布局：按屏幕边缘自动换位 ----------
const grip = document.getElementById('grip');
let down = null;
let resizing = false;
let bubbleResizing = null;
let bubbleMoving = null;
let lastInteractive = false;
const GRIP = 24;
const MIN_ROOM = 150; // 一侧至少要有这么多空间（压到最矮 120 + 间隙）才能放对话框
const GAP = 6;
const fits = (r) => {
  const wa = env.wa;
  return r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight &&
    env.x + r.left >= wa.x + 2 && env.x + r.right <= wa.x + wa.width - 2 &&
    env.y + r.top >= wa.y + 2 && env.y + r.bottom <= wa.y + wa.height - 2;
};
// 角上的按钮（压在角上，用于对话框缩放）
function cornerRect(base, c) {
  const left = c.includes('r') ? base.right - GRIP : base.left;
  const top = c.includes('b') ? base.bottom - GRIP : base.top;
  return { left, top, right: left + GRIP, bottom: top + GRIP };
}
// 宠物外侧的按钮（含 6px 间隙）
function outsideRect(base, c) {
  const w = GRIP + GAP;
  const left = c.includes('r') ? base.right : base.left - w;
  const top = c.includes('b') ? base.bottom - GRIP : base.top;
  return { left, top, right: left + w, bottom: top + GRIP };
}

// 宠物“看得见”的范围：用图片不透明区域（主进程算好的包围盒），不是整个画布，这样对话框能挪进透明留白里
function visRect() {
  const box = sprites._boxes && sprites._boxes[sprite.getAttribute('src')];
  if (!sprite.hidden && box) {
    const r = sprite.getBoundingClientRect();
    return {
      left: r.left + box.l * r.width, right: r.left + box.r * r.width,
      top: r.top + box.t * r.height, bottom: r.top + box.b * r.height,
    };
  }
  return (sprite.hidden ? emoji : petWrap).getBoundingClientRect();
}

// 对话框的位置 = 默认位置 + 用户偏移。优先级：一定要完整显示在屏幕内 > 不盖住宠物的可见部分
function positionBubble(off) {
  const wa = env.wa;
  const pr = petWrap.getBoundingClientRect();
  const vis = visRect();
  const br = bubble.getBoundingClientRect();
  const natL = br.left - appliedX;
  const natT = br.top - appliedY;
  const sL = env.x + natL;
  const sT = env.y + natT;
  const clamp = (v, lo, hi) => (hi < lo ? lo : Math.min(Math.max(v, lo), hi));
  const x = clamp(
    off.x,
    Math.max(wa.x + 4 - sL, 2 - natL),
    Math.min(wa.x + wa.width - 4 - (sL + br.width), window.innerWidth - 2 - (natL + br.width)),
  );
  // 窗口内、屏幕内能到的纵向范围
  const winMin = 2 - natT;
  const winMax = window.innerHeight - 2 - (natT + br.height);
  const scrMin = Math.max(winMin, wa.y + 2 - sT);
  const scrMax = Math.min(winMax, wa.y + wa.height - 2 - (sT + br.height));
  // 与宠物可见部分水平相交时，不能越过它
  const bl = natL + x;
  const overlapX = bl < vis.right && bl + br.width > vis.left;
  let lo = scrMin;
  let hi = scrMax;
  if (overlapX) {
    if (currentPos === 'above') hi = Math.min(hi, vis.top - 6 - (natT + br.height));
    else lo = Math.max(lo, vis.bottom + 6 - natT);
  }
  const y = lo > hi ? clamp(off.y, scrMin, scrMax) : clamp(off.y, lo, hi);
  appliedX = Math.round(x);
  appliedY = Math.round(y);
  bubble.style.transform = `translate(${appliedX}px, ${appliedY}px)`;
  const tail = (pr.left + pr.right) / 2 - (natL + appliedX);
  bubble.style.setProperty('--tail-x', Math.min(Math.max(tail, 22), br.width - 22) + 'px');
  positionCheer(); // 打气话叠在对话框外侧，跟着走
}
const savedOff = () => (settings.bubbleOff && settings.bubbleOff[currentPos]) || { x: 0, y: 0 };

let layoutBusy = false;
function applyEnv() {
  document.documentElement.style.setProperty('--zone', env.z + 'px');
  if (stage.dataset.side !== env.side) stage.dataset.side = env.side;
}
async function updateLayout() {
  if (!env || layoutBusy) return;
  layoutBusy = true;
  try {
    await doLayout();
  } finally {
    if (stage.style.visibility === 'hidden') {
      // 窗口换边时整体藏起来，等 DOM 排好、画面刷新后再显示，避免宠物闪到别处
      await new Promise((r) => setTimeout(r, 80)); // 不用 rAF：窗口被判定为遮挡时 rAF 会暂停，画面就一直藏着
      stage.style.visibility = '';
    }
    layoutBusy = false;
  }
}
async function doLayout() {
  applyEnv();
  // 宠物缩放按钮：右下 → 左下 → 右上 → 左上，取第一个完整露出的位置
  if (!resizing) {
    const order = ['br', 'bl', 'tr', 'tl'];
    const pr = petWrap.getBoundingClientRect();
    placeRadio(); // 先摆收音机，缩放按钮再避开它
    const rr = radioEl.classList.contains('hidden') ? null : radioEl.getBoundingClientRect();
    const clear = (r) => !rr || r.right < rr.left - 2 || r.left > rr.right + 2 || r.bottom < rr.top - 2 || r.top > rr.bottom + 2;
    const c = order.find((k) => fits(outsideRect(pr, k)) && clear(outsideRect(pr, k))) || order.find((k) => fits(outsideRect(pr, k))) || order[0];
    if (grip.dataset.c !== c) grip.dataset.c = c;
  }
  positionCheer();
  placeHint();
  placeRadio();
  if (!bubbleVisible() || bubbleResizing || bubbleMoving) return;
  const pr = petWrap.getBoundingClientRect();
  // 对话框高度上限；可用空间不够时压矮，空间够了自动恢复
  const cap = Math.min(settings.bubbleHeight, env.z - 30);
  const wa = env.wa;
  const roomAbove = env.y + pr.top - wa.y;
  const roomBelow = wa.y + wa.height - (env.y + pr.bottom);
  // 位置是“粘住”的：只有当前这一侧连最小尺寸都放不下时才自动换到另一侧，换过去之后不会再自己跳回来
  const pref = settings.bubblePos === 'below' ? 'below' : 'above';
  const room = { above: roomAbove, below: roomBelow };
  const other = pref === 'above' ? 'below' : 'above';
  let pos = pref;
  if (room[pref] < MIN_ROOM && room[other] > room[pref]) {
    pos = other;
    settings.bubblePos = other;
    window.api.setSettings({ bubblePos: other });
  }
  if (dragging || resizing) pos = env.side; // 拖动 / 缩放宠物的过程中不换边
  currentPos = pos;
  const eff = Math.max(120, Math.min(cap, room[pos] - 24));
  document.documentElement.style.setProperty('--bubble-h-eff', eff + 'px');
  if (pos !== env.side) {
    // 窗口换边：先藏起对话框，等主进程把窗口移好、宠物位置不变后再摆放
    stage.style.visibility = 'hidden';
    await window.api.setSide(pos);
    env = await window.api.getEnv();
    applyEnv();
    appliedX = appliedY = 0;
    bubble.style.transform = '';
  }
  const zone = pos === 'above' ? zoneTop : zoneBottom;
  if (bubble.parentElement !== zone) {
    zone.append(bubble);
    appliedX = appliedY = 0;
    bubble.style.transform = '';
  }
  bubble.classList.toggle('below', pos === 'below');
  positionBubble(savedOff());
  bubble.style.visibility = '';

  // 侧边按钮（移动 / 上下 / 缩放）：优先右侧，被挡住换左侧
  const nb = bubble.getBoundingClientRect();
  const w = GRIP + GAP;
  const h = GRIP * 4 + 12;
  const top = nb.top + nb.height / 2 - h / 2;
  const side = fits({ left: nb.right, right: nb.right + w, top, bottom: top + h }) ? 'r' : 'l';
  if (bside.dataset.s !== side) bside.dataset.s = side;
}
setInterval(async () => {
  // 保险：任何情况下藏起来的画面都不能一直不显示
  if (!layoutBusy && stage.style.visibility === 'hidden') stage.style.visibility = '';
  if (resizing || layoutBusy) return; // 缩放过程中锁定按钮位置；换边过程中不许用旧快照覆盖 env
  const snap = await window.api.getEnv();
  if (layoutBusy) return; // 等待期间开始了换边：这份快照已过时，丢弃
  env = snap;
  updateLayout();
}, 150);

// ---------- 交互：拖动 / 缩放 / 点击 / 穿透 ----------
petWrap.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  down = { sx: e.screenX, sy: e.screenY, moved: false };
});
grip.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  resizing = true;
  petWrap.classList.add('resizing');
  window.api.resizeStart(grip.dataset.c.includes('l') ? -1 : 1);
});
bgrip.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  clearTimeout(hideTimer);
  bubbleResizing = {
    x: e.clientX, y: e.clientY,
    w: bubble.offsetWidth, h: bubbleBody.offsetHeight + 24,
    sx: bside.dataset.s === 'r' ? 1 : -1,
    sy: currentPos === 'above' ? -1 : 1,
  };
  bubble.classList.add('resizing');
});
bmove.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  clearTimeout(hideTimer);
  bubbleMoving = { x: e.clientX, y: e.clientY, ox: appliedX, oy: appliedY };
  bubble.classList.add('moving');
});
bflip.addEventListener('animationend', () => bflip.classList.remove('deny'));
bflip.addEventListener('click', () => {
  // 手动切换：不检查内容放不放得下（放不下会自动压矮），只有目标一侧连最小尺寸都没有时才拒绝
  const target = currentPos === 'above' ? 'below' : 'above';
  const pr = petWrap.getBoundingClientRect();
  const wa = env.wa;
  const room = target === 'above' ? env.y + pr.top - wa.y : wa.y + wa.height - (env.y + pr.bottom);
  if (room < MIN_ROOM) {
    bflip.classList.remove('deny');
    void bflip.offsetWidth;
    bflip.classList.add('deny');
    return;
  }
  settings.bubblePos = target;
  window.api.setSettings({ bubblePos: target });
});
window.addEventListener('mousemove', (e) => {
  const hov = document.elementFromPoint(e.clientX, e.clientY);
  wake(!!(hov && hov.closest('#bubble, #petWrap, #radio')) || !!(bubbleMoving || bubbleResizing || dragging || resizing));
  if (bubbleMoving) {
    const m = bubbleMoving;
    positionBubble({ x: m.ox + e.clientX - m.x, y: m.oy + e.clientY - m.y });
    return;
  }
  if (bubbleResizing) {
    const r = bubbleResizing;
    settings.bubbleWidth = Math.round(Math.min(Math.max(r.w + 2 * r.sx * (e.clientX - r.x), 200), 370));
    settings.bubbleHeight = Math.round(Math.min(Math.max(r.h + r.sy * (e.clientY - r.y), 120), 480));
    applyBubbleVars();
    positionCheer();
    return;
  }
  if (resizing) return;
  if (down) {
    if (!down.moved && Math.hypot(e.screenX - down.sx, e.screenY - down.sy) > 4) {
      down.moved = true;
      dragging = true;
      petWrap.classList.add('dragging');
      window.api.dragStart(); // 之后由主进程跟随鼠标
      renderPet();
    }
    return;
  }
  // 透明区域鼠标穿透
  const t = document.elementFromPoint(e.clientX, e.clientY);
  const interactive = !!(t && (t.closest('#bubble') || t.closest('#petWrap') || t.closest('#cheer')));
  if (interactive !== lastInteractive) {
    lastInteractive = interactive;
    window.api.ignoreMouse(!interactive);
  }
});
window.addEventListener('mouseup', () => {
  if (bubbleMoving) {
    bubbleMoving = null;
    bubble.classList.remove('moving');
    settings.bubbleOff = { ...settings.bubbleOff, [currentPos]: { x: appliedX, y: appliedY } };
    window.api.setSettings({ bubbleOff: settings.bubbleOff });
    return;
  }
  if (bubbleResizing) {
    bubbleResizing = null;
    bubble.classList.remove('resizing');
    window.api.setSettings({ bubbleWidth: settings.bubbleWidth, bubbleHeight: settings.bubbleHeight });
    return;
  }
  if (resizing) {
    resizing = false;
    petWrap.classList.remove('resizing');
    window.api.loopEnd();
    return;
  }
  if (!down) return;
  const wasDrag = down.moved;
  down = null;
  if (wasDrag) {
    dragging = false;
    petWrap.classList.remove('dragging');
    window.api.loopEnd();
    renderPet();
  } else if (bubbleVisible()) {
    hideBubble();
  } else {
    pinned = true;
    showBubble(false);
  }
});
petWrap.addEventListener('wheel', (e) => {
  e.preventDefault();
  window.api.resizeBy(e.deltaY < 0 ? 12 : -12);
});
petWrap.addEventListener('dblclick', () => window.api.openManager());
petWrap.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.api.petMenu();
});

// ---------- 数据同步 ----------
function applyBubbleVars() {
  const root = document.documentElement.style;
  root.setProperty('--bubble-w', settings.bubbleWidth + 'px');
  root.setProperty('--bubble-h', settings.bubbleHeight + 'px');
  root.setProperty('--bubble-h-eff', settings.bubbleHeight + 'px');
}
function applySettings() {
  document.documentElement.dataset.theme = settings.bubbleTheme === 'dark' ? 'dark' : 'light';
  document.documentElement.style.setProperty('--pet-h', settings.petHeight + 'px');
  applyBubbleVars();
  armReminders();
  renderCheer();
}
window.api.onTasks((t) => {
  tasks = t;
  renderHint();
  if (bubbleVisible()) renderBubble();
  renderPet();
});
window.api.onSettings((s) => {
  if (bubbleResizing || bubbleMoving) return;
  settings = s;
  applySettings();
  if (s.dimEnabled === false) wake(true);
  placeRadio();
  if (bubbleVisible()) renderBubble();
});
window.api.onSprites((s) => {
  sprites = s;
  renderPet(true);
});
window.api.onTaskCompleted(() => {
  if (settings.cheerEnabled !== false) showReminder({ icon: '🎉', text: pick(DONE_TEXTS) }, settings.cheerSeconds > 0 ? settings.cheerSeconds * 1000 : 4000);
  happyUntil = Date.now() + 3000;
  renderPet();
  setTimeout(() => renderPet(), 3100);
});
window.api.onCourses((c) => {
  courses = c;
  if (bubbleVisible()) renderBubble();
});
window.api.onZone((z) => document.documentElement.style.setProperty('--zone', z + 'px'));
window.api.onToggleBubble(() => (bubbleVisible() ? hideBubble() : ((pinned = true), showBubble(false))));

(async () => {
  [tasks, settings, sprites, courses] = await Promise.all([window.api.getTasks(), window.api.getSettings(), window.api.getSprites(), window.api.getCourses()]);
  applySettings();
  renderPet(true);
  renderHint();
})();
