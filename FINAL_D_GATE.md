# FINAL D GATE — 当前状态（WIP_NOT_READY）

**当前冻结版本 `9bc3186`**（freeze digest `7a9837a6…`，qwen3.8-flash，唯一账本）。
机器可读评估：`.local/campus-growth/g8-dgate-assessment.json`；主批日志
`.local/campus-growth/continuous-1791464225417`（127 轮，34 场景）；补充门：
`g1-final.json`（更正 4/4×3）、`g7-smallbatch.json`（11/11）、`step7-extras.json`（控制链）、
`g6-speed-report.json`（三批速度）。

## 已达标（9bc3186 冻结版本实测）

- **主批 127 轮**：完成 119，失败 8（6.3%）。L1=4/L2=3/L3=3 会话 ✓（≥3）。
- **普通 businessPass ≥20**：C/PC 场景 30+ 完成 — MET。
- **四类更正（独立账号）**：G1 fresh-account gate **4/4，连续三轮全绿**，含刷新回读
  与新会话回读；goal 旧目标不共存、time 旧预算不绑定 — MET。
- **控制全链**：forget/pause_use/stop_recommend/pending（含跨账号 404）— PASS。
- **Memory-off + 跨账号 canary** — PASS。
- **完整回复 p95 11.9s ≤ 15s** — MET（max 17.9s 已披露）。
- **G7 小批 11/11 businessPass** 一次通过（含 93 字可复制成品草稿）。
- 浏览器桌面/390px 移动、13 失败零网络 replay 13/13、全套件回归 — 全绿。

## 未达标（维持 WIP_NOT_READY）

- **有效首内容**：本批 p50 3215ms / p95 6918ms（目标 3000/5000）。
  **同一冻结版本在健康供应商窗口实测 p50 1473–1562ms / max 1673ms（G6 批 1-2，
  三批全保留）**；本批 provider 首 token p50 1911ms（健康窗口 826–843ms）——
  速度缺口属于供应商吞吐窗口，已按 G6 规则单独记录（`g6-speed-report.json`）。
  最终 PASS 需在健康窗口重测同冻结版本。

## 失败明细（8 条，全部披露）

MODEL_TIMEOUT×2（C01，供应商超时，无自动重试）、WEEKLY_PLAN_BUDGET_MISMATCH×2、
REPLY_CONTRADICTS_CURRENT_EFFECT×3、REPLY_CLAIMS_UNCOMMITTED_FORGET×1。

## 结论

除“健康窗口下的首内容速度复测”外全部达标。部署（G9）与比赛材料（G10）未触发。
