# LifeOS 工作流本地候选源码包
这是当前工作区可运行源码快照，包含原有未提交evergreen/Coze工作以及本轮候选，不是已发布产品。
先读 .planning/research/agent-workflows/AGENT_WORKFLOW_FINAL_GATE.md 和 SOURCE_MANIFEST.json。
解压到新目录，使用Node与package-lock匹配环境执行npm ci；依赖安装不是本轮已执行或收费授权。无需网络的本地演示：npx tsx scripts/workflow-demo.ts。
隔离PG验证：提供仓库现有本地PG/认证配置后运行 scripts/workflow-verify.ps1。不要把生产DB作为测试目标。实际配置不在包内。
LIFEOS_ADVANCED_WORKFLOWS默认关闭；本轮不修改.env。真实深度Provider尚未启用；任何生产部署都未执行。
旧13回放还依赖本机已保存合成快照/报告/.local输入，不附私人库或付费账本；缺资源将NOT_TESTED。
包外SHA256在DELIVERY_PACKAGE.json，包内BUNDLE_MANIFEST.json可验证每一文件；集成补丁相对已验证原evergreen检查点。
