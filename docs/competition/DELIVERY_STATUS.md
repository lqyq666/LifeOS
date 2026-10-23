# LifeOS 参赛材料与链接状态

团队：见己实验室。核验日期：北京时间2026-10-23 16:45。

本次按最新要求只整理、核对和上传参赛材料及链接，不执行部署。首页可打开不等于核心功能验收完成。

| 入口 | 实际链接 | 核验与访问条件 |
| --- | --- | --- |
| 正式作品 | https://lqynb.xyz/ | HTTP 200，返回LifeOS网页；体验需要已开通账户 |
| 对话入口 | https://lqynb.xyz/#conversation | 同一正式站的对话页面；需登录和对话资格 |
| 版本查询 | https://lqynb.xyz/api/run/version | HTTP 200；本次读到a6dcfa145152cbd0c6682ad6c39547a3ee6fd242 |
| GitHub仓库 | https://github.com/lqyq666/LifeOS | PRIVATE，保留原可见性 |
| 参赛材料分支 | https://github.com/lqyq666/LifeOS/tree/competition/20261023 | 三份PDF、可编辑源文件及提交链接清单；需邀请 |

网站PDF路径尚不能取得本次真实材料，不作为可用下载地址。材料链接采用GitHub实际文件，见 [可复制提交链接清单](LINKS_READY_20261023.md)。

## 文件核对

| 材料 | 要求属性 | 文件与结果 | 当前状态 |
| --- | --- | --- | --- |
| 作品入口 | 必交；链接或≤1GB文件二选一 | 正式网址见上表 | 地址已核对；功能验收另行记录 |
| 产品设计 | 必交；PDF≤200MB，原则≤3000字 | LifeOS_Product_Design_20261023.pdf；179503字节；提取后2227个非空白字符，中文1798字 | 原件已整理并上传 |
| 使用说明与提交清单 | 辅助材料；未确认强制要求 | LifeOS_User_Guide_and_Submission_Checklist_20261023.pdf；5页A4 | PDF、Markdown与Python排版源已整理并上传 |
| 功能验证与效果佐证 | ≤200MB；已提供截图信息未明确必交 | LifeOS_Functional_Validation_Evidence_20261023.pdf；199002字节 | 原件已整理并上传 |
| 演示视频 | 必交；MP4≤200MB，3—5分钟，含团队名且无个人信息 | 尚未收到或找到可提交文件 | 待提供 |
| 评委访问 | 按实际需要 | 产品账户资格、GitHub邀请分别核对 | 由团队私下安排，不公开密码 |

要求属性依据本次任务文本，未独立核对原始规则截图。产品设计PDF保留88bd390 / final80口径；效果佐证PDF保留a12fd22 / final89口径。两份原件哈希一致，未改写历史结果，不自动证明当前正式站的全部功能。

final89历史首有效P50为3273.07ms、P95为8533.48ms，完整回复P95为17149.58ms，原指标均FAIL；不将其作为其他版本实测。真实学生长期效果尚未完成验收。

## 编辑与安全

编辑同目录Markdown后运行 `python build_user_guide.py`，生成PDF、HTML和SHA256清单。依赖ReportLab与中文TrueType字体，可通过LIFEOS_PDF_FONT指定字体；修改后检查仍为5页并逐页核对。

材料不含管理员凭据、API密钥、真实用户内容、数据库备份或原始费用账本。本次未向比赛平台最终提交。
