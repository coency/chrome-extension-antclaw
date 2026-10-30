// 合成接口响应；不包含真实账号数据，也不代表已完成登录账号联调。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const NOW = Date.parse('2026-10-28T04:00:00Z');
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}
const seconds = (date) => Date.parse(date) / 1000;
const keys = ['play', 'like', 'fav', 'coin', 'comment', 'dm', 'share', 'fan'];
const trends = () => Object.fromEntries(keys.map((key) => [key, Array.from({ length: 30 }, (_, i) => ({
  date_key: seconds(`2026-09-${String(i + 1).padStart(2, '0')}T00:00:00+08:00`),
  total_inc: key === 'fan' ? -1 : i + 1, sub_total_inc: 999,
}))]));
const item = (number, changes = {}) => ({
  aid: number, bvid: 'BV' + String(number).padStart(10, '0'), title: '作品' + number,
  pubtime: seconds('2026-09-15T12:00:00+08:00'), ctime: seconds('2026-08-01T00:00:00+08:00'),
  duration: 61, videos: [{ cid: number + 1000 }], cover: '//i0.hdslb.com/bfs/archive/cover.png',
  stat: { play: 24, likes: 2, fans: 0 }, real_stat: { play: 999, likes: 888, fans: 777 }, ...changes,
});
const daily = (value) => trends().play.map((p) => ({ date_key: p.date_key, total_inc: value }));
const compareStat = (changes = {}) => ({
  play: 100, like: 10, comment: 3, dm: 7, fav: 4, coin: 5, share: 6,
  unfollow: 1, vt: 50, avg_play_time: 12.345, full_play_ratio: 6005,
  play_viewer_rate: 8000, active_fans_rate: 500, crash_rate: 1200, crash_fan_rate: 900, crash_viewer_rate: 1500,
  interact_rate: 3500, interact_fan_rate: 4500, interact_viewer_rate: 3000, play_trans_fan_rate: 50,
  tm_pass_rate: 7000, tm_fan_pass_rate: 8000, tm_viewer_pass_rate: 6000,
  tm_star: 35, tm_fan_star: 40, tm_viewer_star: 30, ...changes,
});
const unavailableExtras = { extraGraphResponse: () => ({ code: 0, data: {} }) };
function setup({ graph = { code: 0, data: { data_tendency: trends() } }, pages = [[item(1)]], pageResponse, detailResponse, extraGraphResponse, compareResponse, progressResponse, archiveViewResponse, sendMessage } = {}) {
  const calls = [];
  let listener;
  const context = vm.createContext({
    Date: FixedDate, console, URL, URLSearchParams, AbortController,
    setTimeout: (fn, ms) => setTimeout(fn, ms === 600 ? 0 : ms), clearTimeout,
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } }, sendMessage } },
    async fetch(url, options) {
      calls.push({ url, options });
      const parsed = new URL(url);
      let payload;
      if (parsed.pathname.endsWith('/overview/stat/graph')) {
        const type = parsed.searchParams.get('type');
        payload = type.includes(',') ? graph : extraGraphResponse ? await extraGraphResponse(type)
          : { code: 0, data: { data_tendency: { [type]: daily(2) } } };
      }
      else if (parsed.pathname.endsWith('/v2/archive/analyze/graph')) {
        const cid = Number(parsed.searchParams.get('cid'));
        payload = progressResponse ? await progressResponse(cid) : { code: 0, data: { cid, quit_info: { avg_play_progress: 41.175, full_play_ratio: 6750 } } };
      } else if (parsed.pathname.endsWith('/v3/archive/view')) {
        const bvid = parsed.searchParams.get('bvid');
        payload = archiveViewResponse ? await archiveViewResponse(bvid) : { code: 0, data: { bvid, videos: [{ cid: Number(bvid.slice(2)) + 1000 }] } };
      } else if (parsed.pathname.endsWith('/archive_diagnose/compare')) {
        const ids = parsed.searchParams.get('compare_bvids').split(',');
        payload = compareResponse ? await compareResponse(ids)
          : { code: 0, data: { list: ids.map((bvid) => ({ bvid, stat: compareStat() })) } };
      }
      else if (parsed.pathname.endsWith('/archive/index')) {
        const page = Number(parsed.searchParams.get('pn'));
        payload = pageResponse ? pageResponse(page) : { code: 0, data: { list: pages[page - 1] || [], pager: { pn: page, ps: 20, total: pages.flat().length } } };
      } else if (parsed.pathname.endsWith('/archive_diagnose/overview')) {
        const bvid = parsed.searchParams.get('bvid');
        payload = detailResponse ? await detailResponse(bvid) : { code: 0, data: { bvid, stat: { comment: 3, fav: 4, coin: 5, share: 6, dm: 7 } } };
      } else throw new Error('Unexpected endpoint: ' + url);
      return { ok: true, json: async () => structuredClone(payload) };
    },
  });
  for (const file of ['bilibili.js', 'content.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  return {
    context, calls,
    extract: (period = 'month') => vm.runInContext(`bilibiliExtract(${JSON.stringify(period)})`, context),
    send: (message) => new Promise((resolve) => listener(message, {}, resolve)),
  };
}

test('B 站月度导出使用 stat 累计值，汇总只累加 total_inc', async () => {
  const app = setup();
  const result = await app.extract();
  assert.equal(result.platform, '哔哩哔哩');
  assert.equal(result.count, 1);
  assert.equal(result.warning, '');
  assert.equal(result.posts[0].plays, 24);
  assert.equal(result.posts[0].likes, 2);
  assert.equal(result.posts[0].fans, 0);
  assert.equal(result.posts[0].duration, 61);
  assert.match(result.summaryCsv, /465,465,465,465,465,465,465,-30/);
  assert.match(result.dataNote, /累计值/);
  assert.equal(result.posts[0].coverFileName, '01_BV0000000001.png');
  assert.equal(result.posts[0].coverUrl, 'https://i0.hdslb.com/bfs/archive/cover.png');
  assert.equal(app.calls.length, 6);
  assert.ok(app.calls.every((call) => !call.url.includes('/fans/stat/export') && new URL(call.url).searchParams.get('type') !== 'vt'));
  assert.ok(app.calls.every((call) => call.options.credentials === 'include'));
  const params = new URL(app.calls[0].url).searchParams;
  assert.equal(params.get('period'), '2');
  assert.equal(params.get('type'), keys.join(','));
});

test('作品以北京时间 pubtime 筛选，包含月初和月末最后一秒', async () => {
  const app = setup({ pages: [[
    item(1, { pubtime: seconds('2026-08-31T15:59:59Z') }),
    item(2, { pubtime: seconds('2026-08-31T16:00:00Z') }),
    item(3, { pubtime: seconds('2026-09-30T15:59:59Z') }),
    item(4, { pubtime: seconds('2026-09-30T16:00:00Z'), ctime: seconds('2026-09-01T00:00:00+08:00') }),
  ]] });
  const result = await app.extract();
  assert.deepEqual(Array.from(result.posts, (post) => post.aid), [3, 2]);
  assert.equal(result.posts[0].publish, '2026-09-30 23:59:59');
});

test('北京时间日期计算跨年、闰月、跨 ISO 周年正确', () => {
  const { context } = setup();
  const calculate = (period, now) => JSON.parse(vm.runInContext(`JSON.stringify(biliPeriod('${period}', new Date('${now}')))`, context));
  assert.equal(calculate('month', '2026-01-01T00:00:00Z').startD, '20251201');
  assert.equal(calculate('month', '2024-03-01T00:00:00Z').endD, '20240229');
  assert.equal(calculate('week', '2026-01-05T00:00:00Z').label, '2026年1周');
  const week = calculate('week', '2026-10-25T16:00:00Z'); // 北京周一，美国仍是周日
  assert.equal(week.startD, '20261019');
  assert.equal(week.endD, '20261025');
  assert.equal(week.days.length, 7);
});

test('B 站周期不受运行机器时区影响', () => {
  const script = `const fs=require('fs'),vm=require('vm');vm.runInThisContext(fs.readFileSync('bilibili.js','utf8'));console.log(JSON.stringify(biliPeriod('week',new Date('2026-10-25T16:00:00Z'))));`;
  const output = (tz) => execFileSync(process.execPath, ['-e', script], { cwd: root, env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  assert.equal(output('America/Los_Angeles'), output('Asia/Shanghai'));
});

test('上一自然周导出完整七天，并筛选该周发布作品', async () => {
  const series = Array.from({ length: 7 }, (_, i) => ({ date_key: seconds(`2026-10-${19 + i}T00:00:00+08:00`), total_inc: 2 }));
  const result = await setup({ graph: { code: 0, data: { data_tendency: Object.fromEntries(keys.map((key) => [key, series])) } }, pages: [[
    item(1, { pubtime: seconds('2026-10-19T00:00:00+08:00') }),
    item(2, { pubtime: seconds('2026-10-25T23:59:59+08:00') }),
    item(3, { pubtime: seconds('2026-10-26T00:00:00+08:00') }),
  ]] }).extract('week');
  assert.equal(result.scopeLabel, '周度');
  assert.equal(result.count, 2);
  assert.match(result.summaryCsv, /14,14,14,14,14,14,14,14/);
});

test('多页列表去重，旧作品页不导致提前停止', async () => {
  const app = setup({ pageResponse: (pn) => ({ code: 0, data: {
    list: pn === 1 ? [item(1, { pubtime: seconds('2026-01-01T00:00:00+08:00') })]
      : pn === 2 ? [item(1), item(2)] : [item(3)], pager: { pn, ps: 20, total: 3 },
  } }) });
  const result = await app.extract();
  assert.equal(result.count, 2);
  assert.match(result.warning, /去重 1 条/);
  assert.equal(app.calls.filter((call) => new URL(call.url).pathname.endsWith('/archive/index')).length, 3);
});

test('分页重复且不推进时停止，并明确提示可能不完整', async () => {
  const app = setup({ pageResponse: (pn) => ({ code: 0, data: { list: [item(1)], pager: { pn, ps: 20, total: 10 } } }) });
  const result = await app.extract();
  assert.equal(result.count, 1);
  assert.match(result.warning, /分页未取得新数据/);
  assert.equal(app.calls.filter((call) => new URL(call.url).pathname.endsWith('/archive/index')).length, 2);
});

test('列表有总数但提前返回空页时告知截断', async () => {
  const result = await setup({ pageResponse: (pn) => ({ code: 0, data: { list: [], pager: { pn, total: 10 } } }) }).extract();
  assert.match(result.warning, /列表可能不完整/);
});

test('列表达到 200 页后停止，保留已采集作品并提示上限', async () => {
  const app = setup({ pageResponse: (pn) => ({ code: 0, data: { list: [item(pn)], pager: { pn, ps: 20, total: 1000 } } }) });
  const result = await app.extract();
  assert.equal(result.count, 200);
  assert.match(result.warning, /200 页上限/);
  assert.equal(app.calls.filter((call) => new URL(call.url).pathname.endsWith('/archive/index')).length, 200);
});

test('后续分页失败仍保留前页作品', async () => {
  const app = setup({ pageResponse: (pn) => pn === 1 ? { code: 0, data: { list: [item(1)], pager: { pn, total: 2 } } } : { code: -400, message: 'bad request' } });
  const result = await app.extract();
  assert.equal(result.count, 1);
  assert.match(result.postCsv, /BV0000000001/);
  assert.match(result.warning, /列表可能不完整.*-400/);
});

for (const [name, mutate, expected] of [
  ['缺日', (series) => series.pop(), /缺少 1 天/],
  ['重复日期', (series) => series.push(series[0]), /重复日期/],
  ['非法数值', (series) => { series[0].total_inc = null; }, /无效指标值/],
]) {
  test('汇总' + name + '时该列留空，其他列及作品仍可导出', async () => {
    const data = trends(); mutate(data.play);
    const result = await setup({ graph: { code: 0, data: { data_tendency: data } } }).extract();
    assert.match(result.warning, expected);
    assert.equal(result.summaryCsv.trim().split('\n')[1].split(',')[3], '');
    assert.equal(result.count, 1);
  });
}

test('汇总没有可用日期时不制造零值或空汇总下载，保留作品', async () => {
  const result = await setup({ ...unavailableExtras, graph: { code: 0, data: { data_tendency: {} } } }).extract();
  assert.equal(result.summaryCsv, '');
  assert.equal(result.count, 1);
  assert.match(result.warning, /汇总数据不可用/);
});

test('真实的零播放与负净增可正常导出', async () => {
  const data = trends(); data.play.forEach((point) => { point.total_inc = '0'; });
  const result = await setup({ graph: { code: 0, data: { data_tendency: data } } }).extract();
  assert.equal(result.warning, '');
  assert.equal(result.summaryCsv.trim().split('\n')[1].split(',')[3], '0');
  assert.equal(result.summaryCsv.trim().split('\n')[1].split(',')[10], '-30');
});

test('缺失 stat 字段不会用 real_stat 或零补齐', async () => {
  const result = await setup({ pages: [[item(1, { stat: { play: 0 } })]] }).extract();
  assert.equal(result.posts[0].plays, 0);
  assert.equal(result.posts[0].likes, '');
  assert.equal(result.posts[0].fans, '');
  assert.match(result.warning, /单元格留空/);
});

test('无发布时间的作品不会用创建时间替代', async () => {
  const result = await setup({ pages: [[item(1, { pubtime: null, ctime: seconds('2026-09-10T00:00:00+08:00') })]] }).extract();
  assert.equal(result.count, 0);
  assert.match(result.warning, /发布时间/);
});

test('不支持的封面域名不会进入下载目标，HTTP 官方封面转为 HTTPS', async () => {
  const result = await setup({ pages: [[item(1, { cover: 'https://example.org/image.jpg' }), item(2, { cover: 'http://i2.hdslb.com/a.webp@320w' })]] }).extract();
  assert.equal(result.posts[0].coverUrl, '');
  assert.equal(result.posts[0].coverFileName, '');
  assert.equal(result.posts[1].coverUrl, 'https://i2.hdslb.com/a.webp@320w');
  assert.equal(result.posts[1].coverFileName, '02_BV0000000002.webp');
  assert.match(result.warning, /封面域名暂不支持/);
});

test('B 站标题导出复用 CSV 转义和公式防护', async () => {
  const result = await setup({ pages: [[item(1, { title: '=HYPERLINK("x","y")' })]] }).extract();
  assert.match(result.postCsv, /"'=HYPERLINK\(""x"",""y""\)"/);
});

test('登录失效立即停止，不继续请求列表', async () => {
  const app = setup({ graph: { code: -101, message: 'not logged in' } });
  await assert.rejects(app.extract(), /登录已失效/);
  assert.equal(app.calls.length, 1);
});

test('汇总与列表均失败时整个任务失败，不伪装成零作品成功', async () => {
  await assert.rejects(setup({ ...unavailableExtras, graph: { code: -400 }, pageResponse: () => ({ code: 0, data: { list: {} } }) }).extract(), /汇总获取失败.*作品列表格式异常/);
});

test('汇总成功但分页格式变化时保留汇总，禁用无效作品结果', async () => {
  const result = await setup({ pageResponse: () => ({ code: 0, data: { list: [item(1)] } }) }).extract();
  assert.ok(result.summaryCsv);
  assert.equal(result.postCsv, '');
  assert.match(result.warning, /分页信息异常/);
});

test('作品总数与当前页矛盾时不将列表标记为成功', async () => {
  const result = await setup({ pageResponse: () => ({ code: 0, data: { list: [item(1)], pager: { pn: 1, total: 0 } } }) }).extract();
  assert.equal(result.postCsv, '');
  assert.match(result.warning, /分页信息异常/);
});

test('空账号的完整零趋势和零作品可正常完成', async () => {
  const data = trends(); Object.values(data).forEach((series) => series.forEach((point) => { point.total_inc = 0; }));
  const result = await setup({ graph: { code: 0, data: { data_tendency: data } }, pages: [[]] }).extract();
  assert.equal(result.count, 0);
  assert.equal(result.warning, '');
  assert.ok(result.summaryCsv);
});

test('真实消息分发可路由到 B 站适配器并提交完成结果', async () => {
  const messages = [];
  const app = setup({ sendMessage: async (msg) => {
    messages.push(msg);
    return msg.type === 'beginExtraction' ? { ok: true, taskId: 'bili-task' } : { ok: true, data: msg.data };
  } });
  const result = await app.send({ type: 'extract', platform: '哔哩哔哩', period: 'month' });
  assert.equal(result.ok, true);
  assert.equal(result.data.platform, '哔哩哔哩');
  assert.equal(messages[1].taskId, 'bili-task');
  assert.equal(messages[1].data.count, 1);
});

test('清单从 B 站顶层页面注入适配器，所有引用文件存在且封面权限齐全', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const script = manifest.content_scripts.find((entry) => entry.matches.includes('https://member.bilibili.com/*'));
  assert.deepEqual(script.js, ['bilibili.js', 'content.js']);
  assert.ok(!script.all_frames);
  for (const file of [...manifest.content_scripts.flatMap((entry) => entry.js), manifest.action.default_popup, manifest.background.service_worker, ...Object.values(manifest.icons)]) {
    assert.ok(fs.existsSync(path.join(root, file)), file);
  }
  for (const host of ['member.bilibili.com', 'i0.hdslb.com', 'i1.hdslb.com', 'i2.hdslb.com']) assert.ok(manifest.host_permissions.includes('https://' + host + '/*'));
  const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
  assert.match(html, /<option value="哔哩哔哩">/);
  assert.doesNotMatch(html, /小红书|xiaohongshu|xhs/i);
  assert.ok(!manifest.host_permissions.some((host) => /xiaohongshu|xhscdn/.test(host)));
  assert.ok(!manifest.content_scripts.some((entry) => entry.matches.some((host) => /xiaohongshu/.test(host))));
});

test('作品 CSV 新增五项累计互动，字段与数值对应且不改变原有统计', async () => {
  const app = setup();
  const result = await app.extract();
  const [header, row] = result.postCsv.trim().split('\n').map((line) => line.split(','));
  assert.deepEqual(header.slice(0, 12), ['作品标题', '发布日期（北京时间）', '封面', '作品时长（秒）', '播放量', '点赞量', '涨粉量', '评论量', '收藏量', '投币量', '分享量', '弹幕量']);
  const summaryHeader = result.summaryCsv.trim().split('\n')[0].split(',');
  assert.deepEqual(summaryHeader, ['周期', '开始日期', '结束日期', '播放量', '点赞量', '收藏量', '投币量', '评论量', '弹幕量', '分享量', '粉丝净增', '空间访客（逐日人数合计）']);
  assert.equal(result.summaryCsv.trim().split('\n')[1].split(',').length, summaryHeader.length);
  assert.deepEqual(header.slice(7, 12), ['评论量', '收藏量', '投币量', '分享量', '弹幕量']);
  assert.deepEqual(row.slice(7, 12), ['3', '4', '5', '6', '7']);
  assert.equal(header.length, row.length);
  assert.equal(result.posts[0].plays, 24);
  assert.equal(result.posts[0].likes, 2);
  assert.equal(result.posts[0].fans, 0);
  const detail = new URL(app.calls.find((call) => call.url.includes('/archive_diagnose/overview')).url);
  assert.equal(detail.searchParams.get('bvid'), 'BV0000000001');
});

test('仅查询所选周期内去重后的 BV 号，响应正确关联作品', async () => {
  const app = setup({
    pages: [[item(1), item(2), item(1), item(3, { pubtime: seconds('2026-08-01T12:00:00+08:00') })]],
    detailResponse: async (bvid) => {
      if (bvid.endsWith('1')) await new Promise((resolve) => setTimeout(resolve, 10));
      return { code: 0, data: { bvid, stat: { comment: Number(bvid.slice(2)), fav: 0, coin: 0, share: 0, dm: 0 } } };
    },
  });
  const result = await app.extract();
  const details = app.calls.filter((call) => call.url.includes('/archive_diagnose/overview'));
  assert.equal(details.length, 2);
  assert.deepEqual(Array.from(result.posts, (post) => [post.aid, post.comments]), [[1, 1], [2, 2]]);
});

test('单篇概览失败保留基础数据和其他作品补充明细', async () => {
  const result = await setup({ pages: [[item(1), item(2)]], detailResponse: (bvid) => bvid.endsWith('1')
    ? { code: -400, message: 'detail unavailable' }
    : { code: 0, data: { stat: { comment: 9, fav: 8, coin: 7, share: 6, dm: 5 } } },
  }).extract();
  assert.equal(result.count, 2);
  assert.equal(result.posts[0].plays, 24);
  assert.equal(result.posts[0].comments, '');
  assert.equal(result.posts[1].comments, 9);
  assert.match(result.warning, /补充明细有 1 篇获取失败.*-400/);
  assert.ok(result.summaryCsv);
  assert.ok(result.postCsv);
});

test('新增互动的真实零值保留，缺失与无效值留空，不使用实时字段', async () => {
  const result = await setup({ detailResponse: () => ({ code: 0, data: {
    stat: { comment: 0, fav: '0', coin: null, share: -1, dm: false },
    real_stat: { coin: 100, share: 100, dm: 100 },
  } }) }).extract();
  assert.deepEqual(Array.from([result.posts[0].comments, result.posts[0].favorites, result.posts[0].coins, result.posts[0].shares, result.posts[0].danmaku]), [0, 0, '', '', '']);
  assert.match(result.warning, /累计投币字段缺失/);
  assert.match(result.warning, /累计分享字段缺失/);
  assert.match(result.warning, /累计弹幕字段缺失/);
});

test('补充明细登录失效后停止新请求，同时保留已提取作品', async () => {
  const app = setup({ pages: [[item(1), item(2), item(3), item(4), item(5)]], detailResponse: () => ({ code: -101, message: 'not logged in' }) });
  const result = await app.extract();
  assert.equal(result.count, 5);
  assert.ok(result.posts.every((post) => post.comments === '' && post.plays === 24));
  assert.match(result.warning, /登录失效，已停止后续请求/);
  assert.ok(app.calls.filter((call) => call.url.includes('/archive_diagnose/overview')).length <= 2);
});

test('缺少 BV 号时保留 AV 作品，不发出无标识的补充请求', async () => {
  const app = setup({ pages: [[item(1, { bvid: '' })]] });
  const result = await app.extract();
  assert.equal(result.count, 1);
  assert.equal(result.posts[0].comments, '');
  assert.equal(app.calls.filter((call) => call.url.includes('/archive_diagnose/overview')).length, 0);
  assert.match(result.warning, /缺少 BV 号/);
});

test('补充接口最多两并发，并拒绝关联错误的 BV 号', async () => {
  let active = 0, maximum = 0;
  const app = setup({ pages: [[item(1), item(2), item(3), item(4)]], detailResponse: async () => {
    active++; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
    return { code: 0, data: { bvid: 'BV9999999999', stat: { comment: 99 } } };
  } });
  const result = await app.extract();
  assert.equal(maximum, 2);
  assert.ok(result.posts.every((post) => post.comments === ''));
  assert.match(result.warning, /BV 号与请求不一致/);
});

test('平均播放进度字段不会被误导出为完播率', async () => {
  const result = await setup({ detailResponse: () => ({ code: 0, data: { stat: { comment: 1, fav: 2, coin: 3, share: 4, dm: 5, full_play_ratio: 9999 } } }) }).extract();
  assert.equal(result.postCsv.includes('完播率'), false);
  assert.equal(result.postCsv.includes('60.05%'), false);
  assert.equal(result.posts[0].avgPlayProgress, '0分41秒');
  assert.equal(result.posts[0].playProgressRatio, '67.5%');
  assert.equal(result.posts[0].comments, 1);
});

test('扩展汇总只保留逐日访客合计，不把净增当粉丝存量', async () => {
  const result = await setup().extract();
  const [header, row] = result.summaryCsv.trim().split('\n').map((line) => line.split(','));
  assert.equal(header.length, 12);
  assert.deepEqual(row.slice(11), ['60']);
  assert.equal(header.some((s) => /总粉丝|完播率|统计口径|提取时间/.test(s)), false);
  assert.match(header[11], /逐日人数合计/);
  assert.match(result.dataNote, /未跨日去重/);
});

test('访客缺日、数值异常或接口失败时留空，不影响原有指标', async () => {
  const missing = daily(2); missing.pop();
  const invalid = daily(2); invalid[0].total_inc = -1;
  for (const [payload, message] of [
    [{ code: 0, data: { tendency: missing } }, /缺少 1 天/],
    [{ code: 0, data: { tendency: invalid } }, /无效指标值/],
    [{ code: -400, message: 'unsupported' }, /unsupported/],
  ]) {
    const result = await setup({ extraGraphResponse: () => payload }).extract();
    const row = result.summaryCsv.trim().split('\n')[1].split(',');
    assert.equal(row[3], '465');
    assert.deepEqual(row.slice(11), ['']);
    assert.match(result.warning, message);
  }
});

test('基础汇总失败时仍可导出独立取得的访客数据', async () => {
  const result = await setup({ graph: { code: -400 } }).extract();
  const row = result.summaryCsv.trim().split('\n')[1].split(',');
  assert.deepEqual(row.slice(3, 11), Array(8).fill(''));
  assert.deepEqual(row.slice(11), ['60']);
});

test('扩展汇总登录失效时保留基础汇总，不继续请求作品', async () => {
  const app = setup({ extraGraphResponse: () => ({ code: -101 }) });
  const result = await app.extract();
  assert.match(result.summaryCsv, /465,465,465,465,465,465,465,-30,/);
  assert.equal(result.postCsv, '');
  assert.equal(result.count, 0);
  assert.match(result.warning, /登录已失效/);
  assert.equal(app.calls.length, 2);
});

test('扩展字段单位、列位置与比例换算一致，保留用户要求删除的字段状态', async () => {
  const result = await setup().extract();
  const [header, row] = result.postCsv.trim().split('\n').map((line) => line.split(','));
  assert.equal(header.length, 19);
  assert.deepEqual(header.slice(12), [
    '取关量', '平均播放进度', '占总时长比', '游客播放占比', '3秒跳出率（发稿后14天）', '互动率（发稿后14天）', '播转粉率',
  ]);
  assert.deepEqual(row.slice(12), ['1', '0分41秒', '67.5%', '80.00%', '12.00%', '35.00%', '0.50%']);
  assert.equal(result.posts[0].bounceRate, '12.00%'); // 总体值，不能误用粉丝 9% 或游客 15%。
  assert.equal(header.some((s) => /累计|BV号|AV号|作品链接|统计口径|提取时间|完播率/.test(s)), false);
});

test('比例保留真实零值，拒绝无效值，互动率可以超过百分之百', () => {
  const { context } = setup();
  const format = (value, type) => vm.runInContext(`biliFormatMetric(${JSON.stringify(value)}, ${JSON.stringify(type)})`, context);
  for (const bad of [null, '', false, true, -1, 'NaN', {}, []]) assert.equal(format(bad, 'percent'), '');
  assert.equal(format(0, 'percent'), '0.00%');
  assert.equal(format(10000, 'percent'), '100.00%');
  assert.equal(format(10001, 'percent'), '');
  assert.equal(format(15000, 'ratio'), '150.00%');
  assert.equal(format(1.2, 'count'), '');
});

test('缺失进度不通过时长推算或读取 hour_stat，删除字段不再输出', async () => {
  const result = await setup({ progressResponse: () => ({ code: 0, data: { quit_info: {}, duration_info: { avg_play_time_int: 120 } } }), compareResponse: (ids) => ({ code: 0, data: { list: ids.map((bvid) => ({
    bvid, stat: compareStat({ avg_play_time: 120, full_play_ratio: null, play: 0 }),
    hour_stat: compareStat({ full_play_ratio: 5000 }),
  })) } }) }).extract();
  const post = result.posts[0];
  assert.equal(Object.hasOwn(post, 'avgPlayTime'), false);
  assert.equal(post.avgPlayProgress, '');
  for (const key of ['watchIndex', 'fanWatchRate', 'fanBounceRate', 'guestBounceRate', 'fanInteractionRate', 'guestInteractionRate', 'clickPercentile', 'fanClickPercentile', 'guestClickPercentile', 'clickStars', 'fanClickStars', 'guestClickStars', 'likeRate', 'commentRate', 'danmakuRate', 'favoriteRate', 'coinRate', 'shareRate']) assert.equal(Object.hasOwn(post, key), false);
  assert.match(result.warning, /平均播放进度/);
});

test('整体互动率保留接口零值，不通过已删除的单项比率拼算', async () => {
  const result = await setup({ compareResponse: (ids) => ({ code: 0, data: { list: ids.map((bvid) => ({
    bvid, stat: compareStat({ play: 10, like: 0, comment: 20, coin: null, interact_rate: 0 }),
  })) } }) }).extract();
  assert.equal(result.posts[0].plays, 24);
  assert.equal(result.posts[0].interactionRate, '0.00%');
});

test('对比每批最多十篇，按 BV 号关联乱序结果且忽略额外推荐作品', async () => {
  const app = setup({ pages: [Array.from({ length: 23 }, (_, i) => item(i + 1))], compareResponse: (ids) => ({ code: 0, data: {
    list: [...ids].reverse().map((bvid) => ({ bvid, stat: compareStat({ unfollow: Number(bvid.slice(2)) }) })).concat([{ bvid: 'BV9999999999', stat: compareStat() }]),
  } }) });
  const result = await app.extract();
  assert.equal(result.warning, '');
  assert.deepEqual(Array.from(result.posts, (p) => p.unfollow), Array.from({ length: 23 }, (_, i) => i + 1));
  const calls = app.calls.filter((c) => c.url.includes('/archive_diagnose/compare'));
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((c) => new URL(c.url).searchParams.get('compare_bvids').split(',').length), [10, 10, 3]);
  assert.ok(calls.every((c) => new URL(c.url).searchParams.get('size') === '10'));
});

test('缺少或重复的对比作品留空，绝不依响应顺序错配', async () => {
  const result = await setup({ pages: [[item(1), item(2), item(3)]], compareResponse: (ids) => ({ code: 0, data: { list: [
    { bvid: ids[0], stat: compareStat() }, { bvid: ids[0], stat: compareStat() }, { bvid: ids[2], stat: compareStat() },
  ] } }) }).extract();
  assert.deepEqual(Array.from(result.posts, (p) => p.guestPlayShare), ['', '', '80.00%']);
  assert.ok(result.posts.every((p) => p.avgPlayProgress === '0分41秒'));
  assert.match(result.warning, /2 篇作品未在对比响应中唯一匹配/);
  assert.ok(result.posts.every((p) => p.plays === 24 && p.comments === 3));
});

test('对比登录失效停止后续批次，保留所有基本统计', async () => {
  const app = setup({ pages: [Array.from({ length: 31 }, (_, i) => item(i + 1))], compareResponse: () => ({ code: -101 }) });
  const result = await app.extract();
  assert.ok(app.calls.filter((c) => c.url.includes('/archive_diagnose/compare')).length <= 2);
  assert.ok(result.posts.every((p) => p.plays === 24 && p.comments === 3 && p.guestPlayShare === '' && p.avgPlayProgress === '0分41秒'));
  assert.match(result.warning, /扩展统计期间登录失效，已停止后续请求/);
});

test('无入选作品或补充明细阶段登录失效时不请求对比', async () => {
  for (const options of [{ pages: [[]] }, { detailResponse: () => ({ code: -101 }) }]) {
    const app = setup(options);
    await app.extract();
    assert.equal(app.calls.filter((c) => c.url.includes('/archive_diagnose/compare')).length, 0);
  }
});

test('9月19日截图示例：进度秒数与占比各取独立字段，不读取平均观看时长', async () => {
  const app = setup({ pages: [[item(1, { pubtime: seconds('2026-09-19T12:00:00+08:00'), duration: 30 })]],
    progressResponse: (cid) => ({ code: 0, data: { cid, quit_info: { avg_play_progress: 20.25, full_play_ratio: 6750 }, duration_info: { avg_play_time_int: 12 } } }),
  });
  const result = await app.extract();
  assert.equal(result.posts[0].avgPlayProgress, '0分20秒');
  assert.equal(result.posts[0].playProgressRatio, '67.5%');
  assert.equal(result.posts[0].publish, '2026-09-19 12:00:00');
  const call = new URL(app.calls.find((c) => c.url.includes('/v2/archive/analyze/graph')).url);
  assert.equal(call.searchParams.get('cid'), '1001');
  assert.equal(app.calls.some((c) => c.url.includes('/v3/archive/view')), false);
  assert.equal(result.warning, '');
});

test('进度与占比各自校验，零值保留，缺失或异常不补零也不相互推算', async () => {
  const inputs = [
    [{ avg_play_progress: 0, full_play_ratio: 0 }, ['0分0秒', '0.0%']],
    [{ avg_play_progress: 80.9, full_play_ratio: 10000 }, ['1分20秒', '100.0%']],
    [{ avg_play_progress: null, full_play_ratio: 6750 }, ['', '67.5%']],
    [{ avg_play_progress: 20.25, full_play_ratio: null }, ['0分20秒', '']],
    [{ avg_play_progress: false, full_play_ratio: '' }, ['', '']],
    [{ avg_play_progress: -1, full_play_ratio: 10001 }, ['', '']],
  ];
  for (const [quit_info, expected] of inputs) {
    const result = await setup({ progressResponse: () => ({ code: 0, data: { quit_info } }) }).extract();
    assert.deepEqual([result.posts[0].avgPlayProgress, result.posts[0].playProgressRatio], expected);
  }
});

test('缺少列表分P信息时先按BV查询CID，进度响应乱序不串作品', async () => {
  const app = setup({ pages: [[item(1, { videos: [] }), item(2, { videos: undefined })]],
    progressResponse: async (cid) => {
      if (cid === 1001) await new Promise((resolve) => setTimeout(resolve, 10));
      return { code: 0, data: { cid, quit_info: { avg_play_progress: cid - 1000, full_play_ratio: 5000 } } };
    },
  });
  const result = await app.extract();
  assert.deepEqual(Array.from(result.posts, (p) => p.avgPlayProgress), ['0分1秒', '0分2秒']);
  assert.equal(app.calls.filter((c) => c.url.includes('/v3/archive/view')).length, 2);
});

test('多P作品不以第一P冒充整篇进度，不发出进度请求', async () => {
  for (const fromList of [true, false]) {
    const app = setup({ pages: [[item(1, { videos: fromList ? [{ cid: 1001 }, { cid: 1002 }] : [] })]],
      archiveViewResponse: () => ({ code: 0, data: { videos: [{ cid: 1001 }, { cid: 1002 }] } }),
    });
    const result = await app.extract();
    assert.equal(result.posts[0].avgPlayProgress, '');
    assert.equal(result.posts[0].playProgressRatio, '');
    assert.equal(app.calls.some((c) => c.url.includes('/v2/archive/analyze/graph')), false);
    assert.match(result.warning, /多 P 作品/);
  }
});

test('进度查询关联异常或接口失败时保留其他统计，两列留空', async () => {
  for (const options of [
    { pages: [[item(1, { videos: [] })]], archiveViewResponse: () => ({ code: 0, data: { bvid: 'BV9999999999', videos: [{ cid: 1001 }] } }) },
    { pages: [[item(1, { videos: [{ cid: null }] })]] },
    { progressResponse: () => ({ code: 0, data: { cid: 9999, quit_info: { avg_play_progress: 20, full_play_ratio: 6750 } } }) },
    { progressResponse: () => ({ code: -400 }) },
  ]) {
    const result = await setup(options).extract();
    assert.equal(result.posts[0].avgPlayProgress, '');
    assert.equal(result.posts[0].playProgressRatio, '');
    assert.equal(result.posts[0].comments, 3);
    assert.equal(result.posts[0].guestPlayShare, '80.00%');
    assert.match(result.warning, /平均播放进度\/占总时长比获取失败/);
  }
});

test('进度接口登录失效停止排队查询及后续对比请求', async () => {
  const app = setup({ pages: [[item(1), item(2), item(3), item(4)]], progressResponse: () => ({ code: -101 }) });
  const result = await app.extract();
  assert.ok(app.calls.filter((c) => c.url.includes('/v2/archive/analyze/graph')).length <= 2);
  assert.equal(app.calls.some((c) => c.url.includes('/archive_diagnose/compare')), false);
  assert.ok(result.posts.every((p) => p.avgPlayProgress === '' && p.playProgressRatio === '' && p.plays === 24));
  assert.match(result.warning, /进度查询期间登录失效/);
});


test('B 站分页中途登录失效保留汇总与已取得作品，停止所有后续补充请求', async () => {
  const messages = [];
  const app = setup({
    pageResponse: (page) => page === 1 ? { code: 0, data: { list: [item(1)], pager: { pn: 1, total: 2 } } } : { code: -101 },
    sendMessage: async (message) => { messages.push(message); return message.type === 'beginExtraction'
      ? { ok: true, taskId: 'test' } : { ok: !message.error, data: message.data, error: message.error }; },
  });
  const response = await app.send({ type: 'extract', platform: '哔哩哔哩', period: 'month' });
  assert.equal(response.ok, true);
  const result = response.data;
  assert.equal(result.count, 1);
  assert.match(result.summaryCsv, /465,465/);
  assert.equal(result.posts[0].plays, 24);
  const row = result.postCsv.trimEnd().split('\n')[1].split(',');
  assert.equal(row.length, 19);
  assert.deepEqual(row.slice(7), Array(12).fill(''));
  assert.match(result.warning, /列表可能不完整.*登录已失效/);
  assert.equal(app.calls.length, 4);
  const completed = messages.find((message) => message.type === 'endExtraction');
  assert.equal(completed.data.count, 1);
  assert.equal(completed.error, undefined);
});

test('B 站汇总不可用但分页已成功时，登录失效仍可导出已取得作品', async () => {
  const app = setup({ graph: { code: -400 }, ...unavailableExtras,
    pageResponse: (page) => page === 1 ? { code: 0, data: { list: [item(1)], pager: { pn: 1, total: 2 } } } : { code: -101 },
  });
  const result = await app.extract();
  assert.equal(result.summaryCsv, '');
  assert.equal(result.count, 1);
  assert.match(result.postCsv, /作品1/);
  assert.match(result.warning, /登录已失效/);
  assert.equal(app.calls.length, 4);
});

test('B 站首个作品请求登录失效时，仍可导出有效汇总', async () => {
  const app = setup({ pageResponse: () => ({ code: -101 }) });
  const result = await app.extract();
  assert.notEqual(result.summaryCsv, '');
  assert.equal(result.postCsv, '');
  assert.equal(result.count, 0);
  assert.match(result.warning, /登录已失效/);
  assert.equal(app.calls.length, 3);
});

test('B 站登录失效且没有取得有效汇总或列表时仍报告失败', async () => {
  for (const options of [
    { graph: { code: -400 }, extraGraphResponse: () => ({ code: -101 }) },
    { graph: { code: -400 }, ...unavailableExtras, pageResponse: () => ({ code: -101 }) },
  ]) {
    await assert.rejects(setup(options).extract(), /登录已失效/);
  }
});
