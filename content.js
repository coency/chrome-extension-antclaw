// content.js —— 统一多平台创作者数据中心提取
// 运行在已登录的抖音 / 微信视频号 / B 站创作者页面；B 站逻辑见 bilibili.js。
const pad2 = (n) => String(n).padStart(2, '0');
// YYYYMMDD -> YYYY.MM.DD（用于周度显示具体日期范围）
function fmtRange(yyyymmdd) { const s = String(yyyymmdd); return s.slice(0, 4) + '.' + s.slice(4, 6) + '.' + s.slice(6, 8); }

// 统计区间必须对齐到自然日：endTs 取区间最后一天的 00:00:00（平台前端同款）。
// 实测教训：把 endTs 改成 23:59:59 会让区间变成「30 天 23:59:59」，平台直接返回 300800 request failed。
// 「最后一天的数据是否被包含」需要与后台数字对比确认（见 README 的验证方法），不要凭猜改这里。
function monthInfo() { const n = new Date(); const y = n.getFullYear(), m = n.getMonth(); const py = m === 0 ? y - 1 : y, pm = m === 0 ? 11 : m - 1; const ymd = (d) => '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()); return { label: py + '年' + pad2(pm + 1) + '月', startTs: Math.floor(new Date(py, pm, 1).getTime() / 1000), endTs: Math.floor(new Date(py, pm + 1, 0).getTime() / 1000), startD: ymd(new Date(py, pm, 1)), endD: ymd(new Date(py, pm + 1, 0)) }; }
function isoWeek(d) { const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const day = (dt.getDay() + 6) % 7; dt.setDate(dt.getDate() - day + 3); const y = dt.getFullYear(); const jan4 = new Date(y, 0, 4); const j4 = (jan4.getDay() + 6) % 7; const w1 = new Date(jan4.getTime() - j4 * 86400000); return { year: y, week: 1 + Math.round((dt - w1) / (7 * 86400000)) }; }
function weekInfo() { const n = new Date(); const dow = n.getDay(); const diff = dow === 0 ? 6 : dow - 1; const curMon = new Date(n.getFullYear(), n.getMonth(), n.getDate() - diff); const prevMon = new Date(curMon.getTime() - 7 * 86400000); const prevSun = new Date(prevMon.getTime() + 6 * 86400000); const iw = isoWeek(prevMon); const ymd = (d) => '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()); return { startTs: Math.floor(new Date(prevMon.getFullYear(), prevMon.getMonth(), prevMon.getDate()).getTime() / 1000), endTs: Math.floor(new Date(prevSun.getFullYear(), prevSun.getMonth(), prevSun.getDate()).getTime() / 1000), startD: ymd(prevMon), endD: ymd(prevSun), label: iw.year + '年' + iw.week + '周' }; }
function cDate(sec) { const d = new Date(sec * 1000); return '' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function cDateTimeS(sec) { const d = new Date(sec * 1000); return '' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }
function cDateYmd(sec) { const d = new Date(sec * 1000); return '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()); }
// 数组类型保护：接口结构变化时（数字/对象）不能直接 .reduce，否则抛出不可读的 TypeError
function sum(a) { return (Array.isArray(a) ? a : []).reduce((x, y) => x + (parseInt(y, 10) || 0), 0); }
function last(a) { return Array.isArray(a) ? a[a.length - 1] : undefined; }
// 全文件唯一的百分比格式化：null / undefined / '' 输出空串，其余按 0-1 小数 ×100 保留 2 位
function pct(x) { return (x == null || x === '') ? '' : (Number(x) * 100).toFixed(2) + '%'; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REQ_TIMEOUT_MS = 20000; // 单次请求超时（避免网络挂起让弹窗永远停在「提取中」）
// CSV 公式注入防护：只给「不是纯数字」的文本加前置 '，否则负数（如 粉丝净增 -3）会被写成 '-3
const PLAIN_NUM = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?%?$/;
function esc(v) { v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v) && !PLAIN_NUM.test(v)) v = "'" + v; return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function toCsv(rows) { return rows.map((r) => r.map(esc).join(',')).join('\n') + '\n'; }

// ================= 微信视频号 =================
async function axhr(url, opt) {
  // 网络错误/超时重试；HTTP 错误（401/403/500）不再重试并给出明确提示；JSON 解析失败才重试。
  // 注意：此处不要引入名为 last 的变量，会遮蔽上面的全局工具函数 last()。
  for (let k = 0; k < 3; k++) {
    let r, ctl, timer;
    try {
      ctl = new AbortController();
      timer = setTimeout(() => ctl.abort(), REQ_TIMEOUT_MS);
      r = await fetch(url, Object.assign({ credentials: 'include' }, opt, { signal: ctl.signal }));
    } catch (e) { clearTimeout(timer); await sleep(900); continue; }
    clearTimeout(timer);
    if (!r.ok) throw new Error('请求失败（HTTP ' + r.status + '）：请确认已登录对应平台后再操作');
    try { return await r.json(); } catch (e) { await sleep(900); }
  }
  throw new Error('请求失败：请确认已登录对应平台后再操作（若已登录请刷新页面重试）');
}
// 抖音接口返回 status_code!=0（如 8=用户未登录）时，视为登录失效，给出友好提示
function assertLogin(json) {
  if (json && json.status_code !== undefined && json.status_code !== 0) {
    if (json.status_code === 8) throw new Error('登录已失效，请先登录「抖音」后再操作（若已登录请刷新页面重试）');
    throw new Error('抖音数据获取失败！错误码' + json.status_code + '：' + (json.status_msg || '') );
  }
}
// 读取视频号账号ID（finder id）：直接读页面 localStorage（内容脚本与页面同源，共享同一份 localStorage）
// 取值策略保持宽松（宁可拿到可疑值，也不要误报"登录已失效"）：
// ① finder_username 是账号标识，有值就直接采用（与原实现一致，只是多做了去空白/去引号）；
// ② 兜底扫描全部键，从值里提取「xxx@finder」形式的 token；
// ③ 再接受裸的 v2_xxxx 形态（无论长度），由调用方统一补 @finder。
const stripQ = (raw) => (raw == null ? '' : String(raw).trim().replace(/^["']|["']$/g, ''));
function findFinderToken(raw) {
  const s = stripQ(raw);
  if (!s) return '';
  const m = s.match(/[A-Za-z0-9_.\-]+@finder/);
  if (m) return m[0];
  if (/^v2_[0-9a-f]+$/i.test(s)) return s;
  return '';
}
async function readFinderId() {
  for (let k = 0; k < 4; k++) {
    try {
      let f = stripQ(localStorage.getItem('finder_username'));
      if (!f) { for (const kk of Object.keys(localStorage)) { const t = findFinderToken(localStorage.getItem(kk)); if (t) { f = t; break; } } }
      if (f) { f = f.endsWith('@finder') ? f : f + '@finder'; return f; }
    } catch (e) {}
    await sleep(700);
  }
  // 找不到时只打印键名（不打印值）作为线索，便于定位平台存储结构变化
  try { console.warn('[AntClaw] 未在 localStorage 找到视频号账号标识；键名含 finder 的项：', Object.keys(localStorage).filter((k) => /finder/i.test(k)), '；总键数：', Object.keys(localStorage).length); } catch (e) {}
  return '';
}
async function channelsExtract(period) {
  const scopeLabel = period === 'week' ? '周度' : '月度';
  const R = period === 'week' ? weekInfo() : monthInfo();
  let finderId = await readFinderId();
  if (finderId && !finderId.endsWith('@finder')) finderId = finderId + '@finder';
  if (!finderId) throw new Error('未找到视频号账号标识（finder id）：请确认当前浏览器已登录视频号助手，然后刷新该页面重试（F12 控制台会打印相关键名）');
  const body = { startTs: String(R.startTs), endTs: String(R.endTs), interval: 3, timestamp: String(Date.now()), _log_finder_uin: '', _log_finder_id: finderId, rawKeyBuff: '', pluginSessionId: null, scene: 7, reqScene: 7 };
  // 汇总/趋势接口：根路径 + 汇总页 _aid/_pageUrl
  const B = 'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/statistic/';
  // 单篇作品列表接口：需走 /micro/statistic/ 路径 + 数据页 _aid/_pageUrl（此路径返回项里才带 4 个 wecom 企微统计字段）
  const MSB = 'https://channels.weixin.qq.com/micro/statistic/cgi-bin/mmfinderassistant-bin/statistic/';
  // 接口需带 _aid/_rid/_pageUrl；_aid 为视频号 Web 端常量，_rid 用页面同款「时间戳hex-随机hex」格式。
  const genRid = () => {
    try {
      const sec = Math.floor(Date.now() / 1000).toString(16);
      let rand = ''; for (let i = 0; i < 8; i++) rand += Math.floor(Math.random() * 16).toString(16);
      return sec + '-' + rand;
    } catch (e) { return Date.now().toString(16) + '-' + Math.random().toString(16).slice(2, 10); }
  };
  const vx = (path) => B + path + '?_aid=da29ffdb-3bcd-4c05-b4b7-591e3f4fb5ab&_rid=' + genRid() + '&_pageUrl=' + ('https:' + encodeURIComponent('//channels.weixin.qq.com/platform'));
  const vxMs = (path) => MSB + path + '?_aid=39c93393-93d1-4d89-93c2-5b7b85625be9&_rid=' + genRid() + '&_pageUrl=' + ('https:' + encodeURIComponent('//channels.weixin.qq.com/micro/statistic/post'));
  const post = await axhr(vx('new_post_total_data'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (post.errCode !== 0) {
    // 300333 / 300334 沿用原判断 = 登录 / 会话失效；300800 = 平台拒绝本次请求
    // （实测：区间参数不合法时返回 300800 request failed），不能再统一说成「登录已失效」误导排查。
    try { console.warn('[AntClaw] 视频号汇总接口 errCode=' + post.errCode + ' errMsg=' + (post.errMsg || '') + '，请求区间 ' + new Date(R.startTs * 1000).toLocaleString() + ' ~ ' + new Date(R.endTs * 1000).toLocaleString()); } catch (e) {}
    if (post.errCode === 300333 || post.errCode === 300334) throw new Error('登录已失效（汇总接口错误码' + post.errCode + (post.errMsg ? '：' + post.errMsg : '') + '），请先登录「视频号」后再操作（若已登录请刷新页面重试）');
    if (post.errCode === 300800) throw new Error('视频号汇总请求被平台拒绝（错误码300800：' + (post.errMsg || '') + '）：请刷新页面后重试；若持续出现，请把控制台 [AntClaw] 那行（含请求区间）发给我们');
    throw new Error('视频号数据获取失败！错误码' + post.errCode + '：' + (post.errMsg || '') );
  }
  const METRICS = ['browse', 'like', 'fav', 'comment', 'forward', 'follow'];
  // tabs 可能因接口结构变化不是数组；data[m] 也可能不是数组（历史上是数字数组）——统一做类型保护，
  // 否则 sum() 内部的 reduce 会抛出 "a.reduce is not a function" 这类不可读错误。
  const tabs = Array.isArray(post.data && post.data.dataByTabtype) ? post.data.dataByTabtype : [];
  // 各渠道分解（浏览来源等）：仅用于「推荐/分享/主页/朋友/订阅号/关注/其他」这组来源分解。
  const rows = tabs.map((t) => { const d = (t && t.data) || {}; const row = { channel: (t && t.tabTypeName) || ('type' + (t && t.tabType)) }; for (const m of METRICS) row[m] = sum(d[m]); return row; });
  const KNOWN_CH = ['推荐', '分享', '主页', '朋友♡', '订阅号消息', '关注'];
  // 汇总总量：用接口自带的 totalData，它是后台显示的权威汇总值。
  // 不能对 dataByTabtype 求和——同一作品会被多个来源渠道重复曝光，like/fav 等会重复计数
  // （例如"推荐"里的 like 与"订阅号消息/朋友"里的同一条可能重叠，求和会多算）。
  const td = (post.data && post.data.totalData) || {};
  const total = {}; for (const m of METRICS) total[m] = Array.isArray(td[m]) ? sum(td[m]) : rows.reduce((a, r) => a + r[m], 0);
  // 来源分解：只输出已知渠道；PC微信/看一看/其他 以及**平台新增的未知渠道**一律并入「其他」，
  // 避免出现"某个渠道的播放量被丢弃、分解之和 != 总播放量"。
  // 必须累加（+=）：同名渠道返回多行时，赋值会丢掉前一行，分解之和就真的对不上总量了。
  const brk = {}; for (const c of KNOWN_CH) brk[c] = 0;
  brk['其他'] = 0;
  for (const r of rows) { const v = parseInt(r.browse, 10) || 0; if (KNOWN_CH.includes(r.channel)) brk[r.channel] += v; else brk['其他'] += v; }
  // 汇总段的静默失败要显式上报：缺 totalData 时退化为"渠道分解求和"，而分解之间存在重复曝光，数值可能偏大。
  const earlyWarns = [];
  if (!(post.data && post.data.totalData)) earlyWarns.push('汇总接口未返回 totalData，总播放/互动量改用渠道分解求和，可能重复计数');
  const badTd = METRICS.filter((m) => td[m] != null && !Array.isArray(td[m]));
  if (badTd.length) earlyWarns.push('汇总字段格式异常（' + badTd.join('/') + '），该指标改用渠道分解求和');
  let fans = null, fansWarn = '';
  try {
    const f = await axhr(vx('fans_trend'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (f.errCode === 0 && f.data) {
      const d = f.data;
      // total[] 逐日累计且已含当日净增（Δtotal[i] === netAdd[i]），last(total) 即该周期末尾收盘值；
      // 不要再加 last(netAdd)，否则把最后一天净增重复算一遍。
      if (!Array.isArray(d.total) || !Array.isArray(d.netAdd)) fansWarn = '接口返回结构异常（缺少 total / netAdd）';
      else fans = { monthEnd: parseInt(last(d.total), 10) || 0, netAdd: sum(d.netAdd) };
    } else if (f.errCode !== 0) {
      if (f.errCode === 300333 || f.errCode === 300334) fansWarn = '登录已失效（错误码' + f.errCode + '）';
      else if (f.errCode === 300800) fansWarn = '请求被平台拒绝（错误码300800：' + (f.errMsg || '') + '）';
      else fansWarn = '错误码' + f.errCode + '：' + (f.errMsg || '');
    } else { fansWarn = '接口未返回数据'; }
  } catch (e) { fansWarn = String((e && e.message) || e); }
  const summaryCsv = toCsv([['周期', '播放量', '推荐播放量', '分享播放量', '主页播放量', '朋友播放量', '订阅号消息播放量', '关注播放量', '其他播放量', '朋友量', '点赞量', '评论量', '分享量', '关注者量', '关注者总数'], [R.label, total.browse, brk['推荐'], brk['分享'], brk['主页'], brk['朋友♡'], brk['订阅号消息'], brk['关注'], brk['其他'], total.like, total.fav, total.comment, total.forward, fans ? fans.netAdd : '', fans ? fans.monthEnd : '']]);
  // 单篇作品
  let posts = [], postCsv = '', postWarn = '', postTruncated = false;
  try {
    let all = [], page = 1;
    while (true) {
      const j = await axhr(vxMs('post_list'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageSize: 100, currentPage: page, sort: 'create_time', order: 'desc', startTime: String(R.startTs), endTime: String(R.endTs), timestamp: String(Date.now()), _log_finder_uin: '', _log_finder_id: finderId, rawKeyBuff: '', pluginSessionId: null, scene: 7, reqScene: 7 }) });
      if (j.errCode !== 0) { // 与汇总接口一致：登录/会话失效（300333/300800/300334）→ 未登录提示；其它 → 接口错误
        if (j.errCode === 300333 || j.errCode === 300334) throw new Error('登录已失效（单篇接口错误码' + j.errCode + (j.errMsg ? '：' + j.errMsg : '') + '），请先登录「视频号」后再操作（若已登录请刷新页面重试）');
        if (j.errCode === 300800) throw new Error('视频号单篇请求被平台拒绝（错误码300800：' + (j.errMsg || '') + '）：请刷新页面后重试');
        throw new Error('视频号单篇数据获取失败！错误码' + j.errCode + '：' + (j.errMsg || '') );
      }
      const d = j.data || {}; const list = Array.isArray(d.list) ? d.list : [];
      all.push(...list);
      if (!list.length) break;                       // 该页无数据
      if (d.totalCount != null && all.length >= d.totalCount) break; // 达到总数
      if (page >= 50) { postTruncated = true; break; } // 安全上限，防死循环（命中即上报截断）
      page++; await sleep(600);
    }
    posts = all.map((it, i) => { const m = (it.desc && it.desc.media && it.desc.media[0]) || {}; const coverUrl = m.coverUrl || m.fullCoverUrl || m.thumbUrl || ''; return { publish: cDate(it.createTime), durationSec: m.videoPlayLen != null ? m.videoPlayLen : 0, plays: it.readCount, fullRate: it.fullPlayRate != null ? pct(it.fullPlayRate) : '', avgPlay: it.avgPlayTimeSec != null ? Number(it.avgPlayTimeSec).toFixed(2) : '0', friends: it.likeCount, likes: it.favCount, comments: it.commentCount, shares: it.forwardAggregationCount, follows: it.followCount, wclick: it.wecomLinkClickCount != null ? it.wecomLinkClickCount : '', wuv: it.wecomLinkClickUv != null ? it.wecomLinkClickUv : '', wadd: it.wecomContactAddCount != null ? it.wecomContactAddCount : '', wadduv: it.wecomContactAddUv != null ? it.wecomContactAddUv : '', coverUrl, coverFileName: (coverUrl ? String(i + 1).padStart(2, '0') + '_' + it.createTime + '.jpg' : '') }; });
    postCsv = toCsv([['发布日期', '封面', '作品时长', '播放量', '完播率', '平均播放时长', '朋友量', '点赞量', '评论量', '分享量', '关注量', '企微点击次数', '企微点击人数', '添加通讯录次数', '添加通讯录人数']].concat(posts.map((p) => [p.publish, p.coverFileName, p.durationSec, p.plays, p.fullRate, p.avgPlay, p.friends, p.likes, p.comments, p.shares, p.follows, p.wclick, p.wuv, p.wadd, p.wadduv])));
  } catch (e) { postWarn = String((e && e.message) || e); }
  // 汇总各段警告：粉丝数据失败会让「关注者量/关注者总数」两列为空，必须显式告知，避免误以为"本期没涨粉"。
  const warns = [].concat(earlyWarns);
  if (fansWarn) warns.push('关注者数据获取失败（' + fansWarn + '），“关注者量 / 关注者总数”两列为空');
  if (postTruncated) warns.push('作品数超过 50 页（约 5000 条）上限，仅导出前 ' + posts.length + ' 条');
  if (postWarn) warns.push('单篇获取失败，请重试（' + postWarn + '）');
  return { platform: '视频号', scopeLabel, periodName: R.label, period: R.label, rangeText: fmtRange(R.startD) + '-' + fmtRange(R.endD), summaryCsv, postCsv, posts, coverFolder: R.label + '_' + scopeLabel + '作品封面', count: posts.length, warning: warns.join('；') };
}

// ================= 抖音 =================
// 并发池：同时最多跑 limit 个任务，结果按原顺序返回。
async function pMap(limit, items, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); } };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}
async function douyinExtract(period, concurrency) {
  const scopeLabel = period === 'week' ? '周度' : '月度';
  const R = period === 'week' ? weekInfo() : monthInfo();
  const B = 'https://creator.douyin.com/janus/douyin/creator/data/';
  // 统计区间由 date_range 决定（实测：recent_days 取 1/7/30/365 返回值完全一致，不影响结果）；
  // recent_days 仅用于与前端请求形态保持一致，不要用它来推导周期。
  const dashBody = { recent_days: 30, date_range: { start_date: R.startD, end_date: R.endD } };
  const dashJson = await axhr(B + 'overview/dashboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dashBody) });
  assertLogin(dashJson);
  const dash = Array.isArray(dashJson.metrics) ? dashJson.metrics : [];
  const dr = encodeURIComponent(JSON.stringify({ start_date: R.startD, end_date: R.endD }));
  const fansJson = await axhr(B + 'overview/dashboard/fans?recent_days=7&date_range=' + dr);
  assertLogin(fansJson);
  const fans = Array.isArray(fansJson.metrics) ? fansJson.metrics : [];
  const M = (a, en) => { const m = (Array.isArray(a) ? a : []).find((x) => x && x.english_metric_name === en); return m ? m.metric_value : ''; };
  // 汇总指标整体为空 / 粉丝指标为空时不能静默交出一份空 CSV，统一收集成提示（与单篇段的 warning 合并）
  const warnNotes = [];
  if (!dash.length) warnNotes.push('汇总接口未返回任何指标，汇总 CSV 可能为空，请刷新页面后重试');
  if (!fans.length) warnNotes.push('粉丝指标为空（吸粉量 / 脱粉量 / 总粉丝量等列为空）');
  const avgView = M(dash, 'avg_view_second'); const avgViewFmt = avgView === '' ? '' : Number(avgView).toFixed(2);
  const summaryCsv = toCsv([['周期', '投稿量', '主页访问', '总播放量', '总点赞量', '总评论量', '总分享量', '5秒完播率', '2秒跳出率', '封面点击率', '平均播放时长', '粉丝净增', '吸粉量', '脱粉量', '回访粉丝量', '总粉丝量'], [R.label, M(dash, 'publish_cnt'), M(dash, 'homepage_view_cnt'), M(dash, 'play_cnt'), M(dash, 'digg_cnt'), M(dash, 'comment_cnt'), M(dash, 'share_count'), pct(M(dash, 'completion_rate_5s')), pct(M(dash, 'bounce_rate_2s')), pct(M(dash, 'cover_click_ratio')), avgViewFmt, M(fans, 'net_fans_cnt'), M(fans, 'new_fans_cnt'), M(fans, 'cancel_fans_cnt'), M(fans, 'home_view_fans_cnt'), M(fans, 'total_fans_cnt')]]);
  let posts = [], postCsv = '', postWarn = '';
  // 列表/明细段的「部分成功」也必须上报：截断、游标停住、补充接口失败都不能静默
  let postTruncated = false, cursorStuck = false, srcFail = 0, kwFail = 0, extraLogin = false;
  try {
    // 收集 work_list 的 items[]（含全部指标 metrics）+ aweme_list[]（含时长 duration），按作品 ID 关联
    let all = [], cursor = 0, guard = 0, itemIdSet = new Set();
    while (true) {
      const j = await axhr('https://creator.douyin.com/janus/douyin/creator/pc/work_list?status=0&count=40&max_cursor=' + cursor + '&scene=star_atlas&device_platform=android&aid=1128');
      assertLogin(j);
      const its = Array.isArray(j.items) ? j.items : [], aws = Array.isArray(j.aweme_list) ? j.aweme_list : [];
      // 本页：按 item.id === aweme.item_id 关联；避免依赖数组同序/同长，防止 A 的指标+B 的时长/ID 错配
      const awmap = new Map(); for (const aw of aws) { const k = aw && aw.item_id != null ? String(aw.item_id) : null; if (k != null) awmap.set(k, aw); }
      for (const it of its) { const k = it && it.id != null ? String(it.id) : null; all.push({ item: it, aweme: k != null ? (awmap.get(k) || null) : null }); if (k != null) itemIdSet.add(k); }
      for (const aw of aws) { const k = aw && aw.item_id != null ? String(aw.item_id) : null; if (k != null && !itemIdSet.has(k)) { all.push({ item: null, aweme: aw }); itemIdSet.add(k); } }
      if (!j.has_more || (!its.length && !aws.length)) break;
      // 列表按 create_time 倒序：本页作品全部早于统计区间起点时，后续不可能再有区间内作品，提前结束。
      // （旧实现会为只要一个月的账号一路翻到 200 页，请求量与读取面远超「低频只读」的定位）
      if (its.length && its.every((it) => it && it.create_time && cDateYmd(it.create_time) < R.startD)) break;
      const next = j.max_cursor || 0;
      if (next === cursor) { cursorStuck = true; break; }  // 游标不推进：可能只抓到部分作品，必须上报
      if (++guard > 200) { postTruncated = true; break; }   // 安全上限
      cursor = next; await sleep(600);
    }
    const metas = all.filter((it) => it.item && it.item.create_time && cDateYmd(it.item.create_time) >= R.startD && cDateYmd(it.item.create_time) <= R.endD).sort((a, b) => (b.item.create_time || 0) - (a.item.create_time || 0));
    const mOf = (it) => (it.item && it.item.metrics) || {};
    const srcName = (k) => ({ homepage_hot: '推荐页', familiar: '朋友页', follow: '关注页', homepage: '个人主页', search: '搜索' }[k] || k);
    const coverOf = (cur) => { const c = cur && cur.cover; if (!c) return ''; const o = Array.isArray(c) ? c[0] : c; return (o && o.url_list && o.url_list[0]) || ''; };
    const videoId = (it) => (it.aweme && (it.aweme.aweme_id || it.aweme.item_id)) || it.item.id;
    const coverFile = (it, i) => { const u = coverOf(it.item); return u ? String(i + 1).padStart(2, '0') + '_' + videoId(it) + '.jpg' : ''; };
    posts = [];
    let postRows = [];
    // 抖音单篇：全部字段接口直取（work_list items[] + play/source + search/keyword），无需打开详情页
    const singleHeader = ['作品标题', '发布日期', '封面', '作品时长', '播放量', '点赞量', '评论量', '分享量', '收藏量', '弹幕量', '完播率', '5秒完播率', '2秒跳出率', '平均播放时长', '涨粉量', '脱粉量', '粉丝播放占比', '最大流量来源', '搜索关键词'];
    const C = Math.max(1, Math.min(10, concurrency || 4));
    const rows = await pMap(C, metas, async (it, i) => {
      const cur = it.item, aw = it.aweme, m = mOf(it);
      const id = videoId(it);
      let maxSrc = '', kw = '';
      // 补充接口失败不能静默：累计失败篇数，并把登录失效单独识别出来（旧实现 catch{} 让整列变空却无提示）
      try { const s = await axhr('https://creator.douyin.com/janus/douyin/creator/data/item/play/source?aid=2906&item_id=' + id); assertLogin(s); const arr = Array.isArray(s.play_source) ? s.play_source : []; if (arr.length) { arr.sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)); maxSrc = srcName(arr[0].key); } } catch (e) { srcFail++; if (/登录已失效/.test(String((e && e.message) || e))) extraLogin = true; }
      try { const k = await axhr('https://creator.douyin.com/janus/douyin/creator/data/item_analysis/search/keyword?aid=2906&id=' + id); assertLogin(k); const kwArr = ((Array.isArray(k.inspire_search) ? k.inspire_search : []).concat(Array.isArray(k.show_from) ? k.show_from : [])).map((x) => (typeof x === 'string') ? x : (x && (x.keyword || x.word || x.content || x.search_word || x.name)) || ''); kw = kwArr.filter(Boolean).join(', ') || '暂无数据'; } catch (e) { kw = ''; kwFail++; if (/登录已失效/.test(String((e && e.message) || e))) extraLogin = true; }
      const p = { publish: cDateTimeS(cur.create_time), duration: aw && aw.duration != null ? Math.floor(aw.duration / 1000) : '', title: (cur.description || '').replace(/\s+/g, ' ').slice(0, 200), plays: m.view_count, digg: m.like_count, comment: m.comment_count, share: m.share_count, collect: m.favorite_count, danmaku: m.danmaku_count, finish: pct(m.completion_rate), f5: pct(m.completion_rate_5s), bounce2s: pct(m.bounce_rate_2s), avgPlay: m.avg_view_second != null ? String(Math.round(Number(m.avg_view_second) * 100) / 100) : '', absorb: m.subscribe_count, forfeit: m.unsubscribe_count, fanShare: pct(m.fan_view_proportion), maxSrc, kw, coverUrl: coverOf(cur), coverFileName: coverFile(it, i) };
      return p;
    });
    posts = rows;
    postRows = rows.map((p) => [p.title, p.publish, p.coverFileName, p.duration, p.plays, p.digg, p.comment, p.share, p.collect, p.danmaku, p.finish, p.f5, p.bounce2s, p.avgPlay, p.absorb, p.forfeit, p.fanShare, p.maxSrc, p.kw]);
    postCsv = toCsv([singleHeader].concat(postRows));
  } catch (e) { postWarn = String((e && e.message) || e); }
  const notes = [];
  if (postTruncated) notes.push('作品数超过 200 页（约 8000 条）上限，仅导出前 ' + posts.length + ' 条');
  if (cursorStuck) notes.push('作品列表分页游标未推进，可能只抓取了部分作品');
  if (srcFail) notes.push('「最大流量来源」有 ' + srcFail + ' 篇获取失败');
  if (kwFail) notes.push('「搜索关键词」有 ' + kwFail + ' 篇获取失败');
  if (extraLogin) notes.push('部分明细接口提示登录失效，建议刷新页面后重试');
  if (postWarn) notes.unshift('汇总数据提取成功，但作品列表获取失败，请重试（' + postWarn + '）');
  return { platform: '抖音', scopeLabel, periodName: R.label, period: R.label, rangeText: fmtRange(R.startD) + '-' + fmtRange(R.endD), summaryCsv, postCsv, posts, coverFolder: R.label + '_' + scopeLabel + '作品封面', count: posts.length, warning: warnNotes.concat(notes).join('；') };
}

// 页面内同步拦截重复消息；后台负责跨标签页互斥、冷却及结果持久化。
let extractionActive = false;
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'extract') {
    const platform = msg.platform || '抖音';
    const period = msg.period || 'month';
    if (!['抖音', '视频号', '哔哩哔哩'].includes(platform)) {
      sendResponse({ ok: false, error: '该平台暂未接入' }); return;
    }
    if (extractionActive) { sendResponse({ ok: false, busy: true, error: '已有提取任务正在运行，请等待完成' }); return; }
    extractionActive = true;
    (async () => {
      try {
        const started = await chrome.runtime.sendMessage({ type: 'beginExtraction', platform, period });
        if (!started || !started.ok) { sendResponse(started || { ok: false, error: '无法启动提取任务' }); return; }
        let outcome;
        try {
          const data = platform === '视频号' ? await channelsExtract(period)
            : platform === '哔哩哔哩' ? await bilibiliExtract(period)
            : await douyinExtract(period, msg.concurrency);
          outcome = { data };
        } catch (e) { outcome = { error: String((e && e.message) || e) }; }
        const result = await chrome.runtime.sendMessage({ type: 'endExtraction', taskId: started.taskId, ...outcome });
        sendResponse(result || { ok: false, error: '无法保存提取结果，请重新打开扩展检查状态' });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
      finally { extractionActive = false; }
    })();
    return true;
  }
  if (msg && msg.type === 'ping') { sendResponse({ ok: true }); return; }
});
