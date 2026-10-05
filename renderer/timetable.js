// ---------- 课程表：每周课表、课程管理、.ics 导入预览（管理窗口） ----------
// 依赖：course.js / ics.js 的日期与解析工具，manager.js 里的 $ / el / setView

let ttWeek = mondayOf(new Date());
let editingCourseId = null;
let formMode = 'offline';
const tint = (color) => `color-mix(in srgb, ${color} 16%, white)`;
const modeBadge = (c) => el('span', 'mode ' + c.mode, MODE_LABEL[c.mode]);

// 日历下方的课程卡片（点击进入编辑）
function courseCard(c) {
  const color = courseColor(c.name);
  const card = el('div', 'course-card');
  card.style.borderLeftColor = color;
  card.style.background = tint(color);
  const body = el('div', 'cc-body');
  const name = el('div', 'cc-name');
  name.append(document.createTextNode(c.name + ' '), modeBadge(c));
  body.append(name);
  const info = [c.teacher && `👤 ${c.teacher}`, c.place && `${c.mode === 'online' ? '🔗' : '📍'} ${c.place}`].filter(Boolean).join('   ');
  if (info) body.append(el('div', 'cc-info', info));
  card.append(el('div', 'cc-time', `${c.start}–${c.end}`), body);
  card.title = '点击编辑这门课';
  card.onclick = () => {
    setView('tt');
    openCourseForm(c);
  };
  return card;
}

// 同一天里时间重叠的课并排显示
function layoutLanes(list) {
  const items = list.map((c) => ({ c, s: hm2min(c.start), e: hm2min(c.end), lane: 0, lanes: 1 }));
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const n = Math.max(...cluster.map((x) => x.lane)) + 1;
    cluster.forEach((x) => (x.lanes = n));
    cluster = [];
    clusterEnd = -1;
  };
  for (const it of items) {
    if (cluster.length && it.s >= clusterEnd) flush();
    const used = cluster.filter((x) => x.e > it.s).map((x) => x.lane);
    let lane = 0;
    while (used.includes(lane)) lane++;
    it.lane = lane;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  if (cluster.length) flush();
  return items;
}

function renderTimetable() {
  const days = [...Array(7)].map((_, i) => new Date(ttWeek.getFullYear(), ttWeek.getMonth(), ttWeek.getDate() + i));
  const f = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  $('ttWeekTitle').textContent = `${f(days[0])} – ${f(days[6])}`;
  const todayKey = dateToKey(new Date());
  const occ = days.map((d) => coursesOnDate(courses, dateToKey(d)));
  let minH = 8;
  let maxH = 18;
  for (const l of occ) {
    for (const c of l) {
      minH = Math.min(minH, Math.floor(hm2min(c.start) / 60));
      maxH = Math.max(maxH, Math.ceil(hm2min(c.end) / 60));
    }
  }
  const HOUR = 44;
  const height = (maxH - minH) * HOUR;
  const grid = $('ttGrid');
  grid.replaceChildren();
  grid.style.setProperty('--hh', HOUR + 'px');
  grid.append(el('div', 'tt-corner'));
  days.forEach((d, i) => grid.append(el('div', 'tt-dh' + (dateToKey(d) === todayKey ? ' today' : ''), `${WEEKDAY_CN[i + 1]} ${f(d)}`)));
  const axis = el('div', 'tt-axis');
  axis.style.height = height + 'px';
  for (let h = minH; h <= maxH; h++) {
    const l = el('div', 'tt-hl', String(h).padStart(2, '0') + ':00');
    l.style.top = (h - minH) * HOUR + 'px';
    axis.append(l);
  }
  grid.append(axis);
  days.forEach((d, i) => {
    const col = el('div', 'tt-col' + (dateToKey(d) === todayKey ? ' today' : ''));
    col.style.height = height + 'px';
    for (const it of layoutLanes(occ[i])) {
      const c = it.c;
      const color = courseColor(c.name);
      const b = el('div', 'tt-block');
      b.style.top = ((it.s - minH * 60) / 60) * HOUR + 'px';
      b.style.height = Math.max(24, ((it.e - it.s) / 60) * HOUR - 2) + 'px';
      b.style.left = `calc(${(it.lane / it.lanes) * 100}% + 1px)`;
      b.style.width = `calc(${100 / it.lanes}% - 2px)`;
      b.style.borderLeftColor = color;
      b.style.background = tint(color);
      b.append(el('div', 'b-name', c.name));
      b.append(el('div', 'b-sub', `${c.start}–${c.end} · ${MODE_LABEL[c.mode]}`));
      if (c.place) b.append(el('div', 'b-sub', (c.mode === 'online' ? '🔗 ' : '📍 ') + c.place));
      if (c.teacher) b.append(el('div', 'b-sub', '👤 ' + c.teacher));
      b.title = [c.name, `${WEEKDAY_CN[c.weekday]} ${c.start}–${c.end}`, MODE_LABEL[c.mode], c.teacher, c.place].filter(Boolean).join('\n');
      b.onclick = () => openCourseForm(c);
      col.append(b);
    }
    grid.append(col);
  });
  $('ttEmpty').hidden = courses.length > 0;
  $('ttGrid').hidden = courses.length === 0;
  renderCourseList();
}

function renderCourseList() {
  const box = $('ttList');
  box.replaceChildren();
  $('ttCount').textContent = String(courses.length);
  $('ttClear').hidden = !courses.length;
  const sorted = [...courses].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
  for (const c of sorted) {
    const row = el('div', 'cl-row');
    const dot = el('span', 'cl-dot');
    dot.style.background = courseColor(c.name);
    const main = el('div', 'cl-main');
    const l1 = el('div', 'cl-l1');
    l1.append(el('b', null, c.name), document.createTextNode(' '), modeBadge(c));
    main.append(l1);
    const meta = [`${WEEKDAY_CN[c.weekday]} ${c.start}–${c.end}`, c.teacher && `👤 ${c.teacher}`, c.place && `${c.mode === 'online' ? '🔗' : '📍'} ${c.place}`, courseRangeText(c)]
      .filter(Boolean)
      .join('  ·  ');
    main.append(el('div', 'cl-meta', meta));
    const acts = el('div', 'acts');
    const edit = el('button', null, '编辑');
    edit.onclick = () => openCourseForm(c);
    const del = el('button', 'danger', '删除');
    del.onclick = () => confirm(`删除课程“${c.name}”（${WEEKDAY_CN[c.weekday]} ${c.start}）？`) && window.api.deleteCourse(c.id);
    acts.append(edit, del);
    row.append(dot, main, acts);
    box.append(row);
  }
}

// ---------- 添加 / 编辑课程 ----------
function normTime(s) {
  const d = String(s).replace(/[^\d]/g, '');
  if (!d) return null;
  let h;
  let m;
  if (String(s).includes(':') || String(s).includes('：')) {
    [h, m] = String(s).replace('：', ':').split(':').map((x) => parseInt(x, 10) || 0);
  } else if (d.length <= 2) {
    h = +d;
    m = 0;
  } else {
    h = +d.slice(0, d.length - 2);
    m = +d.slice(-2);
  }
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
for (const id of ['cStart', 'cEnd']) {
  $(id).addEventListener('blur', () => {
    const n = normTime($(id).value);
    if (n) $(id).value = n;
  });
}
function setFormMode(mode) {
  formMode = mode;
  $('cModeOffline').classList.toggle('on', mode === 'offline');
  $('cModeOnline').classList.toggle('on', mode === 'online');
  $('cPlaceLabel').textContent = mode === 'online' ? '会议链接 / 平台' : '教室 / 地点';
  $('cPlace').placeholder = mode === 'online' ? '例如：https://zoom.us/j/…  或  腾讯会议 123 456' : '例如：B3-201';
}
$('cModeOffline').onclick = () => setFormMode('offline');
$('cModeOnline').onclick = () => setFormMode('online');

function openCourseForm(c) {
  editingCourseId = c ? c.id : null;
  $('ttForm').hidden = false;
  $('ttFormTitle').textContent = c ? '编辑课程' : '添加课程';
  $('cName').value = c ? c.name : '';
  $('cTeacher').value = c ? c.teacher : '';
  document.querySelectorAll('.cday').forEach((cb) => (cb.checked = !!c && +cb.value === c.weekday));
  $('cStart').value = c ? c.start : '09:00';
  $('cEnd').value = c ? c.end : '10:30';
  setFormMode(c ? c.mode : 'offline');
  $('cPlace').value = c ? c.place : '';
  $('cFrom').value = (c && c.from) || '';
  $('cUntil').value = (c && c.until) || '';
  $('cInterval').value = String(c ? c.interval || 1 : 1);
  $('ttSave').textContent = c ? '保存修改' : '添加';
  $('ttForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('cName').focus();
}
function closeCourseForm() {
  editingCourseId = null;
  $('ttForm').hidden = true;
}
$('ttAdd').onclick = () => openCourseForm(null);
$('ttCancel').onclick = closeCourseForm;
$('ttSave').onclick = async () => {
  const name = $('cName').value.trim();
  const start = normTime($('cStart').value);
  const end = normTime($('cEnd').value);
  const days = [...document.querySelectorAll('.cday')].filter((cb) => cb.checked).map((cb) => +cb.value);
  const bad = (msg, id) => {
    alert(msg);
    if (id) $(id).focus();
  };
  if (!name) return bad('请填写课程名称', 'cName');
  if (!days.length) return bad('请至少选择一个上课的星期');
  if (!start || !end) return bad('时间格式不对，请填 24 小时制，例如 08:30', start ? 'cEnd' : 'cStart');
  if (hm2min(end) <= hm2min(start)) return bad('结束时间要晚于开始时间', 'cEnd');
  const from = $('cFrom').value || null;
  const until = $('cUntil').value || null;
  if (from && until && until < from) return bad('学期结束日期不能早于开始日期', 'cUntil');
  const base = {
    name, teacher: $('cTeacher').value.trim(), mode: formMode, place: $('cPlace').value.trim(),
    start, end, from, until, interval: +$('cInterval').value || 1,
  };
  if (editingCourseId) {
    const old = courses.find((c) => c.id === editingCourseId);
    await window.api.updateCourse(editingCourseId, { ...base, weekday: days[0], exceptions: old ? old.exceptions : [] });
    if (days.length > 1) await window.api.addCourses(days.slice(1).map((weekday) => ({ ...base, weekday })));
  } else {
    await window.api.addCourses(days.map((weekday) => ({ ...base, weekday })));
  }
  closeCourseForm();
};

// 周切换
$('ttPrev').onclick = () => {
  ttWeek = new Date(ttWeek.getFullYear(), ttWeek.getMonth(), ttWeek.getDate() - 7);
  renderTimetable();
};
$('ttNext').onclick = () => {
  ttWeek = new Date(ttWeek.getFullYear(), ttWeek.getMonth(), ttWeek.getDate() + 7);
  renderTimetable();
};
$('ttThisWeek').onclick = () => {
  ttWeek = mondayOf(new Date());
  renderTimetable();
};
$('ttClear').onclick = () => confirm('确定清空整个课程表？（所有课程都会删除）') && window.api.clearCourses();

// ---------- .ics 导入 + 预览 ----------
let importState = null; // { courses: [{…, _on, _dup}], skipped }
const sigOf = (c) => [c.name, c.weekday, c.start, c.end].join('|');

$('ttImport').onclick = async () => {
  const r = await window.api.pickIcs();
  if (r) showImportPreview(r.name, r.text);
};
function showImportPreview(fileName, text) {
  const parsed = parseICS(text);
  if (!parsed.events.length) {
    alert('这个文件里没有找到任何日历事件（VEVENT），请确认是 .ics 日历文件。');
    return;
  }
  const r = icsToCourses(parsed.events);
  const existing = new Set(courses.map(sigOf));
  for (const c of r.courses) {
    c._dup = existing.has(sigOf(c));
    c._on = !c._dup;
  }
  importState = r;
  setView('tt');
  $('imTitle').textContent = `导入预览 · ${fileName}`;
  $('imReplace').checked = false;
  $('imUntil').value = '';
  $('importModal').hidden = false;
  renderImport();
}
function renderImport() {
  const st = importState;
  const list = $('imList');
  list.replaceChildren();
  const dup = st.courses.filter((c) => c._dup).length;
  $('imSummary').textContent =
    `共读到 ${st.courses.length + st.skipped.length} 个事件 → 生成 ${st.courses.length} 条每周课程规则` +
    (st.skipped.length ? `，跳过 ${st.skipped.length} 个` : '') + (dup ? `，其中 ${dup} 条与已有课程重复（默认不勾选）` : '') + '。';
  const sorted = st.courses.map((c, i) => ({ c, i })).sort((a, b) => a.c.weekday - b.c.weekday || a.c.start.localeCompare(b.c.start));
  for (const { c } of sorted) {
    const row = el('label', 'im-row' + (c._dup ? ' dup' : ''));
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = c._on;
    cb.onchange = () => {
      c._on = cb.checked;
      updateImportCount();
    };
    const dot = el('span', 'cl-dot');
    dot.style.background = courseColor(c.name);
    const main = el('div', 'cl-main');
    const l1 = el('div', 'cl-l1');
    l1.append(el('b', null, c.name), document.createTextNode(' '), modeBadge(c));
    if (c._dup) l1.append(document.createTextNode(' '), el('span', 'flag', '已存在'));
    main.append(l1);
    main.append(el('div', 'cl-meta', [`${WEEKDAY_CN[c.weekday]} ${c.start}–${c.end}`, c.teacher && `👤 ${c.teacher}`, c.place && `${c.mode === 'online' ? '🔗' : '📍'} ${c.place}`, courseRangeText(c)].filter(Boolean).join('  ·  ')));
    if (c.exceptions.length) main.append(el('div', 'cl-note', `停课 ${c.exceptions.length} 天：${c.exceptions.slice(0, 4).map((d) => d.slice(5)).join('、')}${c.exceptions.length > 4 ? '…' : ''}`));
    for (const n of c.notes || []) main.append(el('div', 'cl-note', '⚠ ' + n));
    row.append(cb, dot, main);
    list.append(row);
  }
  const box = $('imSkippedBox');
  box.hidden = !st.skipped.length;
  $('imSkippedSum').textContent = `已跳过 ${st.skipped.length} 个事件`;
  const sk = $('imSkipped');
  sk.replaceChildren();
  for (const s of st.skipped) sk.append(el('div', 'cl-note', `${s.name} — ${s.reason}`));
  updateImportCount();
}
function updateImportCount() {
  const n = importState.courses.filter((c) => c._on).length;
  $('imGo').textContent = `导入所选 (${n})`;
  $('imGo').disabled = n === 0 && !$('imReplace').checked;
}
$('imReplace').onchange = updateImportCount;
$('imAll').onclick = () => {
  importState.courses.forEach((c) => (c._on = true));
  renderImport();
};
$('imNone').onclick = () => {
  importState.courses.forEach((c) => (c._on = false));
  renderImport();
};
const closeImport = () => {
  $('importModal').hidden = true;
  importState = null;
};
$('imCancel').onclick = closeImport;
$('imClose').onclick = closeImport;
$('importModal').addEventListener('mousedown', (e) => {
  if (e.target === $('importModal')) closeImport();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('importModal').hidden) closeImport();
});
$('imGo').onclick = async () => {
  const defUntil = $('imUntil').value || null;
  const list = importState.courses
    .filter((c) => c._on)
    .map((c) => {
      const o = { ...c };
      delete o._on;
      delete o._dup;
      delete o.notes;
      if (!o.until && defUntil) o.until = defUntil;
      return o;
    });
  await window.api.importCourses({ list, replaceIcs: $('imReplace').checked });
  closeImport();
  const s = $('ttStatus');
  s.textContent = `已导入 ${list.length} 条课程`;
  setTimeout(() => (s.textContent = ''), 4000);
};

// ---------- 数据同步 ----------
window.api.onCourses((c) => {
  courses = c;
  render();
});
window.api.getCourses().then((c) => {
  courses = c;
  render();
});
