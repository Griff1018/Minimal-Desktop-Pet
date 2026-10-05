const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

contextBridge.exposeInMainWorld('api', {
  getTasks: () => ipcRenderer.invoke('tasks:get'),
  addTask: (t) => ipcRenderer.invoke('tasks:add', t),
  updateTask: (id, patch) => ipcRenderer.invoke('tasks:update', id, patch),
  completeTask: (id) => ipcRenderer.invoke('tasks:complete', id),
  deleteTask: (id) => ipcRenderer.invoke('tasks:delete', id),
  clearDone: () => ipcRenderer.invoke('tasks:clearDone'),

  pickFiles: () => ipcRenderer.invoke('dialog:files'),
  pickImages: () => ipcRenderer.invoke('dialog:images'),
  importImage: (p) => ipcRenderer.invoke('image:import', p),
  saveImageBuffer: (buf, ext) => ipcRenderer.invoke('image:saveBuffer', buf, ext),
  pathForFile: (f) => webUtils.getPathForFile(f),

  openTarget: (t) => ipcRenderer.invoke('open:target', t),
  openImage: (n) => ipcRenderer.invoke('open:image', n),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (p) => ipcRenderer.invoke('settings:set', p),
  getSprites: () => ipcRenderer.invoke('sprites:get'),

  mediaWatch: (on) => ipcRenderer.send('media:watch', on),
  onMediaInfo: on('media:info'),
  mediaKey: (name) => ipcRenderer.send('media:key', name),
  dragStart: () => ipcRenderer.send('pet:dragStart'),
  resizeStart: (sign) => ipcRenderer.send('pet:resizeStart', sign),
  getEnv: () => ipcRenderer.invoke('pet:getEnv'),
  setSide: (s) => ipcRenderer.invoke('pet:setSide', s),
  loopEnd: () => ipcRenderer.send('pet:loopEnd'),
  resizeBy: (d) => ipcRenderer.send('pet:resizeBy', d),
  ignoreMouse: (v) => ipcRenderer.send('pet:ignoreMouse', v),
  petMenu: () => ipcRenderer.send('pet:menu'),
  openManager: () => ipcRenderer.send('manager:open'),
  openTaskWindow: (id) => ipcRenderer.send('task:openWindow', id),

  getCourses: () => ipcRenderer.invoke('courses:get'),
  addCourses: (list) => ipcRenderer.invoke('courses:add', list),
  updateCourse: (id, patch) => ipcRenderer.invoke('courses:update', id, patch),
  deleteCourse: (id) => ipcRenderer.invoke('courses:delete', id),
  clearCourses: () => ipcRenderer.invoke('courses:clear'),
  importCourses: (payload) => ipcRenderer.invoke('courses:import', payload),
  pickIcs: () => ipcRenderer.invoke('dialog:ics'),

  onTasks: on('tasks'),
  onCourses: on('courses'),
  onSettings: on('settings'),
  onSprites: on('sprites'),
  onTaskCompleted: on('task-completed'),
  onToggleBubble: on('toggle-bubble'),
  onZone: on('zone'),
});
