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
const MODE_LABEL = { online: '线上', offline: '线下' };

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
