// tests/autoiter-orchestrator-contract.test.js
// Grep-based 强制：防止 Section 0 + 裁定基准 + Stage 1 锚定 + Stage 4 不变式被重构误删
// 设计原则：只守 contract 骨架，不规定具体 stage 用什么 model（model 选择由主 agent 实时裁定）

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SKILL_PATH = path.join(__dirname, '..', 'skills', 'autoiter', 'SKILL.md');

test('Section 0 Orchestrator Contract 标题存在', () => {
  const content = fs.readFileSync(SKILL_PATH, 'utf8');
  assert.ok(
    /^## Section 0 — Orchestrator Contract/m.test(content),
    'Section 0 标题缺失'
  );
});

test('Section 0 含禁止标记（⛔ / ❌ / 禁止）', () => {
  const content = fs.readFileSync(SKILL_PATH, 'utf8');
  const section0Match = content.match(/## Section 0[\s\S]*?(?=^## )/m);
  assert.ok(section0Match, 'Section 0 不存在');
  assert.ok(
    /⛔|❌|禁止/.test(section0Match[0]),
    'Section 0 缺少禁止标记（防止改成软建议）'
  );
});

test('Section 0 含裁定基准引用（确保主 agent 能实时裁定 inline / dispatch + model）', () => {
  const content = fs.readFileSync(SKILL_PATH, 'utf8');
  const section0Match = content.match(/## Section 0[\s\S]*?(?=^## )/m);
  assert.ok(section0Match, 'Section 0 不存在');
  assert.ok(
    /裁定基准|派发策略|模型选择速查/.test(section0Match[0]),
    'Section 0 缺少裁定基准段 — 主 agent 失去实时裁定参考'
  );
});

test('Stage 1 Kickoff 含 TaskCreate 锚定指令', () => {
  const content = fs.readFileSync(SKILL_PATH, 'utf8');
  const kickoffMatch = content.match(/## Stage 1 — Kickoff[\s\S]{0,3000}?(?=^## Stage 2)/m);
  assert.ok(kickoffMatch, 'Stage 1 — Kickoff 章节未找到');
  assert.ok(
    /TaskCreate/.test(kickoffMatch[0]),
    'Stage 1 Kickoff 缺少 TaskCreate — stage TaskList 锚定可能被删'
  );
});

test('Stage 4 章节含 opus 关键字（历史不变式：Triage / Deep Verify 不可降级）', () => {
  const content = fs.readFileSync(SKILL_PATH, 'utf8');
  const stage4Match = content.match(/## Stage 4[ab]?[\s\S]{0,3000}?(?=^## Stage 5)/m);
  assert.ok(stage4Match, 'Stage 4 章节未找到');
  assert.ok(
    /opus/i.test(stage4Match[0]),
    'Stage 4 缺少 opus — Triage/Deep Verify 可能被误改为 inline 绕过 Section 0'
  );
});
