/**
 * keywords.js - Shared keyword extraction logic
 * 
 * Dùng chung cho setup.js, save-qa.js, save-recipe.js
 * Tránh duplicate regex patterns ở 3 nơi.
 */

const DOMAIN_PATTERNS = [
  /refactor/gi, /audit/gi, /debug/gi, /fix/gi, /create/gi,
  /service/gi, /controller/gi, /view/gi, /dto/gi, /constants/gi,
  /migration/gi, /hotfix/gi, /release/gi, /review/gi, /qa/gi,
  /UA/g, /BaseForm/g, /WinForm/gi, /DevExpress/gi,
  /parallel/gi, /performance/gi, /dependency/gi, /test/gi,
  /inventory/gi, /sales/gi, /production/gi, /inspection/gi,
  /report/gi, /attachment/gi, /module/gi, /feature/gi,
  /build/gi, /compile/gi, /commit/gi,
  /repository/gi, /model/gi, /event/gi, /helper/gi, /extension/gi, /component/gi, /usercontrol/gi
];

/**
 * Extract keywords từ text sử dụng domain-specific patterns
 * @param {string} text - Chuỗi text cần extract
 * @param {object} opts - { minWordLength: number, extraTokens: string[] }
 * @returns {string[]} - Mảng keywords unique
 */
function extractKeywords(text, opts = {}) {
  const minLen = opts.minWordLength || 3;
  const keywords = new Set();

  // Tách từ cơ bản
  text.split(/[\s,.\-_()]+/)
    .filter(w => w.length >= minLen)
    .forEach(w => keywords.add(w.toLowerCase()));

  // Domain-specific patterns
  DOMAIN_PATTERNS.forEach(p => {
    const matches = text.match(p);
    if (matches) matches.forEach(m => keywords.add(m.toLowerCase()));
  });

  // Extra tokens (từ tên file, skill, etc.)
  if (opts.extraTokens) {
    opts.extraTokens.forEach(t => {
      if (t && t.length >= minLen) keywords.add(t.toLowerCase());
    });
  }

  return [...keywords];
}

/**
 * Extract keywords từ name + description + content (cho setup indexing)
 */
function extractRegistryKeywords(name, description, content) {
  const nameTokens = name.split(/[-_]/).filter(w => w.length > 2);
  const searchText = `${name} ${description} ${content}`;
  return extractKeywords(searchText, { extraTokens: nameTokens });
}

// Tag inference rules based on question/answer content (Two-Level Tag System)
const TAG_RULES = [
  // Domains
  { match: /inventory|kho|stock|lot|material|nguyên.vật/i, tag: 'domain:inventory' },
  { match: /production|sản.xuất|job|schedule|bom|partlist/i, tag: 'domain:production' },
  { match: /sales|bán.hàng|packing|order/i, tag: 'domain:sales' },
  { match: /inspection|kiểm.tra|qc|quality|dipes/i, tag: 'domain:inspection' },
  { match: /handover|bàn.giao|chuyển.giao/i, tag: 'domain:handover' },
  { match: /tss|ticket|warranty|case/i, tag: 'domain:tss' },
  
  // Tech
  { match: /ua|universe\s*arch|thin.view|controller.deleg|service.layer/i, tag: 'tech:ua' },
  { match: /winform|xtraform|baseform/i, tag: 'tech:winforms' },
  { match: /devexpress|grid|gridview|gridcontrol|column|row/i, tag: 'tech:devexpress' },
  { match: /async|await|task|thread|queue|enqueue/i, tag: 'tech:async' },
  { match: /permission|quyền|security|phân.quyền|acl/i, tag: 'tech:permission' },
  
  // Pattern / Type
  { match: /bug|lỗi|fix|error|exception|crash/i, tag: 'type:bug' },
  { match: /refactor|modernize|migrate|upgrade/i, tag: 'type:refactor' },
  { match: /dto|data.transfer|model|viewmodel/i, tag: 'pattern:dto' },
  { match: /save|insert|update|delete|crud|submit/i, tag: 'pattern:crud' },
  { match: /architect|design|solid|pattern/i, tag: 'pattern:architecture' }
];

// Build lookup map tự động từ TAG_RULES: 'inventory' → 'domain:inventory'
// Khi thêm rule mới vào TAG_RULES là normalizeTags() tự cập nhật, không cần sửa thêm.
const TAG_LOOKUP = (() => {
  const map = new Map();
  for (const rule of TAG_RULES) {
    // rule.tag = 'domain:inventory', 'tech:winforms', ...
    const colonIdx = rule.tag.indexOf(':');
    if (colonIdx > 0) {
      const name = rule.tag.slice(colonIdx + 1).toLowerCase();
      if (!map.has(name)) map.set(name, rule.tag); // ưu tiên rule đầu tiên nếu trùng
    }
  }
  return map;
})();

/**
 * Normalize tags: tự động thêm prefix domain:/tech:/type:/pattern: nếu tag chưa có prefix.
 * VD: 'inventory' → 'domain:inventory', 'winforms' → 'tech:winforms', 'crud' → 'pattern:crud'
 * Tag đã có prefix (ví dụ 'domain:inventory') → giữ nguyên
 */
function normalizeTags(tags) {
  if (!tags || !Array.isArray(tags)) return [];
  return tags.map(t => {
    const tag = t.trim().toLowerCase();
    if (!tag) return null;
    if (tag.includes(':')) return tag; // Đã có prefix, giữ nguyên
    return TAG_LOOKUP.get(tag) || tag; // Look up từ TAG_RULES, fallback giữ nguyên
  }).filter(Boolean);
}

function inferTags(question, answer, currentTags) {
  const text = `${question} ${answer} ${(currentTags||[]).join(' ')}`.toLowerCase();
  const tags = new Set();
  
  for (const rule of TAG_RULES) {
    if (rule.match.test(text)) {
      tags.add(rule.tag);
    }
  }
  
  // Giữ lại tags gốc đã normalize (nếu không bị infer)
  const normalized = normalizeTags(currentTags || []);
  for (const t of normalized) tags.add(t);

  return [...tags].slice(0, 8);
}

module.exports = { extractKeywords, extractRegistryKeywords, DOMAIN_PATTERNS, TAG_RULES, inferTags, normalizeTags };
