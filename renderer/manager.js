const $ = (id) => document.getElementById(id);
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];

let tasks = [];
let tab = 'pending';
let editingId = null;
let draft = { links: [], images: [] }; // images: [{name, url}]

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function fmtDue(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
const isOverdue = (t) => !t.done && t.due && new Date(t.due).getTime() < Date.now();
const extOf = (p) => (p.split('.').pop() || '').toLowerCase();
const baseName = (p) => p.split(/[\\/]/).pop();

// ---------- 截止时间：原生日期时间选择（日历 + 滚轮调时间，弹窗里自带“清除”） ----------
// 截止时间：原生日期选择 + 自己做的 24 小时制“时 : 分”，滚轮每次只走一格（并限速），
// 清除按钮放在同一个框里。
const due = { h: 18, m: 0 };
const pad2 = (n) => String(n).padStart(2, '0');
function showDue() {
  $('dueH').textContent = pad2(due.h);
  $('dueM').textContent = pad2(due.m);
  const has = !!$('dueDate').value;
  $('dueH').classList.toggle('dim', !has);
  $('dueM').classList.toggle('dim', !has);
}
function ensureDate() {
  if (!$('dueDate').value) {
    const d = new Date();
    $('dueDate').value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
}
const getDue = () => ($('dueDate').value ? `${$('dueDate').value}T${pad2(due.h)}:${pad2(due.m)}` : null);
function setDue(iso) {
  $('dueDate').value = iso ? iso.slice(0, 10) : '';
  due.h = iso ? +iso.slice(11, 13) : 18;
  due.m = iso ? +iso.slice(14, 16) : 0;
  showDue();
}
function bindTimeField(elm, key, max) {
  const set = (v) => {
    ensureDate();
    due[key] = v;
    showDue();
  };
  const step = (d) => set((due[key] + d + max + 1) % (max + 1));
  let last = 0;
  let buf = '';
  let timer;
  elm.addEventListener('wheel', (e) => {
    e.preventDefault();
    const now = Date.now();
    if (now - last < 150) return; // 限速：触控板连发也不会飞快滚
    last = now;
    step(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  elm.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') step(1);
    else if (e.key === 'ArrowDown') step(-1);
    else if (/^\d$/.test(e.key)) {
      buf = (buf + e.key).slice(-2);
      if (+buf > max) buf = e.key;
      set(+buf);
      clearTimeout(timer);
      timer = setTimeout(() => (buf = ''), 1200);
    } else return;
    e.preventDefault();
  });
  elm.addEventListener('blur', () => (buf = ''));
}
bindTimeField($('dueH'), 'h', 23);
bindTimeField($('dueM'), 'm', 59);
$('dueDate').addEventListener('change', showDue);
$('dueClear').onclick = () => setDue(null);

// ---------- 草稿（表单） ----------
function renderDraft() {
  const box = $('draftChips');
  box.replaceChildren();
  draft.links.forEach((l, i) => {
    const c = el('div', 'chip');
    const s = el('span', null, '📎 ' + l.name);
    s.title = l.target;
    s.onclick = () => window.api.openTarget(l.target);
    const x = el('b', null, '×');
    x.onclick = () => {
      draft.links.splice(i, 1);
      renderDraft();
    };
    c.append(s, x);
    box.append(c);
  });
  draft.images.forEach((im, i) => {
    const c = el('div', 'imgchip');
    const img = el('img');
    img.src = im.url;
    img.onclick = () => window.api.openImage(im.name);
    const x = el('b', null, '×');
    x.onclick = () => {
      draft.images.splice(i, 1);
      renderDraft();
    };
    c.append(img, x);
    box.append(c);
  });
}
function addLink(raw) {
  const target = raw.trim().replace(/^"(.*)"$/, '$1');
  if (!target) return;
  const isUrl = /^https?:\/\//i.test(target);
  let name = isUrl ? target.replace(/^https?:\/\//i, '') : baseName(target);
  draft.links.push({ type: isUrl ? 'url' : 'file', target, name: name || target });
  renderDraft();
}
function resetForm() {
  editingId = null;
  draft = { links: [], images: [] };
  $('title').value = '';
  $('text').value = '';
  $('priority').value = '2';
  setDue(null);
  $('formTitle').textContent = '添加待办';
  $('btnSubmit').textContent = '添加';
  $('btnCancel').hidden = true;
  renderDraft();
}
async function submit() {
  let title = $('title').value.trim();
  let text = $('text').value.trim();
  if (!title && text) {
    // 只写了内容：第一行当标题
    const lines = text.split('\n');
    title = lines[0].slice(0, 80);
    text = lines.slice(1).join('\n').trim();
  }
  if (!title) {
    $('title').focus();
    return;
  }
  const payload = {
    title,
    text,
    priority: +$('priority').value,
    due: getDue(),
    links: draft.links,
    images: draft.images.map((i) => i.name),
  };
  if (editingId) await window.api.updateTask(editingId, payload);
  else await window.api.addTask(payload);
  resetForm();
}
function startEdit(t) {
  editingId = t.id;
  draft = { links: [...(t.links || [])], images: (t.images || []).map((name, i) => ({ name, url: t.imageUrls[i] })) };
  $('title').value = taskTitle(t);
  $('text').value = taskBody(t);
  $('priority').value = String(t.priority);
  setDue(t.due);
  $('formTitle').textContent = '编辑待办';
  $('btnSubmit').textContent = '保存修改';
  $('btnCancel').hidden = false;
  renderDraft();
  $('title').focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('btnSubmit').onclick = submit;
$('btnCancel').onclick = resetForm;
$('text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) submit();
});
$('title').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.ctrlKey) submit();
    else $('text').focus();
  }
});
$('btnFile').onclick = async () => {
  draft.links.push(...(await window.api.pickFiles()));
  renderDraft();
};
$('btnImg').onclick = async () => {
  draft.images.push(...(await window.api.pickImages()));
  renderDraft();
};
$('linkInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    addLink(e.target.value);
    e.target.value = '';
  }
});

// 粘贴截图 / 图片
document.addEventListener('paste', async (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  for (const f of files) {
    const ext = f.type.split('/')[1].replace('jpeg', 'jpg');
    draft.images.push(await window.api.saveImageBuffer(await f.arrayBuffer(), ext));
  }
  renderDraft();
});
// 拖拽文件 / 图片
const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
document.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  document.body.classList.add('drop-on');
});
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('drop-on');
});
document.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  document.body.classList.remove('drop-on');
  for (const f of e.dataTransfer.files) {
    const p = window.api.pathForFile(f);
    if (!p) continue;
    if (extOf(p) === 'ics') {
      showImportPreview(f.name, await f.text());
      continue;
    }
    if (IMAGE_EXT.includes(extOf(p))) draft.images.push(await window.api.importImage(p));
    else draft.links.push({ type: 'file', target: p, name: baseName(p) });
  }
  renderDraft();
});

// ---------- 事项行（列表和日历下方共用） ----------
function taskRow(t) {
  const row = el('div', `task p${t.priority}` + (t.done ? ' done' : ''));
  row.append(el('div', 'bar'));
  const body = el('div', 'body');
  body.append(el('div', 'text ttl', taskTitle(t)));
  if (taskBody(t)) body.append(el('div', 'sub', taskBody(t)));
  if (t.due) body.append(el('div', 'meta' + (isOverdue(t) ? ' over' : ''), (isOverdue(t) ? '已逾期 · ' : '截止 ') + fmtDue(t.due)));
  if (t.links?.length || t.imageUrls?.length) {
    const chips = el('div', 'chips');
    for (const l of t.links || []) {
      const c = el('div', 'chip');
      const s = el('span', null, '📎 ' + l.name);
      s.title = l.target;
      s.onclick = async () => {
        const err = await window.api.openTarget(l.target);
        if (err) alert('无法打开：' + err);
      };
      c.append(s);
      c.style.paddingRight = '10px';
      chips.append(c);
    }
    (t.imageUrls || []).forEach((u, i) => {
      const c = el('div', 'imgchip');
      const img = el('img');
      img.src = u;
      img.onclick = () => window.api.openImage(t.images[i]);
      c.append(img);
      chips.append(c);
    });
    body.append(chips);
  }
  row.append(body);
  const acts = el('div', 'acts');
  const mk = (label, fn, cls) => {
    const b = el('button', cls, label);
    b.onclick = fn;
    acts.append(b);
  };
  if (t.done) {
    mk('恢复', () => window.api.updateTask(t.id, { done: false }));
  } else {
    mk('完成', () => window.api.completeTask(t.id));
    mk('编辑', () => startEdit(t));
  }
  mk('删除', () => window.api.deleteTask(t.id), 'danger');
  row.append(acts);
  return row;
}

// ---------- 列表 ----------
function renderList() {
  const list = $('list');
  list.replaceChildren();
  const showDone = tab === 'done';
  const items = tasks.filter((t) => t.done === showDone);
  $('btnClear').hidden = !(showDone && items.length);
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
  if (!items.length) {
    list.append(el('div', 'empty', showDone ? '还没有完成的事项' : '没有待办事项 🎉'));
    return;
  }
  for (const t of items) list.append(taskRow(t));
}
document.querySelectorAll('.tab').forEach((x) => {
  x.onclick = () => {
    tab = x.dataset.tab;
    renderList();
  };
});
$('btnClear').onclick = () => confirm('确定清空所有已完成事项？') && window.api.clearDone();

// ---------- 日历视图 ----------
let view = 'list';
let calMonth = new Date();
calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1);
let calShowDone = false;
let calShowCourses = true;
const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
let selDay = dayKey(new Date());

function renderCalendar() {
  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();
  $('calTitle').textContent = `${y} 年 ${m + 1} 月`;
  const byDay = new Map();
  for (const t of tasks) {
    if (!t.due || (t.done && !calShowDone)) continue;
    const k = t.due.slice(0, 10);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(t);
  }
  for (const arr of byDay.values()) arr.sort((a, b) => a.due.localeCompare(b.due) || b.priority - a.priority);

  const todayKey = dayKey(new Date());
  const start = new Date(y, m, 1 - ((new Date(y, m, 1).getDay() + 6) % 7)); // 周一为一周之首
  const grid = $('calGrid');
  grid.replaceChildren();
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const k = dayKey(d);
    const list = byDay.get(k) || [];
    const cell = el('div', 'cal-cell' + (d.getMonth() !== m ? ' other' : '') + (k === todayKey ? ' today' : '') +
      (k === selDay ? ' sel' : '') + (list.some(isOverdue) ? ' hasover' : ''));
    cell.append(el('div', 'dn', String(d.getDate())));
    const cs = calShowCourses ? coursesOnDate(courses, k) : [];
    const maxT = cs.length ? 2 : 3;
    for (const t of list.slice(0, maxT)) {
      const c = el('div', `cchip p${t.priority}` + (t.done ? ' done' : ''), `${t.due.slice(11, 16)} ${taskTitle(t)}`);
      c.title = taskTitle(t);
      c.draggable = true;
      c.ondragstart = (e) => {
        e.dataTransfer.setData('text/x-task-id', t.id);
        e.dataTransfer.effectAllowed = 'move';
      };
      cell.append(c);
    }
    for (const c of cs.slice(0, 2)) {
      const chip = el('div', 'cchip course', `${c.start} ${c.name}`);
      chip.style.borderColor = courseColor(c.name);
      chip.style.background = `color-mix(in srgb, ${courseColor(c.name)} 16%, white)`;
      chip.title = `${c.name}  ${c.start}–${c.end}  ${MODE_LABEL[c.mode]}`;
      cell.append(chip);
    }
    const hiddenCount = Math.max(0, list.length - maxT) + Math.max(0, cs.length - 2);
    if (hiddenCount) cell.append(el('div', 'more', `+${hiddenCount} 项`));
    cell.onclick = () => {
      selDay = k;
      if (d.getMonth() !== m) calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      renderCalendar();
    };
    // 把事项条拖到别的日期：改截止日，保留原来的时间
    cell.ondragover = (e) => {
      if (![...e.dataTransfer.types].includes('text/x-task-id')) return;
      e.preventDefault();
      cell.classList.add('dragover');
    };
    cell.ondragleave = () => cell.classList.remove('dragover');
    cell.ondrop = (e) => {
      const id = e.dataTransfer.getData('text/x-task-id');
      cell.classList.remove('dragover');
      if (!id) return;
      e.preventDefault();
      const t = tasks.find((x) => x.id === id);
      if (t && t.due) window.api.updateTask(id, { due: k + t.due.slice(10) });
    };
    grid.append(cell);
  }

  // 选中那天的事项
  const [yy, mm, dd] = selDay.split('-').map(Number);
  const items = byDay.get(selDay) || [];
  const panel = $('dayPanel');
  panel.replaceChildren();
  const head = el('div', 'day-head');
  head.append(el('div', 'day-title', `${mm} 月 ${dd} 日 周${'日一二三四五六'[new Date(yy, mm - 1, dd).getDay()]} · ${items.length} 项`));
  const add = el('button', 'primary', '＋ 在这天添加');
  add.onclick = () => {
    setDue(`${selDay}T18:00`);
    $('title').focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  head.append(add);
  panel.append(head);
  const dayCourses = calShowCourses ? coursesOnDate(courses, selDay) : [];
  if (dayCourses.length) {
    panel.append(el('div', 'day-sub', `🎓 课程 · ${dayCourses.length} 节`));
    for (const c of dayCourses) panel.append(courseCard(c));
    panel.append(el('div', 'day-sub', `📝 待办 · ${items.length} 项`));
  }
  if (!items.length) panel.append(el('div', 'empty', dayCourses.length ? '这天没有待办事项' : '这一天没有事项'));
  for (const t of items) panel.append(taskRow(t));

  // 没设截止日期的事项
  const noDue = tasks.filter((t) => !t.due && (calShowDone || !t.done));
  const box = $('noDue');
  box.replaceChildren();
  box.hidden = !noDue.length;
  if (noDue.length) {
    box.append(el('div', 'day-title', `未设截止日期 · ${noDue.length} 项`));
    for (const t of noDue) box.append(taskRow(t));
  }
}
const moveMonth = (n) => {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + n, 1);
  renderCalendar();
};
$('calPrev').onclick = () => moveMonth(-1);
$('calNext').onclick = () => moveMonth(1);
$('calToday').onclick = () => {
  const n = new Date();
  calMonth = new Date(n.getFullYear(), n.getMonth(), 1);
  selDay = dayKey(n);
  renderCalendar();
};
$('calShowCourses').onchange = (e) => {
  calShowCourses = e.target.checked;
  renderCalendar();
};
$('calShowDone').onchange = (e) => {
  calShowDone = e.target.checked;
  renderCalendar();
};
function render() {
  if (view === 'cal') renderCalendar();
  else if (view === 'tt') renderTimetable();
  else renderList();
}
function setView(v) {
  view = v;
  $('listView').hidden = v !== 'list';
  $('calView').hidden = v !== 'cal';
  $('ttView').hidden = v !== 'tt';
  document.querySelectorAll('.vtab').forEach((x) => x.classList.toggle('on', x.dataset.view === v));
  render();
}
document.querySelectorAll('.vtab').forEach((x) => {
  x.onclick = () => setView(x.dataset.view);
});

// ---------- 设置 ----------
const SETTING_KEYS = ['bubbleSeconds', 'bubbleWidth', 'bubbleHeight', 'bubblePos', 'bubbleTheme', 'cheerEnabled', 'cheerSeconds', 'reminderSeconds', 'eyeMinutes', 'waterMinutes', 'moveMinutes', 'petHeight'];
function fillSettings(s) {
  for (const k of SETTING_KEYS) if (document.activeElement !== $('s_' + k)) $('s_' + k).value = s[k];
}
for (const k of SETTING_KEYS) {
  $('s_' + k).addEventListener('change', (e) => window.api.setSettings({ [k]: e.target.value }));
}

window.api.onTasks((t) => {
  tasks = t;
  render();
});
window.api.onSettings(fillSettings);
(async () => {
  tasks = await window.api.getTasks();
  fillSettings(await window.api.getSettings());
  render();
  renderDraft();
  setDue(null);
})();
setInterval(render, 60000); // 刷新“已逾期”状态
