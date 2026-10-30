// 在已登录的 https://member.bilibili.com/ 页面控制台运行。
// 仅执行 GET 查询，导出 2026-09-29 发布作品的分析样本；不修改扩展的 CSV 字段。
(async () => {
  'use strict';
  const targetDate = '2026-09-29';
  if (location.origin !== 'https://member.bilibili.com') throw new Error('请在 B 站创作中心 member.bilibili.com 页面运行');
  const lock = '__antclawBiliSampleRunning';
  if (globalThis[lock]) throw new Error('样本采集正在运行，请等待完成');
  globalThis[lock] = true;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const num = (value) => {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value))) return null;
    const n = Number(value);
    return Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER ? n : null;
  };
  const beijing = (value) => {
    const n = num(value);
    return n != null && n > 0 && n < 1e11 ? new Date(n * 1000 + 28800000).toISOString().slice(0, 19).replace('T', ' ') : '';
  };
  // 显式记录是否存在字段，防止把缺失、null 与真实零混为一谈。
  const pick = (object, keys) => Object.fromEntries(keys.map((key) => [key,
    own(object, key) ? { present: true, raw: object[key] } : { present: false },
  ]));
  const report = {
    schema: 'antclaw-bilibili-single-day-sample-v1', targetDate, collectedAt: new Date().toISOString(),
    listComplete: false, warnings: [], works: [],
    note: '采集真实接口原值，不对未验证的点击率、同类基准或趋势值猜测单位；留存按分P记录。',
  };
  let loginExpired = false;
  async function request(path, params) {
    if (loginExpired) throw new Error('登录已失效，未继续请求');
    await wait(600);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('https://member.bilibili.com/x/web/data/' + path + '?' + new URLSearchParams(params), {
        method: 'GET', credentials: 'include', signal: controller.signal,
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const json = await response.json();
      if (json.code === -101) loginExpired = true;
      if (json.code !== 0) throw new Error('业务错误 ' + json.code + '：' + (json.message || json.msg || '接口未成功'));
      if (!json.data || typeof json.data !== 'object') throw new Error('缺少 data');
      return json.data;
    } finally { clearTimeout(timer); }
  }
  async function capture(path, params, select) {
    try {
      const data = await request(path, params);
      return { endpoint: path, params, ok: true, data: select(data) };
    } catch (error) {
      return { endpoint: path, params, ok: false, error: String(error.message || error) };
    }
  }
  try {
    const seen = new Set();
    console.info('[AntClaw] 正在查找 ' + targetDate + ' 发布的作品，请保持页面打开。');
    for (let pn = 1; pn <= 200; pn++) {
      let data;
      try { data = await request('archive/index', { pn, ps: 20, scene: 'archive_compare', order: 0 }); }
      catch (error) { report.warnings.push('作品列表未完整取得：' + error.message); break; }
      const total = num(data.pager && data.pager.total);
      if (!Array.isArray(data.list) || !Number.isSafeInteger(total) || total < data.list.length || Number(data.pager.pn) !== pn) {
        report.warnings.push('分页格式异常，无法确认作品列表完整性'); break;
      }
      let added = 0;
      for (const item of data.list) {
        const bvid = item && item.bvid;
        const id = typeof bvid === 'string' && /^BV[0-9A-Za-z]{10}$/.test(bvid) ? bvid : 'av' + (item && item.aid);
        if (seen.has(id)) continue;
        seen.add(id); added++;
        const publish = beijing(item && item.pubtime);
        if (publish.slice(0, 10) !== targetDate) continue;
        if (!/^BV[0-9A-Za-z]{10}$/.test(bvid || '')) { report.warnings.push('目标日有作品缺少 BV 号，无法查询'); continue; }
        report.works.push({ bvid, title: item.title, publish, duration: item.duration,
          listStat: pick(item.stat, ['play', 'likes', 'fans']),
        });
      }
      if (seen.size >= total) { report.listComplete = true; break; }
      if (!added) { report.warnings.push('分页未推进，列表可能不完整'); break; }
      if (pn === 200) report.warnings.push('已达到 200 页上限，列表可能不完整');
    }
    for (const work of report.works) {
      if (loginExpired) { report.warnings.push('登录失效，尚未查询的作品统计未采集'); break; }
      console.info('[AntClaw] 采集：' + work.title + '（' + work.bvid + '）');
      work.playAnalysis = await capture('archive_diagnose/play_analyze', { bvid: work.bvid }, (data) => ({
        guest_interact: pick(data.guest_interact, [
          'tm_rate', 'tm_rate_med', 'tm_pass_rate', 'tm_star', 'tm_new',
          'crash_rate', 'crash_rate_med', 'interact_rate', 'interact_rate_med',
          'play_trans_fan_rate', 'play_trans_fan_rate_med', 'log_date', 'log_hour',
        ]),
      }));
      work.playTrend = await capture('archive_diagnose/trend', { bvid: work.bvid, type: 'play' }, (data) => ({
        ...pick(data, ['tendency', 'data_tendency', 'last_30_day_tendency', 'last_30_day_data_tendency',
          'period', 'log_date', 'update_time', 'hour_ctl', 'hour_data_realtime_period']),
      }));
      work.compare = await capture('archive_diagnose/compare', { compare_bvids: work.bvid, size: 10 }, (data) => {
        const matches = Array.isArray(data.list) ? data.list.filter((item) => item && item.bvid === work.bvid) : [];
        if (matches.length !== 1) throw new Error('对比响应无法唯一匹配该 BV 号');
        return { stat: pick(matches[0].stat, ['play', 'full_play_ratio', 'avg_play_time', 'avg_play_time_int',
          'crash_rate', 'interact_rate', 'play_trans_fan_rate', 'total_new_attention_cnt', 'unfollow']) };
      });
      const detail = await capture('v3/archive/view', { bvid: work.bvid }, (data) => {
        if (data.bvid && data.bvid !== work.bvid) throw new Error('详情 BV 号不匹配');
        if (!Array.isArray(data.videos)) throw new Error('详情缺少分 P 列表');
        return data.videos.map((part, index) => ({ part: index + 1, cid: part.cid, title: part.title, duration: part.duration }));
      });
      work.parts = detail;
      work.retention = [];
      if (detail.ok) for (const part of detail.data) {
        if (loginExpired) break;
        const cid = num(part.cid);
        if (!Number.isSafeInteger(cid) || cid <= 0) { work.retention.push({ part: part.part, ok: false, error: '无效 CID' }); continue; }
        const response = await capture('v2/archive/analyze/graph', { cid }, (data) => {
          if (data.cid != null && num(data.cid) !== cid) throw new Error('进度响应 CID 不匹配');
          return {
            quit_info: pick(data.quit_info, ['avg_play_progress', 'full_play_ratio', 'duration', 'full_play_ratio_avg', 'full_play_ratio_medium', 'pass_peer']),
            duration_info: pick(data.duration_info, ['avg_play_time', 'avg_play_time_int', 'quit_duration', 'peer_quit_duration']),
            ...pick(data, ['viewer_quit', 'peer_viewer_quit']),
          };
        });
        work.retention.push({ part: part.part, ...response });
      }
    }
    if (!report.works.length) report.warnings.push('未匹配到目标日作品，请核对账号、日期及作品列表是否完整');
    const json = JSON.stringify(report, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = '哔哩哔哩_' + targetDate + '_分析样本.json';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    console.table(report.works.map((work) => ({ 作品: work.title, BV号: work.bvid, 发布时间: work.publish })));
    console.info('[AntClaw] 样本已导出，共 ' + report.works.length + ' 篇作品。请把下载的 JSON 文件发回当前对话。', report.warnings);
  } finally { delete globalThis[lock]; }
})();
