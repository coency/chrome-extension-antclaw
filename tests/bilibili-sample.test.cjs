// 离线样本采集与按钮流程验证，不使用真实账号。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function sampler(begin = { ok: true, taskId: 'sample-task' }) {
  const calls = [], messages = [];
  let listener;
  const bvid = 'BV0000000002';
  const context = vm.createContext({
    location: { origin: 'https://member.bilibili.com' }, console, AbortController, URLSearchParams, Date,
    setTimeout(fn, ms) { if (ms === 600) queueMicrotask(fn); return 1; }, clearTimeout() {},
    chrome: { runtime: {
      onMessage: { addListener(fn) { listener = fn; } },
      async sendMessage(message) { messages.push(message); return message.type === 'beginExtraction' ? begin : { ok: true, data: message.data }; },
    } },
    async fetch(raw, options) {
      const url = new URL(raw); calls.push(url);
      assert.equal(url.origin, 'https://member.bilibili.com');
      assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'include');
      let data = {};
      if (url.pathname.endsWith('/archive/index')) data = { pager: { pn: 1, total: 2 }, list: [
        { bvid: 'BV0000000001', pubtime: Date.parse('2026-09-19T12:00:00+08:00') / 1000 },
        { bvid, title: '测试作品', pubtime: Date.parse('2026-09-29T12:00:00+08:00') / 1000, stat: { play: 0 } },
      ] };
      else if (url.pathname.endsWith('/archive_diagnose/compare')) data = { list: [{ bvid, stat: { play: 0 } }] };
      else if (url.pathname.endsWith('/v3/archive/view')) data = { bvid, videos: [{ cid: 1002 }] };
      else if (url.pathname.endsWith('/v2/archive/analyze/graph')) data = { cid: 1002, quit_info: { avg_play_progress: 0 } };
      return { ok: true, json: async () => ({ code: 0, data }) };
    },
  });
  vm.runInContext(read('bilibili-sample.js'), context);
  return { calls, messages, send: () => new Promise((resolve) => listener({ type: 'collectBiliSample' }, {}, resolve)) };
}

test('样本加载不自动请求，按钮消息触发后只采集目标日作品并保留缺失状态', async () => {
  const app = sampler();
  assert.equal(app.calls.length, 0);
  const result = await app.send();
  assert.equal(result.ok, true);
  assert.equal(result.data.works.length, 1);
  const work = result.data.works[0];
  assert.equal(work.bvid, 'BV0000000002');
  assert.equal(work.listStat.play.raw, 0);
  assert.equal(work.playAnalysis.data.guest_interact.tm_rate.present, false);
  assert.equal(app.calls.length, 6);
  assert.ok(app.calls.every((url) => !url.href.includes('BV0000000001')));
  assert.equal(app.messages[1].taskId, 'sample-task');
});

test('样本采集被任务锁拒绝时不访问 B 站接口', async () => {
  const app = sampler({ ok: false, busy: true, error: '已有提取任务' });
  const result = await app.send();
  assert.equal(result.busy, true);
  assert.equal(app.calls.length, 0);
  assert.equal(app.messages.length, 1);
});

test('样本同页面重复点击不会启动第二个任务', async () => {
  const app = sampler();
  const first = app.send();
  const second = await app.send();
  assert.equal(second.ok, false);
  assert.match(second.error, /正在运行/);
  await first;
  assert.equal(app.messages.filter((m) => m.type === 'beginExtraction').length, 1);
});

test('弹窗样本按钮从当前 B 站标签页打开独立采集页面', async () => {
  let click, opened;
  const context = vm.createContext({
    document: { getElementById() { return { addEventListener(event, fn) { click = fn; } }; } },
    activeTab: async () => ({ id: 42, url: 'https://member.bilibili.com/platform/' }),
    urlMatches: () => true, setStatus() {},
    chrome: { runtime: { getURL: (file) => 'chrome-extension://test/' + file }, tabs: { async create(options) { opened = options; } } },
  });
  vm.runInContext(read('popup-sample.js'), context);
  await click();
  assert.equal(opened.url, 'chrome-extension://test/bilibili-sample.html?tabId=42&start=1');
});

test('独立样本页面采集后使用扩展下载，不依赖控制台或页面弹出窗口', async () => {
  const elements = Object.fromEntries(['status', 'result', 'collect', 'download'].map((key) => [key, { addEventListener() {} }]));
  const report = { collectedAt: '2026-10-28T12:00:00Z', works: [{ title: '<script>不会执行</script>', bvid: 'BV0000000002', publish: '2026-09-29 12:00:00' }], warnings: [] };
  let downloaded;
  const context = vm.createContext({
    URL, URLSearchParams, Blob, location: { search: '?tabId=42&start=1' }, setTimeout() {},
    document: { getElementById: (id) => elements[id] },
    chrome: {
      storage: { local: { get: async () => ({}) } },
      tabs: { get: async () => ({ url: 'https://member.bilibili.com/platform/' }), sendMessage: async (id, message) => {
        assert.equal(id, 42); assert.equal(message.type, 'collectBiliSample'); return { ok: true, data: report };
      } },
      downloads: { download: async (options) => { downloaded = options; return 1; } },
    },
  });
  vm.runInContext(read('bilibili-sample-page.js'), context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(downloaded.filename, '哔哩哔哩_2026-09-29_分析样本.json');
  assert.equal(downloaded.saveAs, true);
  assert.match(elements.result.textContent, /不会执行/);
  assert.equal(elements.download.disabled, false);
  assert.match(elements.status.textContent, /已发起下载/);
  URL.revokeObjectURL(downloaded.url);
});
