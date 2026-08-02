# 考公词汇 · 我的生词本（GitHub 自动同步版）

一个**空白起步**的考公词汇 Anki 式记忆应用。做逻辑填空遇到生词，加进生词本，系统按 SM-2 间隔重复算法复习，**学习数据和进度全自动同步到你的私有 GitHub 仓库**。

**没有任何内置词**——所有词语都是你自己收录的。

## 核心功能
- ➕ **添加生词**：做题遇词记下（词、释义、例句）
- 🎯 **今日学习**：每天 N 个新词，全屏大字卡片翻转记忆
- 🔁 **复习**：SM-2 间隔重复，到期自动提醒
- 📊 **统计**：待学 / 学习中 / 复习中 / 已掌握
- ☁️ **自动同步**：生词 + 学习进度自动写入 GitHub 私有仓库（无需手动）

## 自动同步（重点）
- 在 **设置 → GitHub 自动同步** 填一次：用户名、仓库名、分支、GitHub Token。
- 之后**添加生词**和**完成一组学习**时，自动把数据写回仓库：
  - `words.json`：你的生词库
  - `progress.json`：学习进度（记忆次数/到期日/掌握度）
- 换设备登录时，**启动自动拉取**远端数据合并到本地，学习不断档。

### Token 说明（安全）
- 用 GitHub **Fine-grained Token**，权限只给**那一个私有仓库**、`Contents: Read and write`。
- Token **只存在你的浏览器 localStorage**，绝不写进仓库代码（`.gitignore` 已排除）。即使 token 泄露，也仅限于编辑该一个仓库，风险范围很小。

### 如何生成 Fine-grained Token
1. GitHub → 头像 → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**
2. 有效期建议较长（如 90 天或自定义）
3. **Repository access** → `Only select repositories` → 选你的私有仓库
4. **Repository permissions** → **Contents** → **Read and write**
5. 生成后复制 `github_pat_...` 填入应用设置。

## 部署到 GitHub Pages（让手机浏览器能打开）
仓库文件已就绪在 `main` 分支。启用方式：
1. 仓库 **Settings → Pages**
2. **Source** 选 **Deploy from a branch**
3. **Branch** 选 `main`，`/ (root)`
4. Save，等 1~2 分钟，访问 `https://您用户名.github.io/仓库名/`

> 私有仓库的 Pages 站点有访问控制：需登录有权限的 GitHub 账号访问；若希望免登录公开访问，需把仓库设为 **Public**（数据中的生词会公开，请自行权衡）。

## 开源部署 / 本地离线使用
- 也可直接用浏览器打开本地 `index.html`（完全离线），此时词库读本地 `words.json`。
- 自动同步依赖 GitHub，离线模式下用「设置 → 导出/导入」做备份。

## 仓库文件
- `index.html` / `app.js` / `style.css` — 应用
- `words.json` — 你的生词库（自动同步）
- `progress.json` — 学习进度（自动同步，运行时生成，无需手动创建）
- `README.md` — 本说明
