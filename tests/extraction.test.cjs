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
function content(sendMessage = async () => {}, overrides = {}) {
  let listener;
  const context = vm.createContext({
    Date, console, AbortController, setTimeout, clearTimeout, ...overrides,
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
  assert.equal((await page.send({ type: 'extract', platform: '未接入平台' })).ok, false);
  assert.equal(bg.local.state.running, undefined);
});

test('恢复运行中的任务时锁定选择器，切换事件不能重新启用提取', async () => {
  const ui = popup(storage({ running: true, runningPlatform: '抖音', runningAt: Date.now() }));
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
  const local = storage({ running: true, runningPlatform: '抖音', runningAt: Date.now(), lastResult: sample });
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
  const local = storage({ running: true, runningPlatform: '抖音', runningAt: Date.now() });
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

test('取消的平台及其临时样本请求均被拒绝，不修改任务状态', async () => {
  const bg = background(storage({ lastResult: sample }));
  const page = content((msg) => bg.send(msg));
  for (const period of ['month', 'week', 'sample-video', 'sample-month-202609']) {
    assert.equal((await bg.send({ type: 'beginExtraction', platform: '小红书', period })).ok, false);
    assert.equal((await page.send({ type: 'extract', platform: '小红书', period })).ok, false);
  }
  assert.equal(bg.local.state.running, undefined);
  assert.deepEqual(bg.local.state.lastResult, sample);
  assert.equal(bg.events.length, 0);
});

test('取消的平台遗留任务不能阻塞新任务，晚到回包不能覆盖结果', async () => {
  const bg = background(storage({ running: true, runningPlatform: '小红书', runningPeriod: 'sample-video', runningAt: Date.now(), runningId: 'removed-task', runningTabId: 1, lastResult: sample }));
  const oldReply = { type: 'endExtraction', taskId: 'removed-task', data: { platform: '小红书', count: 99 } };
  assert.equal((await bg.send(oldReply)).ok, false);
  const started = await bg.send(begin, 2);
  assert.equal(started.ok, true);
  assert.equal((await bg.send(oldReply)).ok, false);
  assert.equal(bg.local.state.runningId, started.taskId);
  assert.deepEqual(bg.local.state.lastResult, sample);
  assert.equal((await bg.send({ type: 'endExtraction', taskId: started.taskId, data: sample }, 2)).ok, true);
});

test('升级后忽略取消平台的旧任务、结果及错误，仍可选择并提取其他平台', async () => {
  const ui = popup(storage({ running: true, runningAt: Date.now(), runningPlatform: '小红书', lastResult: { ...sample, platform: '小红书' }, lastError: { platform: '小红书', period: 'week', message: '旧错误', at: Date.now() } }));
  await tick();
  assert.equal(ui.elements.platform.value, '抖音');
  assert.equal(ui.elements.platform.disabled, false);
  assert.equal(ui.elements.extract.disabled, false);
  assert.equal(ui.elements.result.textContent, '');
  assert.equal(ui.elements.status.textContent, '');
  for (const key of ['csv', 'postCsv', 'zipCover']) assert.equal(ui.elements[key].disabled, true);
  assert.equal(vm.runInContext('urlMatches("https://creator.xiaohongshu.com/", "小红书")', ui.context), false);
});

test('取消平台的旧错误不影响恢复其他平台的成功结果', async () => {
  const ui = popup(storage({ lastResult: { ...sample, platform: '哔哩哔哩' }, lastError: { platform: '小红书', period: 'week', message: '旧错误', at: Date.now() } }));
  await tick();
  assert.equal(ui.elements.platform.value, '哔哩哔哩');
  assert.equal(ui.elements.csv.disabled, false);
  assert.equal(ui.elements.postCsv.disabled, false);
  assert.match(ui.elements.result.textContent, /哔哩哔哩/);
  assert.doesNotMatch(ui.elements.status.textContent, /旧错误/);
});


// 固定时钟与合成响应：不访问真实平台或控制浏览器。
class ReviewDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-10-28T12:00:00+08:00'])); }
  static now() { return new ReviewDate().getTime(); }
}
const channelNames = ['推荐', '分享', '主页', '朋友♡', '订阅号消息', '关注', '其他'];
const channelTotals = () => Object.fromEntries(['browse', 'like', 'fav', 'comment', 'forward'].map((key) => [key, [0, '0']]));
async function channelResult({ totalData = channelTotals(), tabs = channelNames.map((tabTypeName) => ({ tabTypeName, data: { browse: [0] } })), fans = { total: [10, 8], netAdd: [0, -2] }, posts = [] } = {}) {
  const { context } = content(undefined, { Date: ReviewDate });
  context.reply = { totalData, dataByTabtype: tabs };
  context.fans = fans;
  context.items = posts;
  vm.runInContext(`readFinderId = async () => 'test@finder';
    axhr = async url => ({errCode: 0, data: url.includes('new_post_total_data') ? reply
      : url.includes('fans_trend') ? fans : {list: items, totalCount: items.length}})`, context);
  return vm.runInContext('channelsExtract("month")', context);
}
const summaryRow = (result) => result.summaryCsv.trimEnd().split('\n')[1].split(',');

test('视频号空汇总、渠道和粉丝数组留空并提示，不制造零值', async () => {
  const result = await channelResult({ totalData: {}, tabs: [], fans: { total: [], netAdd: [] } });
  assert.deepEqual(summaryRow(result).slice(1), Array(14).fill(''));
  assert.match(result.warning, /汇总.*留空/);
  assert.match(result.warning, /来源.*留空/);
  assert.match(result.warning, /关注者.*留空/);
});

test('视频号真实零值及负数净增保持有效', async () => {
  const result = await channelResult();
  assert.deepEqual(summaryRow(result).slice(1), [...Array(12).fill('0'), '-2', '8']);
  assert.equal(result.warning, '');
});

test('视频号缺失总量不能用存在重叠的渠道分解代替', async () => {
  const result = await channelResult({ totalData: null, tabs: [
    { tabTypeName: '推荐', data: { browse: [9], like: [3] } },
    { tabTypeName: '分享', data: { browse: [7], like: [3] } },
  ] });
  const row = summaryRow(result);
  assert.equal(row[1], '');
  assert.equal(row[9], '');
  assert.equal(row[2], '9');
  assert.equal(row[3], '7');
  assert.match(result.warning, /汇总.*留空/);
});

test('视频号异常数组不截断、不部分相加、不转换成零', async () => {
  for (const bad of [undefined, null, [], 12, {}, [null], [''], ['  '], [false], ['12px'], [1.5], [-1], [Infinity], [NaN], [1, null], [Number.MAX_SAFE_INTEGER, 1]]) {
    const result = await channelResult({ totalData: { ...channelTotals(), browse: bad } });
    assert.equal(summaryRow(result)[1], '', JSON.stringify(bad));
    assert.equal(summaryRow(result)[10], '0');
    assert.match(result.warning, /播放量.*留空/);
  }
});

test('视频号来源同名累加，未知来源并入其他；含无效数据的来源独立留空', async () => {
  const result = await channelResult({ tabs: [
    { tabTypeName: '推荐', data: { browse: [2, 3] } },
    { tabTypeName: '推荐', data: { browse: ['4'] } },
    { tabTypeName: '分享', data: { browse: [5] } },
    { tabTypeName: '分享', data: { browse: [null] } },
    { tabTypeName: '新渠道', data: { browse: [7] } },
    { tabTypeName: '其他', data: { browse: [1] } },
  ] });
  const row = summaryRow(result);
  assert.equal(row[1], '0');
  assert.equal(row[2], '9');
  assert.equal(row[3], '');
  assert.equal(row[8], '8');
  assert.match(result.warning, /来源.*分享.*留空/);
});

test('视频号粉丝两列分别校验，保留仍然有效的一列', async () => {
  for (const [fans, expected] of [
    [{ total: [], netAdd: [-1, 2] }, ['1', '']],
    [{ total: [9], netAdd: [] }, ['', '9']],
    [{ total: [null], netAdd: [0] }, ['0', '']],
  ]) {
    const result = await channelResult({ fans });
    assert.deepEqual(summaryRow(result).slice(13), expected);
    assert.match(result.warning, /关注者.*留空/);
  }
});

test('视频号作品缺少时长与平均播放时长时留空，真实零值正常输出', async () => {
  const result = await channelResult({ posts: [
    { createTime: 1789444800 },
    { createTime: 1789444801, desc: { media: [{ videoPlayLen: 0 }] }, avgPlayTimeSec: 0 },
    { createTime: 1789444802, desc: { media: [{ videoPlayLen: 'bad' }] }, avgPlayTimeSec: 'bad' },
  ] });
  assert.equal(result.posts[0].durationSec, '');
  assert.equal(result.posts[0].avgPlay, '');
  assert.equal(result.posts[1].durationSec, 0);
  assert.equal(result.posts[1].avgPlay, '0.00');
  assert.equal(result.posts[2].durationSec, '');
  assert.equal(result.posts[2].avgPlay, '');
  assert.match(result.warning, /时长.*留空/);
});

test('共享请求超时覆盖 JSON 响应体读取，超时后重试并清理计时器', async () => {
  const timers = new Map();
  let sequence = 0, attempts = 0, aborted = false;
  const { context } = content(undefined, {
    setTimeout(fn, ms) {
      if (ms !== 20000) return setTimeout(fn, 0);
      const id = ++sequence; timers.set(id, fn); return id;
    },
    clearTimeout(id) { if (!timers.delete(id)) clearTimeout(id); },
    async fetch(url, { signal }) {
      attempts++;
      return { ok: true, json: attempts === 1
        ? () => new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted body')); }, { once: true }))
        : async () => ({ value: 7 }) };
    },
  });
  const request = vm.runInContext('axhr("https://example.test")', context);
  await tick();
  assert.equal(timers.size, 1, '收到响应头后仍须保留响应体的超时保护');
  [...timers.values()][0]();
  assert.equal((await request).value, 7);
  assert.equal(aborted, true);
  assert.equal(attempts, 2);
  assert.equal(timers.size, 0);
});

test('共享请求的 JSON 解析失败最多尝试三次，失败后清理计时器', async () => {
  let attempts = 0;
  const timers = new Set();
  const { context } = content(undefined, {
    setTimeout(fn, ms) { const id = setTimeout(fn, ms === 900 ? 0 : ms); if (ms === 20000) timers.add(id); return id; },
    clearTimeout(id) { timers.delete(id); clearTimeout(id); },
    async fetch() { attempts++; return { ok: true, async json() { throw new Error('bad json'); } }; },
  });
  await assert.rejects(vm.runInContext('axhr("https://example.test")', context), /请求失败/);
  assert.equal(attempts, 3);
  assert.equal(timers.size, 0);
});

test('共享请求 HTTP 错误不重试、不读取响应体且清理计时器', async () => {
  let attempts = 0, reads = 0, cleared = 0;
  const { context } = content(undefined, {
    setTimeout: () => 1, clearTimeout: () => { cleared++; },
    async fetch() { attempts++; return { ok: false, status: 403, async json() { reads++; } }; },
  });
  await assert.rejects(vm.runInContext('axhr("https://example.test")', context), /HTTP 403/);
  assert.equal(attempts, 1);
  assert.equal(reads, 0);
  assert.equal(cleared, 1);
});

const douyinItem = (id, count = 7) => ({ id, description: '作品' + id, create_time: new Date('2026-09-15T12:00:00+08:00').getTime() / 1000, metrics: { view_count: count } });
async function douyinPages(pages) {
  const calls = [];
  const { context } = content(undefined, { Date: ReviewDate, setTimeout: (fn, ms) => setTimeout(fn, ms === 600 ? 0 : ms) });
  context.axhr = async (url) => {
    calls.push(url);
    if (url.includes('work_list')) {
      const index = Number(new URL(url).searchParams.get('max_cursor'));
      return { status_code: 0, ...pages[index], has_more: index < pages.length - 1, max_cursor: index + 1 };
    }
    return { status_code: 0, metrics: [{ english_metric_name: 'play_cnt', metric_value: 1 }] };
  };
  return { result: await vm.runInContext('douyinExtract("month", 4)', context), calls };
}

test('抖音跨页重复作品只导出及补充查询一次，保留首次取得的指标', async () => {
  const { result, calls } = await douyinPages([
    { items: [douyinItem('1')] },
    { items: [douyinItem('1', 999), douyinItem('2')] },
  ]);
  assert.equal(result.count, 2);
  assert.deepEqual(Array.from(result.posts, (p) => p.plays), [7, 7]);
  assert.equal(result.postCsv.trimEnd().split('\n').length, 3);
  assert.equal(calls.filter((url) => url.includes('/item/play/source')).length, 2);
  assert.equal(calls.filter((url) => url.includes('/item_analysis/search/keyword')).length, 2);
  assert.match(result.warning, /去重 1 条重复作品/);
});

test('抖音同页数字和字符串 ID 视为同一作品，时长按 ID 关联', async () => {
  const { result } = await douyinPages([{ items: [douyinItem(1), douyinItem('1'), douyinItem('2')], aweme_list: [{ item_id: '2', duration: 22000 }, { item_id: '1', duration: 11000 }] }]);
  assert.equal(result.count, 2);
  assert.deepEqual(Array.from(result.posts, (p) => p.duration), [11, 22]);
  assert.match(result.warning, /去重 1 条重复作品/);
});

test('抖音后续页补齐先前只有时长的作品，按 ID 合并为一条', async () => {
  const { result } = await douyinPages([
    { items: [douyinItem('1')], aweme_list: [{ item_id: '2', duration: 22000 }] },
    { items: [douyinItem('2')], aweme_list: [{ item_id: '1', duration: 11000 }] },
  ]);
  assert.equal(result.count, 2);
  assert.deepEqual(Array.from(result.posts, (p) => p.duration), [11, 22]);
  assert.equal(result.warning, '');
});

test('封面下载期间收到另一平台周期结果，ZIP 名称和内容仍属启动时的批次', async () => {
  const old = { ...sample, platform: '哔哩哔哩', coverFolder: '2026年09月_月度作品封面', posts: [{ coverUrl: 'https://i0.hdslb.com/A.png', coverFileName: 'A.png' }] };
  const local = storage({ lastResult: old });
  const ui = popup(local);
  await tick();
  const pending = deferred(), saved = [], fetched = [];
  ui.context.fetch = async (url) => { fetched.push(url); await pending.promise; return { ok: true, arrayBuffer: async () => Uint8Array.from([7, 8]).buffer }; };
  ui.context.saveBlob = async (name, blob) => { saved.push({ name, blob }); return true; };
  const download = ui.elements.zipCover.events.click();
  await tick();
  await local.set({ lastResult: { ...sample, period: '2026年43周', scopeLabel: '周度', coverFolder: '2026年43周_周度作品封面', posts: [{ coverUrl: 'https://example.test/B.jpg', coverFileName: 'B.jpg' }] } });
  ui.event({ type: 'extractDone' });
  await tick();
  assert.equal(ui.elements.platform.value, '抖音');
  pending.resolve();
  await download;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, '哔哩哔哩_2026年09月_月度作品封面.zip');
  assert.deepEqual(fetched, [old.posts[0].coverUrl]);
  const zip = Buffer.from(await saved[0].blob.arrayBuffer());
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const nameLength = zip.readUInt16LE(26), extraLength = zip.readUInt16LE(28);
  assert.equal(zip.subarray(30, 30 + nameLength).toString(), 'A.png');
  const offset = 30 + nameLength + extraLength;
  assert.deepEqual([...zip.subarray(offset, offset + zip.readUInt32LE(18))], [7, 8]);
});


test('抖音缺少 ID 的作品明确跳过，不发出无法关联的补充请求', async () => {
  const { result, calls } = await douyinPages([{ items: [douyinItem(undefined), douyinItem(''), null, douyinItem('1')] }]);
  assert.equal(result.count, 1);
  assert.equal(result.posts[0].title, '作品1');
  assert.match(result.warning, /3 条作品缺少有效 ID，已跳过/);
  const details = calls.filter((url) => url.includes('/item/') || url.includes('/item_analysis/'));
  assert.equal(details.length, 2);
  for (const url of details) {
    const params = new URL(url).searchParams;
    assert.equal(params.get('item_id') || params.get('id'), '1');
  }
});
