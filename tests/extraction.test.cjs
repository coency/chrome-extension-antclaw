const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
function storage(initial = {}) {
  const state = structuredClone(initial);
  return {
    state,
    async get(keys) { return Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map((key) => [key, structuredClone(state[key])])); },
    async set(value) { Object.assign(state, structuredClone(value)); },
  };
}
function background(local = storage()) {
  let listener;
  const events = [], notifications = [];
  const context = vm.createContext({
    crypto: { randomUUID }, Date, setTimeout: () => 1,
    chrome: {
      storage: { local },
      runtime: {
        onMessage: { addListener(fn) { listener = fn; } },
        async sendMessage(message) { events.push({ message, state: structuredClone(local.state) }); },
        getURL: (file) => file,
      },
      notifications: { create(options, callback) { notifications.push(options); callback('notification'); } },
    },
  });
  vm.runInContext(source('background.js'), context);
  const send = (message, tabId = 1) => new Promise((resolve) => listener(message, { tab: { id: tabId } }, resolve));
  return { local, send, events, notifications };
}
function content(sendMessage = async () => {}) {
  let listener;
  const context = vm.createContext({
    Date, console, AbortController, setTimeout, clearTimeout,
    chrome: { runtime: { sendMessage, onMessage: { addListener(fn) { listener = fn; } } } },
  });
  vm.runInContext(source('content.js'), context);
  return { context, send: (message) => new Promise((resolve) => listener(message, {}, resolve)) };
}
function popup(local, overrides = {}) {
  let listener, intervalId = 0;
  const intervals = new Map();
  const elements = Object.fromEntries(['platform', 'period', 'extract', 'csv', 'postCsv', 'zipCover', 'status', 'result'].map((id) => [id, {
    value: id === 'platform' ? '抖音' : 'month', disabled: false, textContent: '', className: '', events: {},
    addEventListener(event, fn) { this.events[event] = fn; },
  }]));
  const context = vm.createContext({
    Date, URL, Blob, TextEncoder, setTimeout, clearTimeout,
    setInterval(fn) { intervals.set(++intervalId, fn); return intervalId; },
    clearInterval(id) { intervals.delete(id); },
    document: { getElementById: (id) => elements[id] },
    chrome: {
      storage: { local },
      runtime: { onMessage: { addListener(fn) { listener = fn; } } },
      downloads: { onChanged: { addListener() {} } },
      tabs: { query: (_, callback) => callback([{ id: 1, url: 'https://creator.douyin.com/' }]), ...overrides },
    },
  });
  vm.runInContext(source('popup.js'), context);
  return { context, elements, intervals, event: (message) => listener(message, {}, () => {}) };
}
const begin = { type: 'beginExtraction', platform: '抖音', period: 'month' };
const sample = { platform: '抖音', scopeLabel: '月度', period: '2026年09月', count: 1, posts: [{}], summaryCsv: 'csv', postCsv: 'csv' };

test('B 站分析样本共用任务锁、独立保存，不覆盖原 CSV 结果', async () => {
  const app = background(storage({ lastResult: sample }));
  const started = await app.send({ type: 'beginExtraction', platform: '哔哩哔哩', period: 'sample-20260929' });
  assert.equal(started.ok, true);
  assert.equal((await app.send(begin, 2)).busy, true);
  const data = { targetDate: '2026-09-29', works: [{ bvid: 'BV0000000001' }], warnings: [] };
  const result = await app.send({ type: 'endExtraction', taskId: started.taskId, data });
  assert.equal(result.ok, true);
  assert.deepEqual(app.local.state.lastResult, sample);
  assert.deepEqual(app.local.state.biliSampleResult, data);
  assert.equal(app.local.state.running, false);
  assert.match(app.notifications[0].message, /分析样本已采集/);
  assert.ok((await app.send({ type: 'beginExtraction', platform: '哔哩哔哩', period: 'month' })).cooldown > 0);
});

test('样本采集失败释放锁并保留旧样本及 CSV，不把样本错误写成周期提取错误', async () => {
  const oldSample = { targetDate: '2026-09-29', works: [] };
  const app = background(storage({ lastResult: sample, biliSampleResult: oldSample }));
  const started = await app.send({ type: 'beginExtraction', platform: '哔哩哔哩', period: 'sample-20260929' });
  const result = await app.send({ type: 'endExtraction', taskId: started.taskId, error: 'sample failed' });
  assert.equal(result.ok, false);
  assert.equal(app.local.state.running, false);
  assert.equal(app.local.state.biliSampleError, 'sample failed');
  assert.equal(app.local.state.lastError, null);
  assert.deepEqual(app.local.state.lastResult, sample);
  assert.deepEqual(app.local.state.biliSampleResult, oldSample);
});

for (const code of [8, 1001]) {
  test(`抖音明细业务错误 ${code} 保留作品并提示失败`, async () => {
    const { context } = content();
    context.errorCode = code;
    context.item = { id: '123', description: 'test', metrics: {}, create_time: Math.floor(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15).getTime() / 1000) };
    vm.runInContext(`axhr = async url => url.includes('work_list')
      ? {status_code: 0, items: [item], has_more: false}
      : url.includes('/item/') || url.includes('/item_analysis/')
        ? {status_code: errorCode, status_msg: 'failure'}
        : {status_code: 0, metrics: [{english_metric_name: 'play_cnt', metric_value: 1}]}`, context);
    const result = await vm.runInContext('douyinExtract("month", 4)', context);
    assert.equal(result.count, 1);
    assert.equal(result.posts[0].kw, '');
    assert.match(result.warning, /最大流量来源.*1 篇获取失败/);
    assert.match(result.warning, /搜索关键词.*1 篇获取失败/);
    assert.equal(result.warning.includes('登录失效'), code === 8);
  });
}

test('正常空明细仍显示暂无数据，不误报接口失败', async () => {
  const { context } = content();
  context.item = { id: '123', metrics: {}, create_time: Math.floor(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15).getTime() / 1000) };
  vm.runInContext(`axhr = async url => url.includes('work_list')
    ? {status_code: 0, items: [item], has_more: false}
    : {status_code: 0, metrics: [{english_metric_name: 'play_cnt', metric_value: 1}]}`, context);
  const result = await vm.runInContext('douyinExtract("month", 4)', context);
  assert.equal(result.posts[0].kw, '暂无数据');
  assert.equal(result.warning, '');
});

test('不同标签页同时启动时只有一个任务获准，后台重启后锁仍有效', async () => {
  const bg = background();
  const results = await Promise.all([bg.send(begin, 1), bg.send({ ...begin, platform: '视频号' }, 2)]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.filter((r) => r.busy).length, 1);
  const restarted = background(bg.local);
  assert.equal((await restarted.send(begin, 3)).busy, true);
});

test('成功结果先保存再广播，成功冷却不能通过重新打开或换标签页绕过', async () => {
  const bg = background();
  const { taskId } = await bg.send(begin);
  const result = await bg.send({ type: 'endExtraction', taskId, data: sample });
  assert.equal(result.ok, true);
  assert.equal(bg.events[0].message.type, 'extractDone');
  assert.equal(bg.events[0].state.running, false);
  assert.equal(bg.events[0].state.lastResult.count, 1);
  assert.equal(bg.local.state.lastError, null);
  assert.ok((await bg.send(begin, 2)).cooldown > 0);
  assert.equal((await bg.send({ ...begin, platform: '视频号' }, 2)).ok, true);
});

test('失败原因先保存再广播，保留上次成功结果并执行失败冷却', async () => {
  const bg = background(storage({ lastResult: sample }));
  const { taskId } = await bg.send(begin);
  const result = await bg.send({ type: 'endExtraction', taskId, error: '登录已失效' });
  assert.equal(result.ok, false);
  assert.equal(bg.events[0].message.type, 'extractFailed');
  assert.equal(bg.events[0].state.running, false);
  assert.equal(bg.events[0].state.lastError.message, '登录已失效');
  assert.equal(bg.local.state.lastResult.count, 1);
  assert.match(bg.notifications[0].message, /提取失败/);
  assert.ok((await bg.send(begin)).cooldown > 0);
});

test('过期任务的完成消息不能覆盖新任务或解锁', async () => {
  const bg = background();
  const old = await bg.send(begin);
  bg.local.state.runningAt = Date.now() - 31 * 60 * 1000;
  const current = await bg.send(begin, 2);
  assert.equal(current.ok, true);
  assert.equal((await bg.send({ type: 'endExtraction', taskId: old.taskId, data: sample })).ok, false);
  assert.equal(bg.local.state.runningId, current.taskId);
  assert.equal(bg.local.state.running, true);
  assert.equal(bg.events.length, 0);
});

test('结果存储失败仍释放锁并向当前弹窗返回可下载结果及警告', async () => {
  const local = storage();
  const set = local.set;
  local.set = async (value) => { if (value.lastResult) throw new Error('quota'); await set(value); };
  const bg = background(local);
  const { taskId } = await bg.send(begin);
  const result = await bg.send({ type: 'endExtraction', taskId, data: structuredClone(sample) });
  assert.equal(result.ok, true);
  assert.match(result.data.warning, /存储失败.*quota/);
  assert.equal(local.state.running, false);
  assert.match(local.state.lastError.message, /存储失败/);
});

test('内容脚本同步拦截重复请求，并将提取失败交给后台保存', async () => {
  const bg = background();
  const page = content((msg) => bg.send(msg));
  const pending = deferred();
  page.context.work = pending.promise;
  vm.runInContext('douyinExtract = async () => { await work; throw new Error("network failure"); }', page.context);
  const first = page.send({ type: 'extract', platform: '抖音' });
  const second = await page.send({ type: 'extract', platform: '抖音' });
  assert.equal(second.busy, true);
  pending.resolve();
  assert.equal((await first).error, 'network failure');
  assert.equal(bg.local.state.lastError.message, 'network failure');
  assert.equal(vm.runInContext('extractionActive', page.context), false);
});

test('未接入平台不会留下运行状态', async () => {
  const bg = background();
  const page = content((msg) => bg.send(msg));
  assert.equal((await page.send({ type: 'extract', platform: '小红书' })).ok, false);
  assert.equal(bg.local.state.running, undefined);
});

test('恢复运行中的任务时锁定选择器，切换事件不能重新启用提取', async () => {
  const ui = popup(storage({ running: true, runningAt: Date.now() }));
  await tick();
  assert.equal(ui.elements.extract.disabled, true);
  assert.equal(ui.elements.platform.disabled, true);
  assert.equal(ui.elements.period.disabled, true);
  ui.elements.period.value = 'week';
  ui.elements.period.events.change();
  await tick();
  assert.equal(ui.elements.extract.disabled, true);
  assert.match(ui.elements.status.textContent, /提取中/);
});

test('重新打开的弹窗接到失败广播后退出提取中，显示持久化错误', async () => {
  const local = storage({ running: true, runningAt: Date.now(), lastResult: sample });
  const ui = popup(local);
  await tick();
  await local.set({ running: false, lastError: { platform: '抖音', period: 'week', message: '登录已失效', at: Date.now() } });
  ui.event({ type: 'extractFailed' });
  await tick();
  assert.match(ui.elements.status.textContent, /提取失败！登录已失效/);
  assert.equal(ui.elements.status.className, 'err');
  assert.equal(ui.elements.period.disabled, false);
  assert.equal(ui.elements.period.value, 'week');
  assert.equal(ui.elements.csv.disabled, true);
  assert.equal(ui.elements.extract.disabled, true); // 5 秒失败冷却
  for (let i = 0; i < 5; i++) for (const fn of [...ui.intervals.values()]) fn();
  assert.equal(ui.elements.extract.disabled, false);
  const reopened = popup(local);
  await tick();
  assert.match(reopened.elements.status.textContent, /登录已失效/);
});

test('恢复运行中的弹窗收到成功广播后可下载结果', async () => {
  const local = storage({ running: true, runningAt: Date.now() });
  const ui = popup(local);
  await tick();
  await local.set({ running: false, lastResult: sample, lastResultAtMap: { '抖音': Date.now() } });
  ui.event({ type: 'extractDone' });
  await tick();
  assert.equal(ui.elements.csv.disabled, false);
  assert.equal(ui.elements.period.disabled, false);
  assert.match(ui.elements.result.textContent, /单篇作品: 1 条/);
});

test('旧冷却查询晚返回时不能重新启用已启动任务的按钮', async () => {
  const local = storage();
  const ui = popup(local, { sendMessage() {} }); // 提取请求保持未完成
  await tick();
  const oldRead = deferred();
  local.get = () => oldRead.promise;
  vm.runInContext('refreshBtnState()', ui.context);
  ui.elements.extract.events.click();
  oldRead.resolve({ lastResultAtMap: {} });
  await tick();
  assert.equal(ui.elements.extract.disabled, true);
  assert.equal(ui.elements.period.disabled, true);
  assert.match(ui.elements.status.textContent, /提取中/);
});

test('本弹窗发起任务时，完成广播不覆盖响应结果或留下运行状态', async () => {
  const local = storage();
  let callback;
  const ui = popup(local, { sendMessage(id, msg, done) { callback = done; } });
  await tick();
  const extraction = ui.elements.extract.events.click();
  await tick();
  await local.set({ running: false, lastResult: sample, lastResultAtMap: { '抖音': Date.now() } });
  ui.event({ type: 'extractDone' });
  callback({ ok: true, data: sample });
  await extraction;
  assert.equal(ui.elements.csv.disabled, false);
  assert.equal(ui.elements.period.disabled, false);
  assert.match(ui.elements.status.textContent, /完成 ✓/);
});

test('B 站共享后台任务锁、完成状态和平台冷却', async () => {
  const bg = background();
  const start = await bg.send({ ...begin, platform: '哔哩哔哩' });
  assert.equal(start.ok, true);
  const result = await bg.send({ type: 'endExtraction', taskId: start.taskId, data: { ...sample, platform: '哔哩哔哩' } });
  assert.equal(result.ok, true);
  assert.equal(bg.local.state.lastResult.platform, '哔哩哔哩');
  assert.ok((await bg.send({ ...begin, platform: '哔哩哔哩' })).cooldown > 0);
});

test('恢复 B 站部分成功结果时，仅启用有效产物下载', async () => {
  const local = storage({ lastResult: { ...sample, platform: '哔哩哔哩', summaryCsv: '', dataNote: '所选周期发布作品的累计数据' } });
  const ui = popup(local);
  await tick();
  assert.equal(ui.elements.platform.value, '哔哩哔哩');
  assert.equal(ui.elements.csv.disabled, true);
  assert.equal(ui.elements.postCsv.disabled, false);
  assert.equal(ui.elements.zipCover.disabled, true);
  assert.match(ui.elements.result.textContent, /累计数据/);
  assert.equal(vm.runInContext('urlMatches("https://member.bilibili.com/platform/data-up/video/", "哔哩哔哩")', ui.context), true);
  assert.equal(vm.runInContext('urlMatches("https://www.bilibili.com/", "哔哩哔哩")', ui.context), false);
});

test('空作品结果不启用明细和封面下载，有封面时恢复封面按钮', async () => {
  const local = storage({ lastResult: { ...sample, platform: '哔哩哔哩', posts: [], count: 0 } });
  const ui = popup(local);
  await tick();
  assert.equal(ui.elements.csv.disabled, false);
  assert.equal(ui.elements.postCsv.disabled, true);
  assert.equal(ui.elements.zipCover.disabled, true);
  local.state.lastResult.posts = [{ coverUrl: 'https://i0.hdslb.com/a.jpg', coverFileName: '01_BV0000000001.jpg' }];
  ui.event({ type: 'extractDone' });
  await tick();
  assert.equal(ui.elements.zipCover.disabled, false);
});
