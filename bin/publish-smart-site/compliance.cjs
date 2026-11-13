// bin/publish-smart-site/compliance.cjs — A14 发布前合规扫描卡点
// 依据 v7《组态画面复刻风险清单与处置台账》§3（A05 / A08 / R11）：
// 在 zip 之前扫描发布包副本的 data/，命中「复刻自认 / 第三方权利标识 / 真实项目名 / 暂存备份」
// 即阻断发布。A05 剪枝是预防，本模块是验收（双保险）。只读，不修改任何文件。
'use strict';

module.exports = function make(ctx) {
  const { fs, path, C, info, fail, wildcardToRegExp,
    A05_EXCLUDE_DIR_PATTERNS, A05_EXCLUDE_FILE_PATTERNS } = ctx;

  // 内容关键词：命中即阻断（中文自认 + 第三方权利标识 + 真实项目名）
  // 仅「文本自认 + 第三方权利标识 + 真实项目名」阻断；`page.backup-` / `_import-staging` /
  // `参考图/` 在 dsl-spec、MCP 工具文档中属功能契约（v7 §3.1 保留白名单），风险由
  // A05 路径/文件名剪枝与 [filename]/[dirname] 扫描覆盖，不作为文本关键词重复阻断。
  const BLOCK_KEYWORDS = [
    '复刻', '1to1', '高清对照', '_replica-tmp',
    '照图', '实测色值', '实测 1202', 'S=1920/1202', '参考图：',
    'Hightopo', 'All Rights Reserved', '先博节能', '先博 S 标', '330.6©',
    '恩施分输站', '柘荣水务', '兰州元创', '燕京玻璃',
  ];
  // 独立 © 文本图元（"text": "©"），不含 base64 中的偶然子串
  const COPYRIGHT_TEXT_RE = /"text"\s*:\s*"©"/;
  // 白名单（v7 §3.1）：技术契约/内部术语/base64 误命中，逐行跳过
  const LINE_WHITELIST = [
    'data:image', 'ReplicationMode', 'replicationq', 'typeorm', 'siemens_s7',
    'Siemens S7', 'SIEMENS_S7_1200', 'ECS-700', 'SVG国家电网', 'variant: replicate',
    'watermark not replicated', '水印未生成',
  ];
  const TEXT_EXT = /\.(json|js|cjs|mjs|ts|md|txt|bat|ps1|py|html|css|yaml|yml|svg|xml|csv|conf|log)$/i;
  const SKIP_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|exe|dll|zip|7z|db|sqlite|glb|gltf|woff2?|ttf|otf|pdf|mp4|bin)$/i;
  const MAX_FILE_BYTES = 6 * 1024 * 1024;

  /** 扫描包内 data/，返回命中明细（最多 200 条） */
  function scanCompliance(dataDir) {
    const hits = [];
    const dirMatchers = A05_EXCLUDE_DIR_PATTERNS.map(wildcardToRegExp);
    const fileMatchers = A05_EXCLUDE_FILE_PATTERNS.map(wildcardToRegExp);
    const add = (file, line, keyword, sample) => {
      if (hits.length < 200) hits.push({ file, line, keyword, sample: String(sample).slice(0, 140) });
    };
    const walk = (dir, rel) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        const r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) {
          const k = A05_EXCLUDE_DIR_PATTERNS.find((p) => wildcardToRegExp(p).test(e.name));
          if (k) { add(r, 0, '[dirname] ' + k, r); continue; }
          walk(full, r);
          continue;
        }
        if (!e.isFile()) continue;
        const fk = A05_EXCLUDE_FILE_PATTERNS.find((p) => wildcardToRegExp(p).test(e.name));
        if (fk) add(r, 0, '[filename] ' + fk, r);
        if (SKIP_EXT.test(e.name) || !TEXT_EXT.test(e.name)) continue;
        let st;
        try { st = fs.statSync(full); } catch { continue; }
        if (st.size > MAX_FILE_BYTES) continue;
        let content;
        try { content = fs.readFileSync(full, 'utf8'); } catch { continue; }
        if (content.includes('\u0000')) continue;
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (LINE_WHITELIST.some((w) => line.toLowerCase().includes(w.toLowerCase()))) continue;
          const k = BLOCK_KEYWORDS.find((x) => line.toLowerCase().includes(x.toLowerCase()));
          if (k) add(r, i + 1, k, line.trim());
          else if (COPYRIGHT_TEXT_RE.test(line)) add(r, i + 1, '"text": "©"', line.trim());
        }
      }
    };
    if (fs.existsSync(dataDir)) walk(dataDir, '');
    return hits;
  }

  /** 发布前卡点：命中即 fail（阻断 zip） */
  function enforceCompliance(dataDir) {
    const t0 = Date.now();
    const hits = scanCompliance(dataDir);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    if (!hits.length) {
      info(C.ok(`✓ A14 compliance scan passed: no replica evidence / third-party rights marks (${elapsed}s)`));
      return { pass: true, count: 0 };
    }
    info(C.warn(`! A14 compliance scan found ${hits.length} hit(s) (${elapsed}s):`));
    for (const h of hits.slice(0, 15)) {
      info(C.warn(`    ${h.file}${h.line ? ':' + h.line : ''} → ${h.keyword}`));
    }
    if (hits.length > 15) info(C.dim(`    ... and ${hits.length - 15} more`));
    fail(
      `Release blocked (A14): ${path.basename(dataDir)}/ still contains ${hits.length} replica evidence / third-party rights marks in the package.\n` +
      '  Action: remove replica pages and rights marks from runtime ss-run/ss/data (v7 ledger A01-A03/A08-b),\n' +
      '  or check whether A05 pruning worked; republish after fixing.',
    );
    return { pass: false, count: hits.length };
  }

  return { scanCompliance, enforceCompliance };
};
