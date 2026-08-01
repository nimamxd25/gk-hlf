# 考公词汇 · 我的生词本（GitHub Pages 版）

一个**空白起步**的考公词汇 Anki 式记忆应用。做逻辑填空时遇到生词，加进你的生词本，系统按 SM-2 间隔重复算法帮你复习，直至掌握。

**没有任何内置词**——所有词语都是你自己收录的。

## 核心功能
- ➕ **添加生词**：做题遇词记下（词、释义、例句）
- 🎯 **今日学习**：每天 N 个新词，全屏大字卡片翻转记意思
- 🔁 **复习**：SM-2 间隔重复，到期自动提醒
- 📊 **统计**：待学 / 学习中 / 复习中 / 已掌握
- 📚 **搜索 / 词库**：模糊搜索已收录词语
- ⬆️⬇️ **导入导出**：词库与进度均可导出 JSON / 导入（换设备、同步用）
- 🎨 深色模式

## 数据存储与同步（GitHub 仓库）
- **词库数据**存在仓库的 **`words.json`** 文件里，它的内容就是你的词条列表。
- **学习进度**（每张卡的记忆次数/到期日/掌握度）存浏览器的 localStorage。
- 想把词库分享到多设备 / 多人 / 备份到仓库：
  1. 手机上「设置 → 导出词库 JSON」
  2. 把导出的 `words_我的生词.json` 内容合并/覆盖到仓库的 `words.json`
  3. `git add . && git commit -m "更新生词" && git push`
  4. 其他设备重新打开页面即加载最新词库（进度各自在本地保持）

`words.json` 格式：
```json
[
  { "word": "沆瀣一气", "meaning": "比喻臭味相投的人勾结在一起。", "examples": ["例句1", "例句2"] }
]
```

> 提示：因为词汇永久保存在你控制的 GitHub 仓库里，即使换手机/清浏览器，词库也不丢；进度可在「设置→导出进度」做整机备份。

## 部署到 GitHub Pages（一次性）
1. 在 GitHub 新建一个仓库（如 `shengci`），公开(Public)即可。
2. 把本目录下这些文件推上去：
   ```
   index.html  app.js  style.css  words.json  .github/
   ```
   可用命令行或网页上传所有文件（注意保留 `.github/workflows/pages.yml`）。
3. 仓库 **Settings → Pages** → Source 选 **GitHub Actions**。
4. 访问 `https://你的用户名.github.io/仓库名/` 即可使用。

- 之后**每次 push 更新 `words.json`**，GitHub Actions 会自动重新部署，几分钟内生效。
- 也支持 **File → Open** 直接本地打开 `index.html` 离线使用（此时词库从本地 words.json 读取，多设备同步改用导入导出）。

## 部署交互式说明
推送时若用命令行（电脑上先装 git）：
```bash
cd 项目目录
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/用户名/仓库名.git
git push -u origin main
```
