# Review in a browser

The coordinator gives each reviewer a separate HTML file for their assigned packet. Open that file in a current browser. It works offline; the passage, questions and answers are embedded in the file. No model, account or server is needed.

1. Check the packet and assigned reviewer under **Packet identity**. Review independently using the agreed rubric. Source/example ratings use 1–5; model-answer ratings use 1–4. They are different scales.
2. Read the original passage and question. Text is fixed; record corrections as issues. The English/Chinese selector changes only the controls. It does not translate the material.
3. Leave uncertain ratings blank and explain why. Add one issue at a time. Model reviews also ask whether model identity was recognized. Source reviews require time and an explicit recommendation before marking an item complete.
4. Select **Download responses / draft** regularly. Check that the browser actually saved the new JSON file. The page keeps edits in memory only; closing it loses them. The HTML file itself is not updated.
5. To continue, reopen the original HTML and choose your downloaded JSON under **Resume**. Only a response from the exact assignment can load. A rejected file leaves current edits intact; replacing current edits requires confirmation.
6. Return the downloaded JSON to the coordinator using the agreed method. Do not return private operator keys or edit IDs, passages or hashes. Completion records your judgment; subsequent import and adjudication are separate.

The HTML and response contain the assigned material. Keep them under the same agreed privacy restrictions as the original packet. The form makes no network requests, but browser extensions and cloud-synced download folders are outside its control. Choose the study's agreed local folder.

## 中文简要说明

用浏览器打开协调员提供的 HTML 文件，可离线填写。切换界面语言不会翻译材料。请独立评审；不确定的评分留空，并说明原因。来源材料用 1–5 分，模型回答用 1–4 分。

请经常点击“下载评审结果 / 草稿”，并确认 JSON 文件已保存。页面不会自动保存；关闭页面后，内存中的修改会丢失。继续填写时，重新打开原 HTML，再选择已下载的 JSON 文件。请将结果 JSON 交回协调员。填写完成不等于已通过裁定，也不会授权模型训练或健康指导。

## Coordinator commands

Run from the repository root with the installed `ht-tibetan` command. Set `HT_ML_ROOT` to the existing private research root. Examples below describe new assignment paths; create one packet per reviewer. Keep outputs outside Desktop and outside any run directory, with private parent directories (0700) and proof files (0600).

```sh
# Model answers: retained key verifies the sealed original assignment.
ht-tibetan review-form "$HT_ML_ROOT/review-packets/reviewer-a.json" \
  --key "$HT_ML_ROOT/private-review-keys/reviewer-a.json" \
  --output "$HT_ML_ROOT/review-forms/reviewer-a.html"

# Source/example material: retained receipt plus current dataset.
ht-tibetan review-form "$HT_ML_ROOT/review-packets/source-a.json" \
  --receipt "$HT_ML_ROOT/review-packets/source-a.json.receipt.json" \
  --dataset "$HT_ML_ROOT/datasets/development.json" \
  --output "$HT_ML_ROOT/review-forms/source-a.html"
```

Only the public assignment enters the HTML. Keep original packets, receipts, model keys and datasets unchanged on the operator's Mac. Give the reviewer the HTML plus the appropriate rubric. The HTML is a convenience interface, not an authentication mechanism; returned files still pass through the existing [source-review](reviewer-instructions.md) or [model-output](model-output-review.md) importer. The browser does not import records, grant approval or freeze reviews. Engineering test responses must remain `synthetic_test` when imported as model-output evidence.

Exports are create-only, support 1–1000 items and cap the embedded payload at 32 MiB and HTML at 48 MiB. For a larger assignment, issue smaller packets. Draft JSON is capped at 32 MiB. Tampered source fields, reordered/substituted items, unknown fields, duplicate JSON keys and invalid ratings are rejected on resume. Preserve the original form if its assignment changes; issue a new packet and form for the new version.

For collecting the first real material, use the [three-passage guide](first-passages.md) and [blank intake form](first-passages-template.txt). This is an intake trial before the planned 10–20-passage development set and timed ten-example review pilot.
