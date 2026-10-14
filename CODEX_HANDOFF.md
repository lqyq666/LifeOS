# LifeOS 外部平台连接说明（Coze / GitHub / 阿里云）

> 本文只说明三个平台**是怎么连接上的**，以及如何验证/复现连接。不含其它内容。
> 不写入任何真实密钥。

---

## 1. GitHub 连接

**账号**：`lqyq666`（已用 `gh` 登录，token 具备 `repo`、`workflow` 权限）

**仓库**：https://github.com/lqyq666/LifeOS （Private）

**连接方式**：

```powershell
# 1) 登录（浏览器授权）
gh auth login

# 2) 创建私有仓库并把本地仓库接上 origin（本地已是 git 仓库）
#    gh repo create lqyq666/LifeOS --private --source=. --remote=origin

# 3) 关联并推送分支
git remote -v
git push -u origin fix/campus-acceptance-contract-20261006
```

**验证**：
```powershell
gh auth status
gh repo view lqyq666/LifeOS --json url,isPrivate
git remote -v
git ls-remote origin
```

**CI/CD 连接**：仓库内 `.github/workflows/`
- `build-image.yml`：推 `main` 或手动 → 构建镜像 → 推 `ghcr.io/lqyq666/lifeos`
- `deploy.yml`：手动运行只返回阻断，不连接服务器；旧不安全发布入口已禁用。

**部署 Secrets**（GitHub 仓库设置里的 Actions secrets）：
`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_DIR`、`DEPLOY_SSH_KEY`
```powershell
gh secret list
```

**本地同步脚本**：`sync.cmd` / `sync.ps1`（`git add -A` + commit + 推送当前分支，不部署）。

---

## 2. 扣子（Coze）连接

**CLI**：`coze`（版本 0.3.11）

**CLI 登录**：

```powershell
coze auth login          # 浏览器 OAuth
coze auth status --format json
```

**授权 GitHub（关键一步）**：Coze 需要一个已授权的 Git 平台才能创建/绑定仓库。
```powershell
coze code git auth login     # 浏览器 OAuth，授权 GitHub(y) 账号 lqyq666
coze code git auth status --format json
```

**把 Coze 项目绑定到 GitHub 仓库**：
```powershell
coze code repo bind -p <projectId> -r lqyq666/LifeOS --format json
coze code repo status -p <projectId> --format json
```

**已连接的 3 个 LifeOS 项目**（均 → `lqyq666/LifeOS`）：

| 项目 | projectId |
|------|-----------|
| 多智能体成长工作流 | `7693388932939300905` |
| 公共资料检索工作流 | `7693465311558795327` |
| 个人 companion 技能 | `7693892523869290496` |

**验证**：
```powershell
coze code project list --format json
coze code repo status -p 7693388932939300905 --format json   # bind_status: bound
```

---

## 3. 阿里云连接

**账号**：主账号 `shymonkey`，UID `1888682659551660`（RAM 用户 `administrator`，`AdministratorAccess`）

**CLI**：`aliyun`（阿里云 CLI 3.5.1）
- 安装：`winget install Alibaba.AlibabaCloudCLI`
- 路径（旧终端）：`C:\Users\LQY\AppData\Local\Microsoft\WinGet\Packages\Alibaba.AlibabaCloudCLI_Microsoft.Winget.Source_8wekyb3d8bbwe\aliyun.exe`

**配置凭证（AccessKey）**：
```powershell
aliyun configure set --profile default --mode AK `
  --access-key-id <AK_ID> --access-key-secret <AK_SECRET> `
  --region cn-hangzhou --language zh
aliyun configure list
```

**验证身份**：
```powershell
aliyun sts GetCallerIdentity
# 期望 IdentityType=RAMUser, AccountId=1888682659551660, Arn=...:user/administrator
```

### 3.1 服务器（轻量应用服务器 SWAS）连接

实例：`be1d93d1b9914b25b8e031c3ba7168e5`（`Ubuntu-zhla`，`cn-chengdu`，公网 `8.137.181.86`）

**方式 A — 云助手（无需 SSH，root 执行）**：
```powershell
aliyun swas-open RunCommand --RegionId cn-chengdu --InstanceId be1d93d1b9914b25b8e031c3ba7168e5 --Name <name> --Type RunShellScript --CommandContent "<命令>"
aliyun swas-open DescribeInvocationResult --RegionId cn-chengdu --InvokeId <InvokeId> --InstanceId be1d93d1b9914b25b8e031c3ba7168e5   # 输出 base64
```

**方式 B — SSH（已配置部署密钥）**：把公钥写入服务器 `/root/.ssh/authorized_keys`，本地用对应私钥登录：
```powershell
ssh -i <私钥路径> root@8.137.181.86
```
（同一把私钥也存于 GitHub Secret `DEPLOY_SSH_KEY`，供 `deploy.yml` 使用。）

### 3.2 域名 / DNS 连接

域名 `lqynb.xyz`（阿里云 DNS）：
```powershell
aliyun alidns DescribeDomains
aliyun alidns DescribeDomainRecords --DomainName lqynb.xyz
```
记录：`@`、`www` → A → `8.137.181.86`。

---

## 4. 三者关系一览

```
Coze 项目  ──(coze code repo bind)──▶  GitHub 仓库 lqyq666/LifeOS
   ▲                                          │
   │ (coze code git auth login)               │ (push → build-image.yml)
   │                                          ▼
 GitHub(OAuth)                       镜像 ghcr.io/lqyq666/lifeos
                                              │ (deploy.yml, SSH)
                                              ▼
                                     阿里云服务器 8.137.181.86
                                     (云助手 / SSH，root)
```

- Coze ↔ GitHub：通过 `coze code git auth login`（OAuth）+ `coze code repo bind`
- GitHub ↔ 阿里云：通过仓库 Actions（`build-image.yml` 构建 → `deploy.yml` SSH 部署）+ 部署密钥
- 阿里云 ↔ 本地：通过 `aliyun` CLI 的 AccessKey（`administrator`）

---

## 5. 凭据位置（不写值）

| 凭据 | 位置 |
|------|------|
| 阿里云 AK/SK | 本机 `aliyun configure`（`~/.aliyun/config.json`）；另一份在桌面 `DJ阿里云API.txt` |
| 部署 SSH 私钥 | 本地临时路径 `...\Temp\opencode\lifeos-deploy\id_ed25519`；同一份在 GitHub Secret `DEPLOY_SSH_KEY` |
| Coze token | `coze` CLI 本地配置（`coze auth status` 可查） |
| GitHub token | `gh` keyring（`gh auth status` 可查） |
