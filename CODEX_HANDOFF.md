# LifeOS 项目交接文档（致 Codex）

> 版本：2026-10-13 ｜ 交接来源：OpenCode 会话
> 目标读者：接手开发的 Codex Agent（以及未来的维护者）
> 本文是**教学式**文档：既说明现状，也给出可直接照做的命令。
>
> ⚠️ **本文不包含任何真实密钥**。凭据位置在第 9 节说明，请勿把密钥写进仓库。

---

## 0. TL;DR 快速上手

| 项目 | 值 |
|------|----|
| 本地项目根（生产代码） | `D:\aaaLife\LifeOS` |
| 工作区 | `D:\aaaLife` |
| 远端仓库 | https://github.com/lqyq666/LifeOS （**Private**） |
| 当前开发分支 | `fix/campus-acceptance-contract-20261006`（HEAD `1bd0d24`） |
| 生产服务器 | 阿里云轻量应用服务器 `8.137.181.86`（cn-chengdu） |
| 部署目录 | 服务器上 `/opt/lifeos`（Docker Compose 项目 `lifeos`） |
| 生产容器 | `lifeos-app-1`、`lifeos-db-1`（均 healthy） |
| 域名 | `lqynb.xyz`（阿里云 DNS；`@`、`www` → `8.137.181.86`） |
| CI 镜像 | `ghcr.io/lqyq666/lifeos`（推 main/手动触发构建） |
| 部署 | **手动**触发 GitHub Actions `deploy.yml` |
| 一键同步 | 双击 `D:\aaaLife\LifeOS\sync.cmd` |

**动手前必读**：先读项目根 `AGENTS.md` 和 `PRODUCT.md`。

---

## 1. 项目概况

LifeOS 是「校园成长与连续决策」的 AI 陪伴系统。核心能力（务必保持完整）：

- 校园个人伙伴（陪伴对话）
- 长期记忆（memory / growth / identity 多层）
- 成长星图（starmap）
- 扣子（Coze）接入（多工作流 / 多智能体）
- 多 Agent 协作
- 4 条工作流 + 5 个专业 Skill

技术栈：Node 24 + TypeScript（`tsx` 运行）+ 前端 Vite + PostgreSQL 17 + 本地离线 BGE embedding（`bge-small-zh-v1.5`）。生产用 Docker Compose 部署。

关键文档：
- `PRODUCT.md`：当前唯一产品目标（2026-10-05 重新定义）
- `AGENTS.md`：开发规则与红线
- `HANDOFF.md`：断点与进度（较大，历史信息多）
- `DEPLOYMENT_HANDOFF.md`：部署交接
- `deploy/README.md`：镜像构建与部署细节

---

## 2. 代码与分支

```
分支：
  fix/campus-acceptance-contract-20261006   ← 当前开发分支（已推送）
  main                                     ← 仅本地（未推送）
  fix/coach-material-boundaries-20261005   ← 仅本地
```

- 仓库历史曾被**重写清理**（剔除运行日志/验收证据），当前分支 366 提交。
- 为让生产镜像可构建，`Dockerfile` 依赖的 16 个 `evidence/...` **构建输入**已恢复提交（非密钥）。
- **本机仍有 7 个未提交改动（WIP）**，未提交、未丢弃，交接时保留：
  `DEPLOYMENT_HANDOFF.md`、`deploy/README.md`、`deploy/build-image.ps1`、`server/auth.ts`、
  `server/workflows/coze-direction-adapter.ts`、`tests/backend/password-reset-email.test.ts`、
  `tests/coze-direction-execution.test.ts`

查看状态：

```powershell
cd D:\aaaLife\LifeOS
git status -sb
git log --oneline -5
```

---

## 3. GitHub 连接与 CI/CD

### 3.1 基础

- 账号：`lqyq666`（`gh` 已登录，token 含 `repo`、`workflow`、`read:org`、`gist`）
- 仓库：https://github.com/lqyq666/LifeOS （Private）

```powershell
gh auth status
gh repo view lqyq666/LifeOS --json url,isPrivate
```

### 3.2 工作流（`.github/workflows/`）

**`build-image.yml`（构建镜像）**
- 触发：推 `main`，或手动（`workflow_dispatch`）
- 步骤：checkout → 准备离线 Python wheels（`deploy/lock-embedding.py`）→ 下载固定 BGE 模型（`scripts/setup-coach-embedding.py`）→ `docker build` → 推送到 `ghcr.io/lqyq666/lifeos`（`:latest` + `:<commit>`）
- **已实测成功**（run 38352541209）

**`deploy.yml`（部署到服务器，手动）**
- 触发：仅 `workflow_dispatch`（输入 `image_tag`，建议填某个 commit sha）
- 步骤：SSH 到服务器 → 拉镜像 → **备份数据库** → 切镜像并 `docker compose up -d` → 健康检查 `/api/ready` → 失败自动**回滚到上一镜像**
- 会**短暂重启 `lifeos-app`**

### 3.3 仓库 Secrets（部署用）

| Secret | 含义 |
|--------|------|
| `DEPLOY_HOST` | 服务器公网 IP |
| `DEPLOY_USER` | SSH 用户（`root`） |
| `DEPLOY_SSH_KEY` | 部署用 SSH 私钥（ed25519） |
| `DEPLOY_DIR` | `/opt/lifeos` |

```powershell
gh secret list
```

### 3.4 一键同步（不部署）

- 双击 `D:\aaaLife\LifeOS\sync.cmd`（或 `pwsh -File sync.ps1`）
- 行为：`git add -A` → 有改动就提交（默认 `sync: <时间>`）→ 推送**当前分支**
- **不部署、不动 main**；`.env` 类真实密钥文件会被**拒绝提交**
- 自定义消息：`sync.cmd "feat: xxx"`

> 注意：同步会把你当前的改动（含未提交 WIP）全部提交并推送。构建与同步已**解耦**——普通同步**不会**触发镜像构建（省 Actions 额度）。

---

## 4. 扣子（Coze）连接

### 4.1 账号与 CLI

- CLI：`coze`（版本 `0.3.11`），已登录（用户 `RootUser_2129409665`）。
- GitHub 已在 Coze 侧完成 OAuth 授权（`lqyq666`）。

```powershell
coze auth status --format json
coze code git auth status --format json
coze config list
```

### 4.2 已绑定到仓库的 Coze 项目

3 个 LifeOS 项目已 `bound` 到 `lqyq666/LifeOS`：

| 项目 | ID |
|------|----|
| 多智能体成长工作流 | `7693388932939300905` |
| 公共资料检索工作流 | `7693465311558795327` |
| 个人 companion 技能 | `7693892523869290496` |

查看绑定状态：

```powershell
coze code repo status -p 7693388932939300905 --format json
```

### 4.3 常用 Coze 命令（教学）

```powershell
# 列出项目
coze code project list --format json
# 给项目发需求（异步）
coze code message send "需求描述" -p <projectId>
coze code message status -p <projectId> --format json
# 预览 / 部署（部署须用户明确要求）
coze code preview <projectId>
coze code deploy <projectId>
# 远程仓库：创建 / 绑定 / 推送 / 拉取
coze code repo create -n <name> --private
coze code repo bind -p <projectId> -r lqyq666/<name>
coze code repo push -p <projectId>
coze code repo pull -p <projectId>
```

> `coze code` 多为**长任务**：不要前台干等，先交付再轮询（见技能文档）。

---

## 5. 阿里云连接

### 5.1 账号与凭证

- 主账号：`shymonkey`，UID `1888682659551660`
- 使用的 RAM 用户：`administrator`（绑定 `AdministratorAccess`，权限≈主账号）
- CLI：`aliyun`（版本 3.5.1，阿里云 CLI）
  - 新终端可直接用；旧终端 PATH 若没有，用完整路径：
    `C:\Users\LQY\AppData\Local\Microsoft\WinGet\Packages\Alibaba.AlibabaCloudCLI_Microsoft.Winget.Source_8wekyb3d8bbwe\aliyun.exe`
- 配置 profile：`default`，地域 `cn-hangzhou`，语言 `zh`

```powershell
aliyun configure list
aliyun sts GetCallerIdentity
```

### 5.2 服务器（轻量应用服务器 SWAS）

| 项 | 值 |
|----|----|
| 实例 ID | `be1d93d1b9914b25b8e031c3ba7168e5` |
| 名称 | `Ubuntu-zhla` |
| 地域 | `cn-chengdu`（成都） |
| 公网 IP | `8.137.181.86`（内网 `172.19.48.138`） |
| 系统 | Ubuntu 24.04，2 vCPU / 2 GB / 40 GB |
| 到期 | 2026-11-16 |
| 端口 | 22 / 80 / 443 开放 |

**访问方式一：SSH（推荐给 Codex）**
```powershell
ssh -i <部署私钥路径> root@8.137.181.86
```

**访问方式二：阿里云云助手（无需 SSH，root 执行）**
```powershell
aliyun swas-open RunCommand --RegionId cn-chengdu --InstanceId be1d93d1b9914b25b8e031c3ba7168e5 --Name <name> --Type RunShellScript --CommandContent "<shell 命令>"
# 取结果
aliyun swas-open DescribeInvocationResult --RegionId cn-chengdu --InvokeId <InvokeId> --InstanceId be1d93d1b9914b25b8e031c3ba7168e5
# 输出为 base64，需解码
```

> 提示：用云助手时，若命令含**双引号**，PowerShell 传参会被拆坏；尽量用单引号或避免双引号。

### 5.3 服务器上的部署布局

```
/opt/lifeos/
  compose.yaml              # Docker Compose 定义（项目名 lifeos）
  .env.production           # 生产密钥（勿提交，权限 600）
  backups/                  # 数据库备份
  evidence/qwen-default/    # 挂载到容器 /app-evidence
  releases/<id>/            # 每次发布的 override + 构建产物
```

- 运行容器：`lifeos-app-1`（app，监听 `127.0.0.1:8787`）、`lifeos-db-1`（Postgres 17）
- 反向代理：nginx（80/443）
- 另有一台同机服务：`python` 进程监听 `8001`（海闻服务，**勿动**）

常见排查：
```bash
docker ps
docker logs --tail 100 lifeos-app-1
docker compose -f /opt/lifeos/compose.yaml ps
curl -s http://127.0.0.1:8787/api/ready
```

### 5.4 域名 / DNS

- 域名 `lqynb.xyz` 托管在阿里云 DNS（DomainId `992aba167b7f41b78b4a41f0b695f199`）
- 记录：`@` 和 `www` → A → `8.137.181.86`

```powershell
aliyun alidns DescribeDomainRecords --DomainName lqynb.xyz
```

> 注意：`DEPLOYMENT_HANDOFF.md` 旧文写“DNS 由 Cloudflare 管理”，**实际在阿里云 DNS**。

---

## 6. 部署流程（完整）

### 6.1 构建镜像（CI）

推送到 `main` 或手动触发 `build-image.yml` → 产出 `ghcr.io/lqyq666/lifeos:<sha>`。

### 6.2 部署（CD，手动）

1. 确定要上线的 commit sha（= 镜像 tag）
2. 触发部署：
   - 浏览器：GitHub → Actions → **Deploy to server** → Run workflow → `image_tag = <sha 或 latest>`
   - 或命令行：
     ```powershell
     gh workflow run deploy.yml -f image_tag=<sha>
     gh run watch
     ```
3. 部署脚本会自动：备份 DB → 拉镜像 → 切换 → 健康检查 → 失败回滚

### 6.3 首次从源码构建的依赖

`Dockerfile` 需要：
- `.local/docker-embedding/wheels`（由 `python deploy/lock-embedding.py` 在 Linux 上下载生成）
- `.local/models/bge-small-zh-v1.5`（由 `python scripts/setup-coach-embedding.py` 从 HuggingFace 固定版本下载）
- 16 个已恢复的 `evidence/...` 构建输入

---

## 7. 计费与用量（截至 2026-10-13）

- 账户余额：**¥94.78**
- 本月（10 月）已消费：**¥15.22**，**全部来自“百炼”大模型推理**
  - 模型：`qwen3.8-flash`（主力）、`deepseek-v4.1-flash`（极少），另有少量 `qwen3.8-max` / `qwen3.7-plus`（历史）
  - token（账单口径）：输入 ~976 万 / 输出 ~244 万 / 缓存 ~828 万
  - 调用次数：本地开发账本记录 **3,431 次**（10/04–10/12）；含生产后总量级约 **4,000–5,500 次**
- 云效（Aliyun DevOps）：**已 0 元按量开通，无实例、无扣费**；本项目**未使用云效**，CI/CD 走 GitHub Actions（免费）

查询：
```powershell
aliyun bssopenapi QueryAccountBalance
aliyun bssopenapi DescribeInstanceBill --BillingCycle 2026-10 --Granularity MONTHLY --ProductCode sfm
```

---

## 8. 规则与红线（摘自 AGENTS.md，务必遵守）

- **凭据、私有环境、数据库备份、Provider 原始账本不提交**。
- 唯一付费账本：`D:\aaaLife\LifeOS\.local\v1.3-action-coach\paid\provider-calls.json`；沿用同一账本，不复制/重置/自动重试收费请求。
- 后端测试必须经**隔离运行器**运行。
- **不擅自 push、不擅自合并 main**。新付费账号/额度、持久凭证、不可逆删除、DNS/账号安全变更需另行确认。
- 生产数据、云资源、DNS 的写入，只在账号所有者授权后执行；先备份、能回滚。
- 开发新模块优先在 GitHub 找成熟开源实现复用，保留许可证与来源记录。
- 每批通过检查后可本地提交；完整验收通过后才发布。

---

## 9. 凭据位置（不在本文写值）

| 凭据 | 位置 |
|------|------|
| 阿里云 AK/SK | 本机 `aliyun configure`（`~/.aliyun/config.json`）；另有一份在桌面 `DJ阿里云API.txt` |
| RAM 控制台登录密码 | 桌面 `DJ阿里云API.txt`（用户名 `administrator@1888682659551660.onaliyun.com`） |
| 部署 SSH 私钥 | `C:\Users\LQY\AppData\Local\Temp\opencode\lifeos-deploy\id_ed25519`；同一份也在 GitHub Secret `DEPLOY_SSH_KEY` |
| Coze 登录 token | `coze` CLI 本地配置（`coze auth status` 可查） |
| GitHub 登录 | `gh auth status`（keyring） |
| 生产 `.env.production` | 服务器 `/opt/lifeos/.env.production`（勿下载进仓库） |

> ⚠️ 临时目录的 SSH 私钥可能被清理。若丢失，可登录服务器用云助手往 `/root/.ssh/authorized_keys` 重新加新公钥。

---

## 10. 备份与回滚

- 历史清理前完整备份：`D:\aaaLife\_lifeos_cleanup_backup_20261013-130928\`
  - `LifeOS-full-*.bundle`（含重写前的全部历史）
  - `wip-*.patch` 及 `wip-files/`（7 个未提交改动副本）
  - `remove-paths.txt`（被清理的 1178 个路径清单）
- 服务器数据库备份：`/opt/lifeos/backups/`
- 回滚部署：服务器每个 release 有 override，可指定旧镜像 tag 重新 `deploy.yml`

---

## 11. 常见任务操作手册（教学）

### 11.1 本地改代码 → 同步
```powershell
cd D:\aaaLife\LifeOS
# ...改代码、跑测试...
.\sync.cmd "feat: 你的改动说明"     # 提交并推送到当前分支（不部署）
```

### 11.2 上线（构建 + 部署）
```powershell
# 1) 确保要发布的提交已在远端（sync 或 git push）
# 2) 构建镜像（若不在 main 上，走手动）
gh workflow run build-image.yml --ref fix/campus-acceptance-contract-20261006
# 3) 记录镜像 tag（= 提交 sha）
git rev-parse HEAD
# 4) 部署
gh workflow run deploy.yml -f image_tag=<sha>
gh run watch
# 5) 验证
curl -s https://lqynb.xyz/api/ready
```

### 11.3 服务器排查
```powershell
ssh -i <key> root@8.137.181.86 "docker ps; docker logs --tail 50 lifeos-app-1"
```

### 11.4 看 Coze 项目状态
```powershell
coze code project list --format json
coze code repo status -p <projectId> --format json
```

---

## 12. 已知问题 / 待办

1. **7 个未提交改动**尚未处理（见第 2 节）；Codex 接手后请先确认它们是「进行中的开发」还是废弃改动。
2. `main` 与 `fix/coach-material-boundaries-20261005` **尚未推送到远端**（仅本地）。
3. `deploy.yml` 为**手动**触发；如需「推 main 自动构建 + 自动部署」，需另行配置（注意生产安全，需备份+回滚就绪）。
4. 云效（Aliyun DevOps）未使用；如未来启用，需在控制台完成组织创建（当前被购买页禁用按钮拦住，本项目已绕开）。
5. 阿里云 `administrator` 用了 `AdministratorAccess`（权限过大）；长期建议改为**最小权限** RAM 用户（仅云效/部署/所需资源）。
6. 桌面 `DJ阿里云API.txt` 明文存有 AK/SK 与控制台密码，建议轮换并妥善保管。
7. 百炼控制台「用量统计」页在无头浏览器渲染不出，精确**调用次数**需人工在控制台核对。

---

*（本文由 OpenCode 会话生成，供 Codex 接手使用。）*
