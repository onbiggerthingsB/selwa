# 中国大陆访问测试指南（手机即可完成）

## 关于这个项目

这是一个**学生研究项目**，不是商业产品，未公开发布，目前仅为私下部署。测试的应用是一个手机网页：拍下一张中文医院化验单，应用逐行用通俗语言解释各项指标。

## 为什么需要这次测试

这个网页应用部署在美国 Vercel 平台（服务器固定在美国华盛顿特区 iad1 区域）。Vercel 官方说明其在中国大陆没有基础设施，*.vercel.app 域名在大陆可能被限速或屏蔽。**至今没有任何人测试过目标用户是否能打开这个应用。** 如果打不开，其他一切功能都没有意义。您的测试结果，决定这个项目接下来的方向。

**测试总量：共 20 次完整流程**，分布在至少两种网络和至少两部手机上（具体安排见下文"开始前的准备"）。不必一次做完，可分几次进行。

## 判定标准（测试开始前预先约定，之后不改）

**20 次完整测试中至少 18 次成功，才算通过。**（一次"完整测试"= 从打开网页到看到解释页面的全过程。）

## 隐私提醒（重要）

**请勿使用任何真实患者的化验单。** 测试照片必须是您本人自己的报告，或一张打印的样例。请知悉：照片会被发送到位于美国的服务器（这是一个未公开发布的学生研究项目，见上文）。

## 开始前的准备

1. **关闭所有 VPN / 翻墙软件。** 开着 VPN 测出来的结果全部作废。
2. 使用**全新的浏览器环境**：用浏览器的"无痕/隐私模式"，或先清除该网站的缓存。缓存过的页面不算数——必须是全新加载。
3. **测试计划（20 次是这样凑出来的）**：准备至少**两种普通大陆网络**（例如家里的宽带 Wi-Fi + 手机流量，最好是不同运营商）和**至少两部手机**。两种网络 × 两部手机 = 4 种组合，**每种组合各完成 5 次完整测试**，合计 4 × 5 = 20 次。如果网络或手机多于两种，平均分配、总数凑满 20 次即可。

## 测试步骤（共5步，按上面的测试计划重复，合计 20 次完整流程）

**测试地址：** https://health-translator-sooty.vercel.app

**第1步：打开网页。** 在浏览器无痕模式中输入上面的地址。
- ✅ 通过：页面正常显示，能看到"Health Translator"和中文文字。
- ❌ 失败时记录：屏幕上显示什么（空白？错误提示？转圈？），等了多少秒。

**第2步：同意知情提示。** 页面会出现一个知情同意的提示，点击同意。
- ✅ 通过：提示正常出现，点击后能继续。
- ❌ 失败时记录：提示是否出现、点击后发生了什么。

**第3步：拍照或上传化验单**（用您自己的或打印样例，见隐私提醒）。
- ✅ 通过：照片成功上传，页面显示正在读取。
- ❌ 失败时记录：卡在哪一刻、屏幕显示什么、等了多久。

**第4步：等待读取结果。** 上传后等待，应出现一个列出所读到各行内容的页面。
- ✅ 通过：出现列出化验单各行的页面。
- ❌ 失败时记录：等了多少秒、最后屏幕停在什么画面。

**第5步：进入解释页面。** 在列出各行内容的页面上，点击页面上用于继续的按钮（"继续"或"下一步"字样），应看到逐行解释的页面。
- ✅ 通过：解释页面正常显示。
- ❌ 失败时记录：显示到哪一步、缺了什么；如果页面上找不到任何可以点击继续的按钮，也算失败，请写明。

**特别说明（以下都是正常表现，请勿当作故障上报）：**
- 访问 https://health-translator-sooty.vercel.app/advice 看到"页面不存在 / 404"，是正确的、预期中的表现（该功能已被有意停用）。
- 如果在任何环节看到代码 **410**（提示 advice 功能已停用）或 **403**（未通过知情同意时请求被拒绝），这同样是系统按设计正常工作，不是故障。

## 结果表（请复制填写后发回）

```
测试人：＿＿＿  日期：＿＿＿

| 序号 | 时间 | 手机型号 | 网络(运营商/宽带) | 走到第几步 | 成功? | 失败详情(屏幕内容/等待秒数) |
|-----|------|---------|-----------------|-----------|------|--------------------------|
| 1   |      |         |                 |           |      |                          |
| 2   |      |         |                 |           |      |                          |
| 3   |      |         |                 |           |      |                          |
| ... |      |         |                 |           |      |                          |
| 20  |      |         |                 |           |      |                          |

汇总：成功 ＿＿ / 20 （通过线：18/20）
```

## 可选：给会用命令行的测试者

如果您会用电脑终端，请在**未开 VPN** 的大陆网络下运行以下命令，并记录返回的状态码。（前两条用 GET 请求，与今日实际核实过的请求方式一致。）

```bash
# 预期输出 200
curl -sS -o /dev/null -w '%{http_code}\n' https://health-translator-sooty.vercel.app/

# 预期输出 404（该功能已停用，404 是正确表现）
curl -sS -o /dev/null -w '%{http_code}\n' https://health-translator-sooty.vercel.app/advice

# 预期 410，返回 {"error":"Advice feature disabled"}
curl -i -X POST https://health-translator-sooty.vercel.app/api/advice

# 预期 403（未带同意标头时，同意门禁正常工作）
curl -i -X POST https://health-translator-sooty.vercel.app/api/extract
```

任何与预期不符的状态码、超时或连接重置，请连同大致耗时一起记下。

---

# English Equivalent (for reference)

## About the project

This is a **student research project**, not a commercial product. It is privately deployed and has never been publicly launched. The app being tested is a phone web app that explains each row of a Chinese hospital lab report in plain language.

## Why this matters

The app is hosted on Vercel, pinned to region iad1 (Washington DC, USA). Vercel states it has no mainland-China infrastructure and that *.vercel.app may be throttled or blocked there. Nobody has ever tested whether the intended users can load the app at all. If they cannot, no feature work matters.

Total scope: **20 complete sessions**, spread across at least two networks and at least two phones (run plan below). They need not be done in one sitting.

## Pre-registered pass rule (fixed before seeing any results)

**At least 18 of 20 complete sessions must succeed.** (A complete session = from opening the site to seeing the explanation screen.)

## Privacy warning

Testers must NOT use a real patient's report. Any lab report photo must be one the tester owns, or a printed sample. The photo is sent to a US server (this is an unlaunched student research project — see above).

## Before starting

1. No VPN — a VPN invalidates the entire test.
2. Fresh browser (incognito/private mode, or cleared cache). A cached PWA shell is not evidence — it must be a fresh load.
3. Run plan (how 20 sessions are assembled): at least two ordinary mainland networks (e.g. home broadband + mobile data, ideally different carriers) and at least two phones. 2 networks × 2 phones = 4 combinations; run **5 sessions per combination**, 4 × 5 = 20. With more networks or phones, distribute evenly to a total of 20.

## The five steps

Test URL: https://health-translator-sooty.vercel.app

1. **Open the site** in incognito. PASS: page renders, shows "Health Translator" and Chinese copy. On failure record what was on screen and how long it hung.
2. **Agree to the consent notice.** PASS: the notice appears and tapping through works. On failure record whether it appeared and what happened.
3. **Photograph or upload a lab report** (own/sample only). PASS: upload completes and reading begins. On failure record the exact step, screen contents, wait time.
4. **Wait for the read.** PASS: a screen appears listing the rows that were read. On failure record wait time and where it stopped.
5. **Explanation screen.** On the screen listing the rows, tap the continue/next button to proceed to the per-row explanations. PASS: explanations render. On failure record how far it got; if no button to continue is visible, count that as a failure and say so.

Notes for testers — all of the following are CORRECT, expected behavior; do not report them as bugs: /advice returning "page not found" (404) is a deliberately disabled feature; a code **410** (advice feature disabled) or **403** (request rejected without consent) at any point is the system working as designed.

## Results table

Same columns as the Chinese version: session #, time, phone model, network/carrier, furthest step reached, pass?, failure details (screen contents / seconds hung). Summary line: successes out of 20, pass line 18/20.

## Optional technical checks (verified from outside China today, so this is what "working" looks like — the first two are GET requests, matching how they were verified)

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://health-translator-sooty.vercel.app/
# expect 200

curl -sS -o /dev/null -w '%{http_code}\n' https://health-translator-sooty.vercel.app/advice
# expect 404 (disabled feature; correct)

curl -i -X POST https://health-translator-sooty.vercel.app/api/advice
# expect 410 {"error":"Advice feature disabled"}

curl -i -X POST https://health-translator-sooty.vercel.app/api/extract
# expect 403 (consent gate working correctly — no consent header sent)
```

Record any status code that differs, plus timeouts or connection resets with approximate duration.
