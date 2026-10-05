const taskId = decodeURIComponent(location.hash.slice(1));
const root = document.getElementById('root');
let tasks = [];

function render() {
  const t = tasks.find((x) => x.id === taskId);
  if (!t) {
    root.replaceChildren(dEl('div', 'gone', '该事项已被删除'));
    document.title = '任务详情';
    return;
  }
  document.title = taskTitle(t).slice(0, 30);
  renderTaskDetail(root, t, {
    onDone: () => window.api.completeTask(t.id),
    onRestore: () => window.api.updateTask(t.id, { done: false }),
  });
}
const applyTheme = (s) => (document.documentElement.dataset.theme = s.bubbleTheme || 'light');

window.api.onTasks((t) => {
  tasks = t;
  render();
});
window.api.onSettings(applyTheme);
(async () => {
  applyTheme(await window.api.getSettings());
  tasks = await window.api.getTasks();
  render();
})();
setInterval(render, 60000); // 刷新“已逾期”状态
