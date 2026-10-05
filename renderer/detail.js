// 任务详情渲染：对话框里的“聚焦”视图和独立的任务窗口共用
const PRIORITY_LABEL = { 3: '高优先级', 2: '中优先级', 1: '低优先级' };

// 标题 / 内容：新任务有 title 字段；旧任务只有 text，取第一行当标题、其余当内容
function taskTitle(t) {
  return t.title || (t.text || '').split('\n')[0].slice(0, 80);
}
function taskBody(t) {
  return t.title ? t.text || '' : (t.text || '').split('\n').slice(1).join('\n').trim();
}

function dEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function dFmt(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function dBtn(label, fn, cls) {
  const b = dEl('button', 'btn' + (cls ? ' ' + cls : ''), label);
  b.onclick = fn;
  return b;
}

// opts: { onBack, onPopout, onDone, onRestore, quiet }
function renderTaskDetail(container, t, opts) {
  container.replaceChildren();
  if (opts.onBack || opts.onPopout) {
    const bar = dEl('div', 'd-bar');
    if (opts.onBack) bar.append(dBtn('← 返回', opts.onBack));
    bar.append(dEl('div', 'sp'));
    if (opts.onPopout) bar.append(dBtn('⧉ 在新窗口打开', opts.onPopout));
    container.append(bar);
  }

  const card = dEl('div', `d-card p${t.priority}`);
  card.append(dEl('div', 'bar'));
  const main = dEl('div', 'd-main');
  main.append(dEl('div', 'd-pri', PRIORITY_LABEL[t.priority] + (t.done ? ' · 已完成' : '')));
  main.append(dEl('div', 'd-title', taskTitle(t)));
  if (taskBody(t)) main.append(dEl('div', 'd-text', taskBody(t)));
  const overdue = !t.done && t.due && new Date(t.due).getTime() < Date.now();
  if (t.due) main.append(dEl('div', 'd-meta' + (overdue ? ' over' : ''), (overdue ? '已逾期 · 截止 ' : '截止 ') + dFmt(t.due)));
  main.append(dEl('div', 'd-meta', '创建于 ' + dFmt(t.createdAt) + (t.done && t.doneAt ? ' · 完成于 ' + dFmt(t.doneAt) : '')));

  if (t.links && t.links.length) {
    main.append(dEl('div', 'd-sec', 'LINKS / 文件链接'));
    for (const l of t.links) {
      const a = dEl('span', 'd-link', '📎 ' + l.name);
      a.title = l.target;
      a.onclick = async () => {
        const err = await window.api.openTarget(l.target);
        if (err && !opts.quiet) alert('无法打开：' + err);
      };
      main.append(a);
    }
  }
  if (t.imageUrls && t.imageUrls.length) {
    main.append(dEl('div', 'd-sec', 'IMAGES / 图片（点击用系统查看器打开）'));
    t.imageUrls.forEach((u, i) => {
      const img = dEl('img', 'd-img');
      img.src = u;
      img.onclick = () => window.api.openImage(t.images[i]);
      main.append(img);
    });
  }
  card.append(main);
  container.append(card);

  if (opts.onDone || opts.onRestore) {
    const foot = dEl('div', 'd-foot');
    if (!t.done && opts.onDone) foot.append(dBtn('✓ 完成', opts.onDone, 'primary'));
    if (t.done && opts.onRestore) foot.append(dBtn('恢复为待办', opts.onRestore));
    container.append(foot);
  }
}
