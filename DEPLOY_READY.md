# DEPLOY READY — 条件就绪（冻结 9bc3186）

## Gate 状态

全部业务 Gate 通过（普通≥20、L1-3≥3会话、memory-off、四类更正 4/4×3、控制全链、
UI 桌面/移动、Coze/Skill、完整回复 p95 11.9s）。速度在健康供应商窗口达标
（p50 1.3s/p95 4.8s，4 批中 3 批健康），供应商窗口崩塌时不达标——运营风险已量化
（FINAL_PERFORMANCE.md），建议部署后监控 raw 首 token p50。

## 部署前清单（执行时逐项打勾）

1. 生产 DB 备份（pg_dump 全量 + 保留回滚点）
2. 保存当前 production image/tag
3. 核对迁移 001–022 与生产已应用集合（新增 021/022 需在生产执行）
4. 回滚方案：image 回退 + DB 恢复点，先演练读取
5. 生产 env 安全摘要（不含密钥明文）
6. 部署新 image → 迁移 → smoke

## Smoke 清单（任一关键失败立即回滚）

login/auth、invite/entitlement、账户隔离、普通聊天、memory on/off、更正、
memory control、growth workspace、desktop/mobile 390px、Skill、Coze。

## 状态

**准备就绪，等待账号所有者确认执行窗口**（生产写入按 PRODUCT.md 授权条款需
账号所有者授予目标权限后执行；本轮未做任何生产变更）。
