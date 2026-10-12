# 邮箱找回密码

沿用 Better Auth 1.7.7 的令牌生成、到期校验与原子消费；不引入第二套认证。
邮件传输复用 Nodemailer 10.1.0（MIT-0）；协议验收复用其官方 SMTP Server
3.19.21（仅 devDependency、MIT-0）。来源和免费套餐核验见下列官方文档。

## 用户流程

登录页「忘记密码」→ 输入注册邮箱 → 查看邮件 → 打开链接 → 设置新密码 → 重新登录。
是否注册使用相同的申请成功文案；不提供查询令牌接口。邮件链接固定返回本产品的
`/#reset?token=...`，令牌只在 URL fragment 中，不进入 HTTP 请求与访问日志；进入页面后
再从地址栏移除。链接有效 15 分钟、仅能消费一次，成功后撤销
该用户已有会话及其他待用重置链接。密码长度 12–128 字符。

## 免费服务配置

本轮选择 Resend Free；不添加付款方式、不升级、不启用 Transactional Overages。
发件地址拟用 `noreply@mail.lqynb.xyz`，需要仅针对 `mail.lqynb.xyz` 的域名验证。
SMTP Host `smtp.resend.com`、端口 `465`、用户名 `resend`；密码为限定该发信域的
Sending access API key。只写服务器私有环境文件，不能进入源码、日志或浏览器本地存储。
具体变量见 `.env.production.example`。配置完整并设置
`LIFEOS_PASSWORD_RESET_ENABLED=true` 才展示可用状态，否则返回 503。

## 持久化边界与恢复

迁移 035 仅新增 `lifeos_password_reset_deliveries`，旧业务代码不会读取该表。
但旧版本的 `verifySchema` 会拒绝更新的迁移清单；回滚容器必须只读挂载本轮精确
034/035/036 迁移文件，使其校验对应的真实数据库。不能直接裸启动旧镜像，也不能删除
预留表、运营记录或迁移回执来绕过校验。发布前在私有恢复库验证该容器组合能启动。
PG 事务锁串行登记 SMTP 尝试：最多 80 封/滚动 24 小时、900 封/滚动 31 天；
同一邮箱每小时最多 3 封，间隔至少 60 秒。记录 HMAC 摘要，不存邮箱或邮件令牌。
保留失败/结果未知预留，不自动重发；重启和回滚仍使用同一个主库，不能退款式清空表。
这只是本应用的限额；Resend 控制台须同时维持 Free 和关闭付费超额，其他发信应用
也可能共享服务额度。

发信复用现有 RequestScheduler，最多并发 2 封、等候 80 封，关机取消尚未开始的排队任务；
只有开始实际投递的任务登记 PG 预留，活动任务与其他服务清理同时收尾，超时仍保留未知。
非 loopback SMTP 强制 TLS。邮件连接和空闲均设超时，不在错误日志输出 SMTP 原始
内容或凭据；发送失败使用通用响应和不含个人信息的后台诊断。
认证库只记录 error，避免「邮箱不存在」警告与请求日志时间关联。
发布前保留原镜像、完整 PG 备份及环境文件恢复路径。回滚关闭邮件开关、恢复旧镜像，
保留新的预留表、迁移回执和所有运营记录，并保留三份只读迁移挂载。
工作流的 prepared/started 边界在原花费账本中持久化；仅有未派发证据的 prepared
预留可释放，旧 NULL 或已跨过 started 的费用继续保留，不能用换镜像清空。

## 验收

`npm run test:backend -- --file=password-reset-email.test.ts --file=production-reset-boundary.test.ts`
在隔离 PostgreSQL 和真实 loopback SMTP 协议验证申请、收信、跳转、过期、并发单次消费、
旧会话退出、邮箱存在性响应、跳转限制、限流、共享发信上限与重启式重复请求。
这些不证明公网投递；上线后另需服务商投递状态及账号本人确认收信。

## sources

- https://github.com/nodemailer/nodemailer — SMTP、TLS、邮件编码复用，省去自建协议层。
- https://github.com/nodemailer/smtp-server — 独立 SMTP 协议接收端，省去测试伪服务器。
- https://nodemailer.com/smtp — TLS、超时、日志与内容访问配置。
- https://better-auth.com/docs/authentication/email-password — 原有找回密码 API 与邮件回调。
- https://resend.com/pricing — 长期 Free、每日 100 封、付费超额须主动启用；2026-10-12 核验。
- https://resend.com/docs/send-with-smtp — SMTP 设置。
- https://help.aliyun.com/zh/direct-mail/level — 一次性 2,000 封免费额度，未作为长期免费首选。

状态必须分别记录代码修改、本地协议验收、构建、部署、公网投递和本人验收。
