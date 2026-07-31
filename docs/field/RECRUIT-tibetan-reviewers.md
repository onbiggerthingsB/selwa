# 诚邀藏文医学翻译与审校人员（学生研究项目）

## 我们在做什么

**health-translator** 是一个手机网页应用：用户拍下一张中文医院化验单，应用逐行用通俗语言解释每一项指标的含义。它服务的对象是拿着看不懂的中文化验单的人——老年患者、汉语读写能力较弱的人，以及照顾他们的家人。2026年7月22日在拉萨的实地调研发现，最迫切的需求正是"看懂手里这张中文报告"。

安全底线（写进了代码，不是口号）：人工智能**只做文字识别**（读出纸上印的字）；所有**含义**都来自一张人工编纂、人工审定的对照表；应用绝不输出任何无法与纸面原文核对的内容，也**绝不做诊断**。

请了解：这是一个**学生研究项目**，不是商业产品，未公开发布。项目已私下部署，有 1184 项自动化测试，代码库目前为私有。

## 为什么应用里现在一个藏文字都没有

这是刻意的决定，不是疏漏。应用目前发布的藏文字符串数量为**零**，原因是：机器翻译的藏文**无法验证**——

- 藏文目前没有 COMET 类自动质量评测指标；
- 医疗领域汉译藏的 d-BLEU 大约只有 **9.4**；
- TLUE 基准（EMNLP 2025）发现：Claude 的藏文输出 BLEU 达到 34.8，看似流畅，但藏文专家只认可了其中 **28.74%**——"流畅但错误"。在医疗场景下，这比什么都不显示更危险。

但同一项 TLUE 研究也给了我们方向：固定的基准内容经过**两轮人工修订**后，可接受率达到了 **100%**。这正是本项目采用的模式——一小套固定的、经人工审定的字符串，**永不使用实时机器生成**。这就是为什么我们需要您：在这件事上，您的专业能力是无法被机器替代的稀缺资源。

## 招募的两个角色（必须是两位不同的人）

1. **翻译者**：汉藏双语，熟悉生物医学术语。
2. **独立审校者**：核查译文的含义、语域和可读性，特别要考虑农牧区老年读者能否读懂。

任何人都不得审定自己的译文（原因见下）。

## 您会收到什么（今日实际运行导出程序核实的数字）

| 文件 | 行数 | 内容 |
|---|---|---|
| glossary-names.csv | 348 行 | 化验指标的**名称与释义**，各 174 条。例：名称「血红蛋白」+ 释义「红细胞里携带氧气的蛋白。」 |
| floor-strings.csv | 162 行 | 界面与安全提示语。例："报告读取服务暂时不可用。请稍后重试。" |
| glossary-terms.csv | 34 行 | 参考术语表，**仅供阅读**。在此表中填写任何内容都会导致整包导入中止（这是有意设置的保护） |
| decisions.csv | 1 行 | 一个开放的术语政策问题，请您给出意见 |
| manifest.csv | — | 填写您的姓名、联系方式、日期 |
| INSTRUCTIONS.md | — | 双语操作说明，已写好 |

**需要翻译的总量：510 行**（174 条名称 + 174 条释义 + 162 条界面提示语），均为短句和词条，不是长篇文章。请在 Google Sheets 或 LibreOffice 中工作，导出为 UTF-8 编码的 CSV（Excel 会损坏藏文）。实际工作量约为几次工作时段，不需要数周——但节奏由您掌握，**质量远比速度重要**。

## 双人独立审校制度——为什么一个人不能审定自己的译文

这一规则已写入代码强制执行（2026年7月25日，提交 d58849b）。两位审校者在**互不沟通**的前提下独立完成内容相同的资料包，在双方都提交之前不得对答案。导入程序会：

- 拒绝两份携带相同包编号的提交（复制粘贴不算第二意见）；
- 拒绝两份署名相同或联系方式相同的提交；
- 拒绝任何两人不一致的行——程序**从不裁决谁对谁错**，分歧一律退回，由两位专家自行讨论解决;
- 拒绝只有一人填写的行；
- 拒绝增行、删行或调换行序的提交。

请理解这项制度的本意：**这是对专业的尊重，也是对患者的保护，而不是不信任。** 再优秀的译者也会有看走眼的时候，而读到这些文字的可能是一位拿着自己化验单的老人。要求两位独立专家意见一致，正是为了在发布之前拦住疏忽和差错。

审校者姓名会记录在项目的版本历史中——您的署名与这份工作同在。同时坦率说明：这套机制防的是疏忽和走捷径，防不了蓄意串通，我们不假装它能。

## 不确定的条目：请留空

这一点至关重要：**凡是您没有把握的行，请直接留空。** 留空意味着"不发布"——应用在该处不显示藏文，仅此而已；填错则意味着一位患者可能读到错误的医学信息。空白永远好过错误。

## 报酬与联系方式

> **【报酬：待填写 —— PLACEHOLDER: COMPENSATION】**
>
> **【联系方式：待填写 —— PLACEHOLDER: CONTACT DETAILS】**

---

## English Summary (for forwarding)

**health-translator** is a student research project (not a commercial product): a phone-camera web app that explains each row of a Chinese hospital lab report in plain language, for elderly patients and readers with weak Mandarin literacy. The AI performs OCR only; all meaning comes from a human-curated table; the app never diagnoses.

The app currently ships **zero** Tibetan strings, deliberately. Machine translation into Tibetan cannot be verified: no COMET-style metric exists for Tibetan, health-domain ZH→BO d-BLEU is about 9.4, and the TLUE benchmark (EMNLP 2025) found experts approved only 28.74% of Claude's Tibetan output despite a BLEU of 34.8 — "fluent but wrong", which in medicine is worse than showing nothing. The same TLUE work found that two rounds of human revision brought fixed content to 100% acceptability. That is our model: a small, fixed, human-reviewed set of strings — never live generation.

We seek **two different people**: (1) a Chinese–Tibetan translator competent in biomedical terminology, and (2) an independent reviewer checking meaning, register, and comprehensibility for ordinary readers, especially elderly rural readers. Each works independently on an identical packet of **510 short rows** (174 analyte names + 174 analyte definitions + 162 interface/safety strings). The importer (enforced in code) rejects duplicated packets, matching identities, and any row where the two disagree — it never picks a winner. One honest caveat, stated plainly: this mechanism is a control against mistakes and shortcuts, not against deliberate collusion — we do not pretend otherwise. Nobody may approve their own translation; we frame this rule as patient safety and professional respect, not distrust. Reviewer names are recorded in the project's version history. Anything a reviewer is unsure of must be left **empty**: empty means "not published"; wrong means a patient may read it.

Compensation and contact details: see the placeholders above.
