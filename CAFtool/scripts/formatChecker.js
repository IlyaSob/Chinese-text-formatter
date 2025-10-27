// scripts/formatChecker.js

// —— 引号/括号/书名号 等成对符号的智能规范 ——
// 规则要点：
// 1) 引号按层级交替：最外层双引号“ ”，内层单引号‘ ’；方向错误或类型错误会被更正。
// 2) 括号/书名号等同类成对：若出现两侧同向（如 “( …… (” / “《 …… 《”），在可闭合位置将后一处翻转为右符号。
// 3) ASCII 直引号 " ' 会根据层级与栈状态自动变为对应的左/右中文引号；半角括号/书名号会转为全角并纠正方向。
// 4) 不插入/删除字符，只替换为最合理的成对符号，保持字符串长度不变。

// scripts/formatChecker.js（文件顶部合适位置）
const tr = (s) =>
  (window.Asc && window.Asc.plugin && typeof window.Asc.plugin.tr === "function")
    ? window.Asc.plugin.tr(s)
    : s;

// 可选：占位符替换（支持 {name} 这类变量）
const T = (key, params) => {
  let out = tr(key);
  if (params) out = out.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? ""));
  return out;
};

function normalizeQuotesAndPairs(input) {
  const chars = Array.from(input);
  const len = chars.length;
  const errors = [];

  // 成对定义（全角）
  const PAIRS = {
    q_double: { open: '“', close: '”', name: 'Double quotes' },
    q_single: { open: '‘', close: '’', name: 'Single quotes' },
    book: { open: '《', close: '》', name: 'Book title mark' },
    paren: { open: '（', close: '）', name: 'Parentheses' },
    square: { open: '［', close: '］', name: 'Square brackets' },
    corner: { open: '【', close: '】', name: 'Corner brackets' },
    angle: { open: '〈', close: '〉', name: 'Angle brackets' },
  };


  // 查表：字符 -> {cat, dir, canon: 替换后的全角}
  const LOOKUP = new Map([
    // 中文引号（已带方向）
    ['“', { cat: 'q_double', dir: 'open',  canon: '“' }],
    ['”', { cat: 'q_double', dir: 'close', canon: '”' }],
    ['‘', { cat: 'q_single', dir: 'open',  canon: '‘' }],
    ['’', { cat: 'q_single', dir: 'close', canon: '’' }],

    // 全角括号/书名号等
    ['《', { cat: 'book',   dir: 'open',  canon: '《' }],
    ['》', { cat: 'book',   dir: 'close', canon: '》' }],
    ['（', { cat: 'paren',  dir: 'open',  canon: '（' }],
    ['）', { cat: 'paren',  dir: 'close', canon: '）' }],
    ['［', { cat: 'square', dir: 'open',  canon: '［' }],
    ['］', { cat: 'square', dir: 'close', canon: '］' }],
    ['【', { cat: 'corner', dir: 'open',  canon: '【' }],
    ['】', { cat: 'corner', dir: 'close', canon: '】' }],
    ['〈', { cat: 'angle',  dir: 'open',  canon: '〈' }],
    ['〉', { cat: 'angle',  dir: 'close', canon: '〉' }],

    // 半角括号/书名号等（统一转为全角并按方向处理）
    ['<', { cat: 'book',   dir: 'open',  canon: '《' }],
    ['>', { cat: 'book',   dir: 'close', canon: '》' }],
    ['(', { cat: 'paren',  dir: 'open',  canon: '（' }],
    [')', { cat: 'paren',  dir: 'close', canon: '）' }],
    ['[', { cat: 'square', dir: 'open',  canon: '［' }],
    [']', { cat: 'square', dir: 'close', canon: '］' }],
  ]);

  // ASCII 直引号（方向未知）：交给层级/栈判断
  const isNeutralQuote = ch => ch === '"' || ch === "'";

  // 简单的 CJK 判定（用于一些启发，非强制）
  const isCJK = ch => /[\u3400-\u9FFF\u3007]/.test(ch);

  // 两类栈：引号与其它成对符号
  const quoteStack = [];               // ['q_double' | 'q_single', ...]
  const pairStack  = [];               // [{cat, idx}, ...]
  const sinceOpenHasContent = (s, start, end) => /\S/.test(s.slice(start, end).join(''));
  const expectedQuoteType = () => (quoteStack.length % 2 === 0 ? 'q_double' : 'q_single');

  function replaceAt(i, newChar, rule, message) {
    if (chars[i] !== newChar) {
      chars[i] = newChar;
      errors.push({ index: i, rule, message });
    }
  }

  // 主循环
  for (let i = 0; i < len; i++) {
    const ch = chars[i];

    // —— 1) 直引号：" ' —— 根据层级与栈判断方向/类型
    if (isNeutralQuote(ch)) {
      const wantType = expectedQuoteType();           // 期望 q_double / q_single
      const openChar  = PAIRS[wantType].open;
      const closeChar = PAIRS[wantType].close;

      // 判定更像“开”还是“闭”：若当前层已经打开了 wantType，则更可能是“闭”
      const isClose = (quoteStack.length > 0 && quoteStack[quoteStack.length - 1] === wantType);

      if (isClose) {
        replaceAt(i, closeChar, 'quote.dir.fix',
          T("Neutral quote auto-resolved to right {name}", { name: tr(PAIRS[wantType].name) })
        );
        quoteStack.pop();
      } else {
        replaceAt(i, openChar, 'quote.dir.fix',
          T("Neutral quote auto-resolved to left {name}", { name: tr(PAIRS[wantType].name) })
        );
        quoteStack.push(wantType);
      }
      continue;
    }

    const info = LOOKUP.get(ch);
    if (!info) continue;

    // —— 2) 已带方向的中文引号 —— 校正“类型”&“方向”
    if (info.cat === 'q_double' || info.cat === 'q_single') {
      const wantType = expectedQuoteType();
      if (info.dir === 'open') {
        if (info.cat !== wantType) {
          // 开引号类型不符合层级期望 → 换成期望开引号
          replaceAt(i, PAIRS[wantType].open, 'quote.type.fix',
            T("Expected {name} at this level; replaced with left {name}", { name: tr(PAIRS[wantType].name) })
          );

          quoteStack.push(wantType);
        } else {
          // 类型正确，直接入栈
          if (ch !== info.canon) replaceAt(i, info.canon, 'quote.normalize', tr("Normalized quotes to full-width"));
          quoteStack.push(info.cat);
        }
      } else { // close
        if (quoteStack.length === 0) {
          // 栈空却遇到右引号 → 认定为开，引为期望类型
          replaceAt(i, PAIRS[wantType].open, 'quote.dir.fix',
            T("Right quote found before any open; replaced with left {name}", { name: tr(PAIRS[wantType].name) })
          );
          quoteStack.push(wantType);
        } else {
          const top = quoteStack[quoteStack.length - 1];
          if (top !== info.cat) {
            // 期望闭合 top 类型
            replaceAt(i, PAIRS[top].close, 'quote.type.fix',
              T("Quote type mismatch; expected to close {name}; replaced with right {name}", {
                name: tr(PAIRS[top].name)
              })
            );
            quoteStack.pop();
          } else {
            // 类型匹配，正常闭合
            if (ch !== info.canon) replaceAt(i, info.canon, 'quote.normalize', tr("Normalized quotes to full-width"));
            quoteStack.pop();
          }
        }
      }
      continue;
    }

    // —— 3) 其它成对符号（括号/书名号/方括号/六角括/尖括号） —— 纠正方向/类型
    if (info.dir === 'open') {
      // 若同类已打开且“自上次打开以来有内容”，此处更像“闭” → 翻转为右符号并出栈（处理 "(……(" 误写）
      if (pairStack.length > 0 && pairStack[pairStack.length - 1].cat === info.cat) {
        const top = pairStack[pairStack.length - 1];
        if (sinceOpenHasContent(chars, top.idx + 1, i)) {
          replaceAt(i, PAIRS[info.cat].close, 'pair.dir.fix',
            T("Duplicate left {name} detected; treated as closing and replaced with right {name}", {
              name: tr(PAIRS[info.cat].name)
            })
          );
          pairStack.pop();
          continue;
        }
      }
      // 正常入栈（并规范为全角）
      if (chars[i] !== info.canon)
        replaceAt(i, info.canon, 'pair.normalize',
          T("Normalized {name} to full-width", { name: tr(PAIRS[info.cat].name) })
        );
      pairStack.push({ cat: info.cat, idx: i });

    } else { // close
      if (pairStack.length === 0) {
        // 栈空却来右符号 → 改为左符号并入栈
        replaceAt(i, PAIRS[info.cat].open, 'pair.dir.fix',
          T("Right {name} found before any open; replaced with left {name}", {
            name: tr(PAIRS[info.cat].name)
          })
        );
        pairStack.push({ cat: info.cat, idx: i });
      } else {
        const top = pairStack[pairStack.length - 1];
        if (top.cat === info.cat) {
          // 正常闭合（并规范为全角）
          if (chars[i] !== info.canon) replaceAt(i, info.canon, 'pair.normalize',
            T("Normalized {name} to full-width", { name: tr(PAIRS[info.cat].name) })
          );
          pairStack.pop();
        } else {
          // 类别不匹配 → 改为当前应闭合类别的右符号
          replaceAt(i, PAIRS[top.cat].close, 'pair.type.fix',
            T("Paired symbol mismatch; expected to close {name}; replaced with right {name}", {
              name: tr(PAIRS[top.cat].name)
            })
          );
          pairStack.pop();
        }
      }
    }
  }
  // 不做补全插入；若末尾仍未闭合，交由用户人工处理
  return { fixed: chars.join(''), errors };
}

function runFormatCheck(text) {
  // === 读取“六个选项”（与 space-options.html 对齐） ===
  const addCjkEnSpace     = localStorage.getItem('opt_cjkEnSpace') === '1';     // 中文-英文
  const addCjkDigitSpace  = localStorage.getItem('opt_cjkDigitSpace') === '1';  // 中文-数字
  const addNumUnitSpace   = localStorage.getItem('opt_numUnitSpace') === '1';   // 数字-单位（字母单位，如 kg、m）
  const addNumSymbolSpace = localStorage.getItem('opt_numSymbolSpace') === '1'; // 数字-符号（%, °, ℃, ℉, ‰ 等）

  // 兼容旧聚合键（首次升级或未设置新键时兜底；后续可移除）
  const legacyCjkAgg = localStorage.getItem('opt_cjkAnSpace'); // 旧：中文-英/数 一把梭
  const legacyNumAgg = localStorage.getItem('opt_numUnitSpace_legacyAgg') ?? localStorage.getItem('opt_numUnitSpace'); // 旧：数字-单位/符号

  const useCjkEn    = (localStorage.getItem('opt_cjkEnSpace')     !== null) ? addCjkEnSpace     : (legacyCjkAgg === '1');
  const useCjkDigit = (localStorage.getItem('opt_cjkDigitSpace')  !== null) ? addCjkDigitSpace  : (legacyCjkAgg === '1');
  const useNumUnit  = (localStorage.getItem('opt_numUnitSpace')   !== null) ? addNumUnitSpace   : (legacyNumAgg === '1');
  const useNumSym   = (localStorage.getItem('opt_numSymbolSpace') !== null) ? addNumSymbolSpace : (legacyNumAgg === '1');

  // 半/全角（字母/数字）
  const alnumH2F = localStorage.getItem('opt_alnumHalfToFull') === '1'; // 半角 -> 全角
  const alnumF2H = localStorage.getItem('opt_alnumFullToHalf') === '1'; // 全角 -> 半角（两者都开则优先此项）

  const lines = text.split(/\r?\n/);
  const results = [];

  // —— 常量与工具 —— //
  const CJK = '[\\u3400-\\u4DBF\\u4E00-\\u9FFF\\u3007]'; // 基本汉字 + 扩展 + 〇
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 在“中文邻接处”把半角 X 转全角 Y（用于标点智能化）
  function boundaryHalfToFull(s, half, full) {
    const re1 = new RegExp(`(${CJK})\\s*${esc(half)}`, 'g'); // …中( → …中（
    const re2 = new RegExp(`${esc(half)}\\s*(${CJK})`, 'g'); // (中… → （中…
    return s.replace(re1, `$1${full}`).replace(re2, `${full}$1`);
  }

  for (let line of lines) {
    let fixed = line;
    const errors = [];

    // 0) 省略号规范化：任意连续点（.../......）或任意数量“…” → “……”
    const RE_ELLIPSIS = /(?:\.{3,}|…+)/g;
    if (RE_ELLIPSIS.test(fixed)) {
      fixed = fixed.replace(RE_ELLIPSIS, "……");
      errors.push({ message: tr("Ellipsis normalized to ……"), rule: "smartEllipsis" });
    }

    // 1) 引号/括号/书名号成对纠正（含直引号 " ' 的智能左右判定）
    {
      const r = normalizeQuotesAndPairs(fixed);
      if (r.fixed !== fixed) {
        fixed = r.fixed;
        r.errors.forEach(e => errors.push({ message: e.message, rule: e.rule }));
      }
    }

    // 2) 中英/中数间距（四项开关）
    // 2.1 中文 与 英文：添加/删除空格
    const zhLetter    = /([\u4e00-\u9fa5])([A-Za-z])/g;
    const letterZh    = /([A-Za-z])([\u4e00-\u9fa5])/g;
    const zhLetterSp  = /([\u4e00-\u9fa5])\s+([A-Za-z])/g;
    const letterZhSp  = /([A-Za-z])\s+([\u4e00-\u9fa5])/g;

    if (useCjkEn) {
      if (zhLetter.test(fixed) || letterZh.test(fixed)) {
        fixed = fixed.replace(zhLetter, "$1 $2").replace(letterZh, "$1 $2");
        errors.push({ message: tr("Per settings: added space between Chinese and Latin letters"), rule: "spaceBetweenMixedLang:add" });
      }
    } else {
      if (zhLetterSp.test(fixed) || letterZhSp.test(fixed)) {
        fixed = fixed.replace(zhLetterSp, "$1$2").replace(letterZhSp, "$1$2");
        errors.push({ message: tr("Per settings: removed spaces between Chinese and Latin letters"), rule: "spaceBetweenMixedLang:remove" });
      }
    }

    // 2.2 中文 与 数字：添加/删除空格
    const zhDigit     = /([\u4e00-\u9fa5])([0-9])/g;
    const digitZh     = /([0-9])([\u4e00-\u9fa5])/g;
    const zhDigitSp   = /([\u4e00-\u9fa5])\s+([0-9])/g;
    const digitZhSp   = /([0-9])\s+([\u4e00-\u9fa5])/g;

    if (useCjkDigit) {
      if (zhDigit.test(fixed) || digitZh.test(fixed)) {
        fixed = fixed.replace(zhDigit, "$1 $2").replace(digitZh, "$1 $2");
        errors.push({ message: tr("Per settings: added space between Chinese and digits"), rule: "spaceZhNum:add" });
      }
    } else {
      if (zhDigitSp.test(fixed) || digitZhSp.test(fixed)) {
        fixed = fixed.replace(zhDigitSp, "$1$2").replace(digitZhSp, "$1$2");
        errors.push({ message: tr("Per settings: removed spaces between Chinese and digits"), rule: "spaceZhNum:remove" });
      }
    }

    // 3) 数字 与 单位/符号间距
    // 3.1 单位（如 kg, m）
    if (useNumUnit) {
      const numUnit = /(\d)([A-Za-z]{1,4})(?![A-Za-z])/g; // 10kg -> 10 kg
      if (numUnit.test(fixed)) {
        fixed = fixed.replace(numUnit, "$1 $2");
        errors.push({ message: tr("Per settings: added space between numbers and units"), rule: "spaceNumUnit:add" });
      }
    } else {
      const rmUnit = /(\d)\s+([A-Za-z]{1,4})(?![A-Za-z])/g; // 10 kg -> 10kg
      if (rmUnit.test(fixed)) {
        fixed = fixed.replace(rmUnit, "$1$2");
        errors.push({ message: tr("Per settings: removed spaces between numbers and units"), rule: "spaceNumUnit:remove" });
      }
    }

    // 3.2 符号（%, °, ℃, ℉, ‰ 等）
    if (useNumSym) {
      const percentAdd = /(\d+)%/g;                 // 30% -> 30 %
      const degreeAdd  = /(\d+)([°℃℉‰])/g;         // 98℃ -> 98 ℃；12° -> 12 °
      if (percentAdd.test(fixed)) {
        fixed = fixed.replace(percentAdd, "$1 %");
        errors.push({ message: tr("Per settings: added a space before %"), rule: "spacePercent:add" });
      }
      if (degreeAdd.test(fixed)) {
        fixed = fixed.replace(degreeAdd, "$1 $2");
        errors.push({ message: tr("Per settings: added space between number and symbol"), rule: "spaceNumSymbol:add" });
      }
    } else {
      const rmPercent = /(\d+)\s+%/g;               // 30 % -> 30%
      const rmDegree  = /(\d+)\s+([°℃℉‰])/g;       // 98 ℃ -> 98℃；12 ° -> 12°
      if (rmPercent.test(fixed)) {
        fixed = fixed.replace(rmPercent, "$1%");
        errors.push({ message: tr("Per settings: removed the space before %"), rule: "spacePercent:remove" });
      }
      if (rmDegree.test(fixed)) {
        fixed = fixed.replace(rmDegree, "$1$2");
        errors.push({ message: tr("Per settings: removed space between number and symbol"), rule: "spaceNumSymbol:remove" });
      }
    }

    // 4) 中文邻接的半角标点 → 全角；破折号统一
    (function () {
      let before = fixed;

      const maps = [
        { half: '(', full: '（', label: 'Parentheses' },
        { half: ')', full: '）', label: 'Parentheses' },
        { half: '[', full: '［', label: 'Square brackets' },
        { half: ']', full: '］', label: 'Square brackets' },
        { half: '<', full: '《', label: 'Book title mark' },
        { half: '>', full: '》', label: 'Book title mark' },
        { half: '/', full: '／', label: 'Slash' },
        { half: ',', full: '，', label: 'Comma' },
        { half: '.', full: '。', label: 'Period' },
        { half: ';', full: '；', label: 'Semicolon' },
        { half: ':', full: '：', label: 'Colon' },
        { half: '!', full: '！', label: 'Exclamation mark' },
        { half: '\\?', full: '？', label: 'Question mark' }
      ];

        // 句号 . 避免影响网址/小数，暂不自动替换
    
      const changed = new Set();
      const CJK = '[\\u3400-\\u4DBF\\u4E00-\\u9FFF\\u3007]';
      const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      function boundaryHalfToFullLocal(str, half, full) {
        const r1 = new RegExp(`(${CJK})\\s*${esc(half)}`, 'g');
        const r2 = new RegExp(`${esc(half)}\\s*(${CJK})`, 'g');
        return str.replace(r1, `$1${full}`).replace(r2, `${full}$1`);
      }
      maps.forEach(({ half, full, label }) => {
        const prev = fixed;
        fixed = boundaryHalfToFullLocal(fixed, half, full);
        if (fixed !== prev) changed.add(label);
      });
      if (fixed !== before) {
        errors.push({
          message: T("Half-width punctuation next to CJK normalized to full-width ({list})", {
            list: Array.from(changed).map(x => tr(x)).join('、')
          }),
          rule: "punctNormalize:add"
        });

      }

      // 破折号统一：中文—中文之间，把 - / – / -- / —（有无空格）统一为“—”并去多余空格
      before = fixed;
      const reDash = /([\u3400-\u9FFF\u3007])\s*(?:--|—|–|-)\s*([\u3400-\u9FFF\u3007])/g;
      fixed = fixed.replace(reDash, '$1—$2');
      if (fixed !== before) {
        errors.push({ message: tr("Normalized em dash between CJK and removed extra spaces"), rule: "dashNormalize" });
      }
    })();

    // 5) 字母数字的半/全角转换（两者都选时优先“全角→半角”避免互相抵消）
    if (alnumF2H) {
      const reFW = /[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/g; // 全角 0-9 A-Z a-z
      if (reFW.test(fixed)) {
        fixed = fixed.replace(reFW, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
        errors.push({ message: tr("Converted full-width alphanumerics to half-width"), rule: "alnumFullToHalf" });
      }
    } else if (alnumH2F) {
      const reHW = /[0-9A-Za-z]/g; // 半角 0-9 A-Z a-z
      if (reHW.test(fixed)) {
        fixed = fixed.replace(reHW, ch => String.fromCharCode(ch.charCodeAt(0) + 0xFEE0));
        errors.push({ message: tr("Converted half-width alphanumerics to full-width"), rule: "alnumHalfToFull" });
      }
    }

    // a) 若空白夹在两个汉字之间：不保留任何空格（全删）
    const cjkInnerSpace = new RegExp(`(${CJK})[ \\u00A0\\u3000\\t]+(${CJK})`, 'g');
    if (cjkInnerSpace.test(fixed)) {
      fixed = fixed.replace(cjkInnerSpace, '$1$2');
      errors.push({
        message: tr("Removed spaces between consecutive Chinese characters"),
        rule: "cjkSpaceRemoved"
      });
    }

    // b) 其它位置的连续空白（普通空格、NBSP、全角空格、Tab）→ 单个半角空格
    const extraSpaces = /[ \u00A0\u3000\t]{2,}/g;
    if (extraSpaces.test(fixed)) {
      fixed = fixed.replace(extraSpaces, " ");
      errors.push({ message: tr("Collapsed consecutive spaces to a single space"), rule: "trimExtraSpaces" });
    }

    results.push({ original: line, fixed, errors });
  }

  return results;
}
