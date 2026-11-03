# TOEFL Practice · 新托福专项练习

包含两个本地练习工具，使用材料中的参考答案；训练设置不代表 ETS 官方完整考试。

## 阅读：补全单词

打开 `reading/index.html`，或下载 `downloads/TOEFL-Reading-SingleFile.zip`，解压后用现代 Edge / Chrome 打开其中唯一的 HTML。无需安装或联网。

- 625 个原始条目，按正文相似组去重为 432 篇，保留原 PDF 页码。
- 按收录次数由高到低、日期或原顺序练习；相同文章只刷一次。
- 逐词补全、持续下划线、Enter / Tab 切换、专项限时训练。
- 已完成标记、错词与重点词复习、收藏、记录导出与恢复。
- 异常空不参与自动判分。收录次数仅表示所提供 PDF 的重复次数。

## 听力：听后回应

需要 Python 3.10+。在终端执行：

```sh
cd listening
python3 server.py
```

Windows 可使用 `py -3 server.py`。浏览器打开 http://127.0.0.1:18765 。运行应用无需额外 Python 包；重新导入 PDF 才需要安装 `requirements.txt`。

257 套、2046 题，支持日常练习、限时挑战、错题复习和键盘作答。首次使用在“语音设置”填写自己的阿里云百炼 API Key；语音合成会使用该账号的额度。语音为 AI 合成，并非 ETS 原录音。详情见 [听力说明](listening/README.md)。

## 记录与备份

练习数据保存在使用者自己的浏览器；下载本仓库不包含任何人的练习记录。换浏览器、电脑或文件路径前，先从旧入口导出记录，再在新入口恢复。本仓库的代码发布不会迁移或清空现有浏览器记录。

API Key 保存在本机用户目录的配置文件中，不应提交到 GitHub。仓库忽略凭据、音频缓存、日志及练习备份。

## 测试

```sh
node --test tests/reading/*.test.js
node --test listening/tests/core.test.js
cd listening
python3 -m unittest discover -s tests
```

## 材料说明

题库和 PDF 来自提供的学习材料，保留原题与参考答案；不保证材料自述的真题来源或参考答案质量。仓库未对第三方材料重新授予许可。
