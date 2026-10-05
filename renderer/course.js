// 课程表共用：日期工具、某天是否有课、配色（管理窗口和宠物对话框都用）
// 课程（每周重复规则）：
//   { id, name, teacher, mode: 'online'|'offline', place,
//     weekday: 1-7（周一=1）, start: 'HH:mm', end: 'HH:mm',
//     from: 'YYYY-MM-DD'|null, until: 'YYYY-MM-DD'|null,   // 学期起止（可空 = 不限）
//     interval: 1|2|…（每几周一次）, exceptions: ['YYYY-MM-DD'…]（停课日）,
//     source: 'manual'|'ics', uid }
let courses = []; // 全局课程列表，由各页面从主进程加载

const COURSE_COLORS = ['#4f6ef7', '#e5484d', '#f5a524', '#46a758', '#9b59d0', '#14a3b8', '#e5702d', '#d6409f'];
function courseColor(name) {
  let h = 0;
  for (const ch of name || '') h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return COURSE_COLORS[h % COURSE_COLORS.length];
}
const WEEKDAY_CN = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const MODE_LABEL = { online: '线上', offline: '线下', hybrid: '线上+线下' };

const keyToDate = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const dateToKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isoWeekday = (d) => ((d.getDay() + 6) % 7) + 1; // 周一=1 … 周日=7
const mondayOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
const weeksBetween = (a, b) => Math.round((mondayOf(b) - mondayOf(a)) / (7 * 864e5));
const hm2min = (s) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

function courseOccursOn(c, key) {
  if (c.from && key < c.from) return false;
  if (c.until && key > c.until) return false;
  if (c.exceptions && c.exceptions.includes(key)) return false;
  const d = keyToDate(key);
  if (isoWeekday(d) !== c.weekday) return false;
  const iv = c.interval || 1;
  if (iv > 1 && c.from && weeksBetween(keyToDate(c.from), d) % iv !== 0) return false;
  return true;
}
function coursesOnDate(list, key) {
  return list.filter((c) => courseOccursOn(c, key)).sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
}
// 重复规则的简短描述
function courseRangeText(c) {
  if (c.until && c.from && c.until === c.from) return `仅 ${c.from.slice(5)}`;
  const parts = [];
  if (c.interval > 1) parts.push(`每 ${c.interval} 周`);
  if (c.from || c.until) parts.push(`${c.from ? c.from.slice(5) : '…'} ~ ${c.until ? c.until.slice(5) : '…'}`);
  return parts.join(' · ') || '每周';
}

// 课程统计：门数按课程名去重（周一周三各一节的同一门课只算 1 门），学分按门累计（同名多条取其中最大的学分）。
// 学时 / 节数：同一科目、同一天里时间重叠的记录（常见于线上 + 线下两条）只算一次，取并集。
function courseStats(list) {
  const credits = new Map();
  const groups = new Map();
  let naive = 0;
  let oneOff = 0;
  for (const c of list) {
    const k = (c.name || '').trim().toLowerCase();
    credits.set(k, Math.max(credits.get(k) || 0, +c.credit || 0));
    if (c.from && c.until && c.from === c.until) {
      oneOff++; // 单次课（只有某一天）不计入“每周”的节数 / 学时
      continue;
    }
    const iv = c.interval || 1;
    const gk = [k, c.weekday, iv].join('|');
    if (!groups.has(gk)) groups.set(gk, { iv, spans: [] });
    groups.get(gk).spans.push([hm2min(c.start), hm2min(c.end)]);
    naive += (hm2min(c.end) - hm2min(c.start)) / 60 / iv;
  }
  let weeklyHours = 0;
  let sessions = 0;
  for (const g of groups.values()) {
    const spans = g.spans.sort((x, y) => x[0] - y[0]);
    let cur = null;
    for (const [st, en] of spans) {
      if (cur && st < cur[1]) cur[1] = Math.max(cur[1], en);
      else {
        if (cur) {
          weeklyHours += (cur[1] - cur[0]) / 60 / g.iv;
          sessions += 1 / g.iv;
        }
        cur = [st, en];
      }
    }
    if (cur) {
      weeklyHours += (cur[1] - cur[0]) / 60 / g.iv;
      sessions += 1 / g.iv;
    }
  }
  let total = 0;
  for (const v of credits.values()) total += v;
  return { courses: credits.size, credits: total, weeklyHours, sessions, oneOff, overlapSaved: Math.max(0, naive - weeklyHours) };
}
const fmtNum = (n) => String(Math.round(n * 10) / 10);
// 完全相同（课名、星期、起止时间、地点、方式）的课视为重复
const courseSig = (c) => [(c.name || '').trim().toLowerCase(), c.weekday, c.start, c.end, (c.place || '').trim().toLowerCase(), c.mode, (c.link || '').trim().toLowerCase()].join('|');

// 上课地点 / 链接的展示：线下 📍 教室，线上 🔗 链接，混合两个都有
function courseWhere(c) {
  if (c.mode === 'hybrid') return [c.place && `📍 ${c.place}`, c.link && `🔗 ${c.link}`].filter(Boolean);
  return c.place ? [`${c.mode === 'online' ? '🔗' : '📍'} ${c.place}`] : [];
}

// ---- 同一科目线上 / 线下重叠 → 合并为 hybrid（由用户选择是否应用，不会自动合并） ----
const normName = (n) => (n || '').trim().replace(/\s+/g, ' ').toLowerCase();
const rangesOverlap = (a, b) => (a.from || '') <= (b.until || '9999-99-99') && (b.from || '') <= (a.until || '9999-99-99');
function mergeHybrid(a, b) {
  const off = a.mode === 'offline' ? a : b;
  const on = off === a ? b : a;
  const both = (x, y, pick) => (x && y ? pick(x, y) : null);
  const notes = [...(off.notes || []), '合并了线下 + 线上两条时间重叠的记录'];
  if (a.start !== b.start || a.end !== b.end) notes.push('两条的起止时间略有不同，合并后取并集');
  return {
    ...off,
    mode: 'hybrid',
    place: off.place,
    link: on.place || on.link || '',
    start: a.start < b.start ? a.start : b.start,
    end: a.end > b.end ? a.end : b.end,
    teacher: off.teacher || on.teacher || '',
    credit: off.credit != null ? off.credit : on.credit != null ? on.credit : null,
    from: both(a.from, b.from, (x, y) => (x < y ? x : y)),
    until: both(a.until, b.until, (x, y) => (x > y ? x : y)),
    exceptions: (off.exceptions || []).filter((d) => (on.exceptions || []).includes(d)), // 两边都停课的那天才算停课
    notes,
  };
}
// 返回 [{ a, b, merged }]（a / b 是 list 里的下标）
function findHybridMerges(list) {
  const used = new Set();
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (used.has(i) || a.mode === 'hybrid') continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (used.has(j) || b.mode === 'hybrid' || a.mode === b.mode) continue;
      if (normName(a.name) !== normName(b.name) || a.weekday !== b.weekday) continue;
      if (!(hm2min(a.start) < hm2min(b.end) && hm2min(b.start) < hm2min(a.end))) continue;
      if (!rangesOverlap(a, b)) continue;
      used.add(i);
      used.add(j);
      out.push({ a: i, b: j, merged: mergeHybrid(a, b) });
      break;
    }
  }
  return out;
}
