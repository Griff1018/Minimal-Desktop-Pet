// ---------- 课程表：每周课表、课程管理、.ics 导入预览（管理窗口） ----------
// 依赖：course.js / ics.js 的日期与解析工具，manager.js 里的 $ / el / setView

let ttWeek = mondayOf(new Date());
let editingCourseId = null;
let formMode = 'offline';
const tint = (color) => `color-mix(in srgb, ${color} 16%, var(--tint-base))`;
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
  const info = [c.teacher && `👤 ${c.teacher}`, ...courseWhere(c)].filter(Boolean).join('   ');
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
  // 同一天里重叠的课并排：这一天的列按“并排数”加宽，保证每节课至少有 96px 宽，不会挤成一条竖线
  const lay = occ.map(layoutLanes);
  const maxLanes = lay.map((l) => Math.max(1, ...l.map((x) => x.lanes)));
  const HOUR = 64; // 每小时的高度，大一点才放得下课名 / 时间 / 地点 / 老师
  const height = (maxH - minH) * HOUR;
  const grid = $('ttGrid');
  grid.replaceChildren();
  grid.style.setProperty('--hh', HOUR + 'px');
  grid.style.gridTemplateColumns = '40px ' + maxLanes.map((n) => `minmax(${96 * n}px, ${n}fr)`).join(' ');
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
    for (const it of lay[i]) {
      const c = it.c;
      const color = courseColor(c.name);
      const b = el('div', 'tt-block');
      b.style.top = ((it.s - minH * 60) / 60) * HOUR + 'px';
      const bh = Math.max(34, ((it.e - it.s) / 60) * HOUR - 2);
      b.style.height = bh + 'px';
      if (bh < 58) b.classList.add('short');
      b.style.left = `calc(${(it.lane / it.lanes) * 100}% + 1px)`;
      b.style.width = `calc(${100 / it.lanes}% - 2px)`;
      b.style.borderLeftColor = color;
      b.style.background = tint(color);
      b.append(el('div', 'b-name', c.name));
      b.append(el('div', 'b-sub b-time', `${c.start}–${c.end}`));
      if (bh >= 58) b.append(el('div', 'b-sub', MODE_LABEL[c.mode] + (courseWhere(c).length ? ' · ' + courseWhere(c).map((x) => x.slice(2)).join(' / ') : '')));
      if (bh >= 74 && c.teacher) b.append(el('div', 'b-sub', '👤 ' + c.teacher));
      b.title = [c.name, `${WEEKDAY_CN[c.weekday]} ${c.start}–${c.end}`, MODE_LABEL[c.mode], c.teacher, ...courseWhere(c)].filter(Boolean).join(String.fromCharCode(10));
      b.onclick = () => openCourseForm(c);
      col.append(b);
    }
    grid.append(col);
  });
  // 统计：课程数（按课程名去重）、每周节数 / 学时、学分
  const st = courseStats(courses);
  const sum = $('ttSummary');
  sum.hidden = !courses.length;
  sum.replaceChildren();
  const stat = (label, value, unit) => {
    const d = el('div');
    d.append(document.createTextNode(label), el('b', null, value), document.createTextNode(unit));
    sum.append(d);
  };
  stat('📚 课程 ', String(st.courses), ' 门');
  stat('🗓 每周 ', fmtNum(st.sessions), ' 节');
  if (st.oneOff) sum.append(el('div', 'none', `另有 ${st.oneOff} 节单次课（不计入每周）`));
  stat('⏱ 每周 ', fmtNum(st.weeklyHours), ' 学时');
  if (st.overlapSaved > 0.01) sum.append(el('div', 'none', `（线上 / 线下重叠的 ${fmtNum(st.overlapSaved)} 学时已按同时段只算一次）`));
  if (st.credits > 0) stat('🎓 学分 ', fmtNum(st.credits), ' credit hours');
  else sum.append(el('div', 'none', '🎓 学分：还没填写（编辑课程时可填 Credit hour）'));
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
    const meta = [`${WEEKDAY_CN[c.weekday]} ${c.start}–${c.end}`, c.teacher && `👤 ${c.teacher}`, c.credit != null && `🎓 ${c.credit} 学分`, ...courseWhere(c), courseRangeText(c)]
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
  $('cModeHybrid').classList.toggle('on', mode === 'hybrid');
  $('cPlaceLabel').textContent = mode === 'online' ? '会议链接 / 平台' : '教室 / 地点';
  $('cPlace').placeholder = mode === 'online' ? '例如：https://zoom.us/j/…  或  腾讯会议 123 456' : '例如：B3-201';
  $('cLinkWrap').hidden = mode !== 'hybrid';
}
$('cModeOffline').onclick = () => setFormMode('offline');
$('cModeOnline').onclick = () => setFormMode('online');
$('cModeHybrid').onclick = () => setFormMode('hybrid');

function openCourseForm(c) {
  editingCourseId = c ? c.id : null;
  $('ttForm').hidden = false;
  $('ttView').classList.add('editing');
  $('ttFormTitle').textContent = c ? '编辑课程' : '添加课程';
  $('cName').value = c ? c.name : '';
  $('cTeacher').value = c ? c.teacher : '';
  $('cCredit').value = c && c.credit != null ? c.credit : '';
  document.querySelectorAll('.cday').forEach((cb) => (cb.checked = !!c && +cb.value === c.weekday));
  $('cStart').value = c ? c.start : '09:00';
  $('cEnd').value = c ? c.end : '10:30';
  setFormMode(c ? c.mode : 'offline');
  $('cPlace').value = c ? c.place : '';
  $('cLink').value = c ? c.link || '' : '';
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
  $('ttView').classList.remove('editing');
}
$('ttAdd').onclick = () => openCourseForm(null);
$('ttCancel').onclick = closeCourseForm;
$('ttSave').onclick = async () => {
  const name = $('cName').value.split(/[\r\n]+/).map((x) => x.trim()).filter(Boolean).join(' ');
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
    name, teacher: $('cTeacher').value.trim(), mode: formMode, place: $('cPlace').value.trim(), link: formMode === 'hybrid' ? $('cLink').value.trim() : '',
    start, end, from, until, interval: +$('cInterval').value || 1,
    credit: $('cCredit').value === '' ? null : +$('cCredit').value,
  };
  if (editingCourseId) {
    const old = courses.find((c) => c.id === editingCourseId);
    await window.api.updateCourse(editingCourseId, { ...base, weekday: days[0], exceptions: old ? old.exceptions : [] });
    // 同一门课（同名）的学分保持一致
    if (base.credit !== null) {
      for (const o of courses.filter((x) => x.id !== editingCourseId && x.name === name && x.credit !== base.credit)) {
        await window.api.updateCourse(o.id, { credit: base.credit });
      }
    }
    if (days.length > 1) await window.api.addCourses(days.slice(1).map((weekday) => ({ ...base, weekday })));
  } else {
    const r = await window.api.addCourses(days.map((weekday) => ({ ...base, weekday })));
    if (r && r.skipped) flashStatus(`已有完全相同的课程，跳过 ${r.skipped} 条重复`);
  }
  closeCourseForm();
};

function flashStatus(msg) {
  const s = $('ttStatus');
  s.textContent = msg;
  setTimeout(() => (s.textContent = ''), 5000);
}

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
const sigOf = courseSig; // 课名 + 星期 + 起止时间 + 地点 + 方式 完全一致才算重复

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
  // 同一科目线上 / 线下时间重叠 → 提供“合并为线上+线下”的选项（默认不合并，由用户决定）
  r.merges = findHybridMerges(r.courses)
    .filter((m) => !r.courses[m.a]._dup && !r.courses[m.b]._dup)
    .map((m) => ({ ...m, _on: false }));
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
    `共读到 ${st.courses.length + st.skipped.length + (st.stats ? st.stats.merged + st.stats.dupes : 0)} 个事件 → 生成 ${st.courses.length} 条每周课程规则` +
    (st.stats && (st.stats.merged || st.stats.dupes) ? `（已自动合并 / 去除 ${st.stats.merged + st.stats.dupes} 个重复事件）` : '') +
    (st.skipped.length ? `，跳过 ${st.skipped.length} 个` : '') + (dup ? `，其中 ${dup} 条与已有课程时间地点完全相同，已自动去除（默认不勾选）` : '') + '。';
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
    if (c._dup) l1.append(document.createTextNode(' '), el('span', 'flag', '重复·已自动去除'));
    main.append(l1);
    main.append(el('div', 'cl-meta', [`${WEEKDAY_CN[c.weekday]} ${c.start}–${c.end}`, c.teacher && `👤 ${c.teacher}`, c.credit != null && `🎓 ${c.credit} 学分`, ...courseWhere(c), courseRangeText(c)].filter(Boolean).join('  ·  ')));
    if (c.exceptions.length) main.append(el('div', 'cl-note', `停课 ${c.exceptions.length} 天：${c.exceptions.slice(0, 4).map((d) => d.slice(5)).join('、')}${c.exceptions.length > 4 ? '…' : ''}`));
    for (const n of c.notes || []) main.append(el('div', 'cl-note', '⚠ ' + n));
    row.append(cb, dot, main);
    list.append(row);
  }
  renderImportMerges();
  const box = $('imSkippedBox');
  box.hidden = !st.skipped.length;
  $('imSkippedSum').textContent = `已跳过 ${st.skipped.length} 个事件`;
  const sk = $('imSkipped');
  sk.replaceChildren();
  for (const s of st.skipped) sk.append(el('div', 'cl-note', `${s.name} — ${s.reason}`));
  updateImportCount();
}
const describeSide = (c) => `${MODE_LABEL[c.mode]} ${c.start}–${c.end}${c.place ? ' ' + c.place : ''}`;
function renderImportMerges() {
  const box = $('imMerges');
  const ms = importState.merges || [];
  box.hidden = !ms.length;
  box.replaceChildren();
  if (!ms.length) return;
  box.append(el('div', null, `🔀 发现 ${ms.length} 组「同一科目、时间重叠」的线上 / 线下课程。可以合并成一条「线上+线下」课程，不合并则两条都保留（默认不合并，请自行选择）：`));
  for (const m of ms) {
    const a = importState.courses[m.a];
    const b = importState.courses[m.b];
    const row = el('label', 'mg-row');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = m._on;
    cb.onchange = () => {
      m._on = cb.checked;
      updateImportCount();
    };
    const t = el('div');
    t.append(el('b', null, a.name), document.createTextNode(` · ${WEEKDAY_CN[a.weekday]}　`), document.createTextNode(`${describeSide(a)}  +  ${describeSide(b)}`));
    row.append(cb, t);
    box.append(row);
  }
  const tools = el('div', 'im-tools');
  const all = el('button', null, '全部合并');
  all.onclick = () => {
    ms.forEach((m) => (m._on = true));
    renderImportMerges();
    updateImportCount();
  };
  const none = el('button', null, '全不合并');
  none.onclick = () => {
    ms.forEach((m) => (m._on = false));
    renderImportMerges();
    updateImportCount();
  };
  tools.append(all, none);
  box.append(tools);
}
function updateImportCount() {
  if (!importState) return;
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
  // 先应用用户选中的合并（两条都被勾选时才合并）；其余原样导入
  const replaced = new Map();
  const dropped = new Set();
  for (const m of importState.merges || []) {
    const a = importState.courses[m.a];
    const b = importState.courses[m.b];
    if (m._on && a._on && b._on) {
      replaced.set(a, { ...m.merged, _on: true });
      dropped.add(b);
    }
  }
  const list = importState.courses
    .filter((c) => c._on && !dropped.has(c))
    .map((c) => replaced.get(c) || c)
    .map((c) => {
      const o = { ...c };
      delete o._on;
      delete o._dup;
      delete o.notes;
      if (!o.until && defUntil) o.until = defUntil;
      return o;
    });
  const r = await window.api.importCourses({ list, replaceIcs: $('imReplace').checked });
  closeImport();
  flashStatus(`已导入 ${r ? r.added : list.length} 条课程` + (r && r.skipped ? `，自动跳过 ${r.skipped} 条重复` : ''));
};

// ---------- 合并已有课程里时间重叠的线上 / 线下课程（用户逐组选择） ----------
$('ttMerge').onclick = () => {
  const ms = findHybridMerges(courses).map((m) => ({
    keepId: m.merged.id,
    dropId: m.merged.id === courses[m.a].id ? courses[m.b].id : courses[m.a].id,
    a: courses[m.a],
    b: courses[m.b],
    merged: m.merged,
    on: false,
  }));
  if (!ms.length) {
    alert('没有发现可以合并的课程：需要「同一科目、同一天、时间重叠，且一条线上一条线下」。');
    return;
  }
  const overlay = el('div', 'modal');
  const box = el('div', 'modal-box');
  const head = el('div', 'modal-head');
  head.append(el('b', null, `合并重叠课程（发现 ${ms.length} 组）`));
  box.append(head, el('div', 'hint', '同一科目在同一天、时间重叠，一条线上一条线下。合并后变成一条「线上+线下」课程（保留教室和链接）。请勾选要合并的组：'));
  const list = el('div', 'im-list');
  const go = el('button', 'primary', '合并所选 (0)');
  go.disabled = true;
  const refresh = () => {
    const n = ms.filter((m) => m.on).length;
    go.textContent = `合并所选 (${n})`;
    go.disabled = !n;
  };
  for (const m of ms) {
    const row = el('label', 'im-row');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.onchange = () => {
      m.on = cb.checked;
      refresh();
    };
    const main = el('div', 'cl-main');
    main.append(el('div', 'cl-l1', `${m.a.name} · ${WEEKDAY_CN[m.a.weekday]}`));
    main.append(el('div', 'cl-meta', `${describeSide(m.a)}  +  ${describeSide(m.b)}`));
    main.append(el('div', 'cl-meta', `→ 线上+线下 ${m.merged.start}–${m.merged.end}`));
    row.append(cb, main);
    list.append(row);
  }
  const foot = el('div', 'modal-foot');
  const cancel = el('button', null, '取消');
  const close = () => overlay.remove();
  cancel.onclick = close;
  go.onclick = async () => {
    for (const m of ms.filter((x) => x.on)) {
      const { id, notes, source, uid, ...patch } = m.merged;
      await window.api.updateCourse(m.keepId, patch);
      await window.api.deleteCourse(m.dropId);
    }
    close();
    flashStatus(`已合并 ${ms.filter((x) => x.on).length} 组课程`);
  };
  foot.append(cancel, go);
  box.append(list, foot);
  overlay.append(box);
  overlay.addEventListener('mousedown', (e) => e.target === overlay && close());
  document.body.append(overlay);
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
