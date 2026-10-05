// ICS（iCalendar）导入：解析 .ics 文本 → 课程规则。依赖 course.js 里的日期工具。
// 支持：每周重复（INTERVAL / BYDAY / UNTIL / COUNT）、EXDATE 停课日、UTC / TZID 时区换算、单次事件。
// 不支持的（会在预览里列为“跳过”或备注）：全天事件、按日 / 月 / 年重复、RECURRENCE-ID 单次改期。

function icsSplitLine(line) {
  let inQuote = false;
  let idx = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ':' && !inQuote) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return null;
  const parts = line.slice(0, idx).split(';');
  const name = parts.shift().toUpperCase();
  const params = {};
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value: line.slice(idx + 1) };
}
const icsUnescape = (v) => (v || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function parseICS(text) {
  text = String(text).replace(/^﻿/, '');
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const raw = [];
  let cur = null;
  let depth = 0;
  for (const l of lines) {
    const line = l.trimEnd();
    if (!line) continue;
    const up = line.toUpperCase();
    if (up === 'BEGIN:VEVENT') {
      cur = [];
      depth = 0;
    } else if (cur) {
      if (up.startsWith('BEGIN:')) depth++;
      else if (up.startsWith('END:')) {
        if (depth > 0) depth--;
        else if (up === 'END:VEVENT') {
          raw.push(cur);
          cur = null;
        }
      } else if (depth === 0) {
        const p = icsSplitLine(line);
        if (p) cur.push(p);
      }
    }
  }
  return { isCalendar: /BEGIN:VCALENDAR/i.test(text), events: raw.map(icsBuildEvent) };
}

function icsBuildEvent(props) {
  const first = (n) => props.find((p) => p.name === n);
  const all = (n) => props.filter((p) => p.name === n);
  const val = (n) => {
    const p = first(n);
    return p ? icsUnescape(p.value) : '';
  };
  const dur = first('DURATION');
  return {
    summary: val('SUMMARY'),
    description: val('DESCRIPTION'),
    location: val('LOCATION'),
    url: val('URL'),
    uid: val('UID'),
    organizer: first('ORGANIZER'),
    attendees: all('ATTENDEE'),
    dtstart: icsParseDate(first('DTSTART')),
    dtend: icsParseDate(first('DTEND')),
    duration: dur ? icsParseDuration(dur.value) : 0,
    rrule: first('RRULE') ? first('RRULE').value : '',
    exdates: all('EXDATE').flatMap((p) => p.value.split(',').map((v) => icsParseDate({ value: v, params: p.params })).filter(Boolean)),
    hasRecurrenceId: !!first('RECURRENCE-ID'),
  };
}
function icsParseDate(prop) {
  if (!prop) return null;
  const m = prop.value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/i);
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), utc: !!m[7], tzid: (prop.params && prop.params.TZID) || null, allDay: !m[4] };
}
function icsParseDuration(v) {
  const m = v.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return 0;
  return (+m[1] || 0) * 10080 + (+m[2] || 0) * 1440 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

// ---- 时区：把带 TZID 的“墙上时间”换成本机时间 ----
const icsLocalTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
function icsValidTz(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
function icsTzOffsetMs(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
function icsToLocal(dt) {
  if (dt.allDay) return { date: new Date(dt.y, dt.mo - 1, dt.d), allDay: true };
  let ms;
  if (dt.utc) ms = Date.UTC(dt.y, dt.mo - 1, dt.d, dt.h, dt.mi);
  else if (dt.tzid && dt.tzid !== icsLocalTz && icsValidTz(dt.tzid)) {
    const guess = Date.UTC(dt.y, dt.mo - 1, dt.d, dt.h, dt.mi);
    ms = guess - icsTzOffsetMs(guess, dt.tzid);
    ms = guess - icsTzOffsetMs(ms, dt.tzid);
  } else return { date: new Date(dt.y, dt.mo - 1, dt.d, dt.h, dt.mi) }; // 本地 / 浮动时间 / 未知时区名
  return { date: new Date(ms) };
}

// ---- 老师 / 线上线下 / 地点 ----
const ICS_ONLINE_RE = /https?:\/\/|zoom|teams|meet\.google|腾讯会议|钉钉|飞书|线上|在线|网课|online|webex|bigbluebutton/i;
const ICS_TEACHER_RE = /(?:授课教师|任课教师|教师|老师|讲师|主讲|Teacher|Instructor|Lecturer|Professor|Prof\.?)\s*[:：]\s*([^\n;,，；]+)/i;
function icsMeta(ev) {
  let teacher = '';
  const m = (ev.description + '\n' + ev.summary).match(ICS_TEACHER_RE);
  if (m) teacher = m[1].trim();
  if (!teacher && ev.organizer && ev.organizer.params.CN) teacher = ev.organizer.params.CN;
  if (!teacher && ev.attendees.length && ev.attendees[0].params.CN) teacher = ev.attendees[0].params.CN;
  teacher = teacher.replace(/^mailto:/i, '');
  const urlInDesc = (ev.description.match(/https?:\/\/\S+/) || [])[0] || '';
  const online = ICS_ONLINE_RE.test(ev.location) || !!ev.url || ICS_ONLINE_RE.test(ev.summary) || (!ev.location && !!urlInDesc);
  let place = ev.location || ev.url || (online ? urlInDesc : '');
  return { teacher, mode: online ? 'online' : 'offline', place: place.trim() };
}

const ICS_DAYMAP = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
const icsHM = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// 事件 → 课程规则；返回 { courses, skipped:[{name, reason}] }。每条课程带 notes（备注）供预览显示
function icsToCourses(events) {
  const out = [];
  const skipped = [];
  for (const ev of events) {
    const name = (ev.summary || '').trim() || '(未命名课程)';
    if (ev.hasRecurrenceId) {
      skipped.push({ name, reason: '单次改期 / 调课（RECURRENCE-ID）暂不支持' });
      continue;
    }
    const s0 = ev.dtstart && icsToLocal(ev.dtstart);
    if (!s0) {
      skipped.push({ name, reason: '没有有效的开始时间' });
      continue;
    }
    if (s0.allDay) {
      skipped.push({ name, reason: '全天事件' });
      continue;
    }
    const S = s0.date;
    let E = ev.dtend ? icsToLocal(ev.dtend).date : ev.duration ? new Date(S.getTime() + ev.duration * 60000) : null;
    const notes = [];
    if (!E || !(E > S)) {
      E = new Date(S.getTime() + 3600000);
      notes.push('没有有效结束时间，按 1 小时计');
    }
    if (dateToKey(E) !== dateToKey(S)) {
      E = new Date(S.getFullYear(), S.getMonth(), S.getDate(), 23, 59);
      notes.push('跨天，结束时间截到 23:59');
    }
    const meta = icsMeta(ev);
    const fromKey = dateToKey(S);
    const base = { name, ...meta, start: icsHM(S), end: icsHM(E), source: 'ics', uid: ev.uid, exceptions: [] };
    const once = (extra) => out.push({ ...base, weekday: isoWeekday(S), from: fromKey, until: fromKey, interval: 1, notes: [...notes, ...(extra ? [extra] : [])] });

    if (!ev.rrule) {
      once();
      continue;
    }
    const rule = {};
    for (const part of ev.rrule.split(';')) {
      const [k, v] = part.split('=');
      if (k) rule[k.toUpperCase()] = v;
    }
    if ((rule.FREQ || '').toUpperCase() !== 'WEEKLY') {
      once(`暂不支持“${rule.FREQ || '未知'}”重复，只导入第一次`);
      continue;
    }
    const interval = Math.max(1, +rule.INTERVAL || 1);
    // 时区换算可能让日期差一天，BYDAY / UNTIL 要跟着偏移
    const o = ev.dtstart;
    const shift = Math.round((Date.UTC(S.getFullYear(), S.getMonth(), S.getDate()) - Date.UTC(o.y, o.mo - 1, o.d)) / 864e5);
    let wds = rule.BYDAY
      ? rule.BYDAY.split(',').map((x) => ICS_DAYMAP[x.replace(/^[+-]?\d+/, '').toUpperCase()]).filter(Boolean)
      : [((isoWeekday(S) - 1 - shift + 70) % 7) + 1];
    wds = [...new Set(wds.map((w) => (((w - 1 + shift) % 7) + 7) % 7 + 1))].sort();

    let until = null;
    if (rule.UNTIL) {
      const u = icsParseDate({ value: rule.UNTIL, params: { TZID: o.tzid } });
      if (u) until = dateToKey(u.allDay ? new Date(u.y, u.mo - 1, u.d) : icsToLocal(u).date);
    } else if (rule.COUNT) {
      // 按 COUNT 推算最后一次上课的日期
      let left = +rule.COUNT;
      for (let i = 0; i < 3650 && left > 0; i++) {
        const d = new Date(S.getFullYear(), S.getMonth(), S.getDate() + i);
        if (wds.includes(isoWeekday(d)) && weeksBetween(S, d) % interval === 0) {
          left--;
          if (left === 0) until = dateToKey(d);
        }
      }
    }
    const exceptions = ev.exdates.map((x) => dateToKey(icsToLocal(x).date));
    if (!until) notes.push('没有结束日期（可在导入时统一设置学期结束日）');
    for (const w of wds) out.push({ ...base, weekday: w, from: fromKey, until, interval, exceptions: [...exceptions], notes: [...notes] });
  }
  return { courses: out, skipped };
}
