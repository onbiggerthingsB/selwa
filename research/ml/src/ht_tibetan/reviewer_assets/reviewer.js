(() => {
  'use strict';
  const MAX_BYTES = 32 * 1024 * 1024;
  const AXES = ['fidelity', 'comprehension', 'naturalness'];
  const MODEL_FIELDS = ['ratings', 'issues', 'blind_compromised'];
  const SOURCE_FIELDS = ['ratings', 'issues', 'minutes_spent', 'status', 'recommendation'];
  const COPY = {
    en: {
      brand: 'Health Translator · Research', title: 'Independent review', uiLanguage: 'Interface language',
      local: 'Offline · stays in this browser', sourceMode: 'Source-material review', modelMode: 'Model-answer review',
      intro: 'Read each passage and question, then record your own judgment. Leave a rating blank if you cannot assess it; explain the reason under issues.',
      privacy: 'Edits stay in memory. Download your responses before closing this page. Nothing is uploaded or saved automatically.',
      scope: 'Completing this form records a review. Separate import and adjudication are still required; this form does not authorize training or approve health guidance.',
      synthetic: 'Engineering fixture — these items are not evidence of Tibetan or clinical quality.',
      complete: 'complete', item: 'Item', of: 'of', reading: 'Read the material', judgment: 'Your judgment',
      source: 'Original passage', question: 'Question', answer: 'Model answer', reference: 'Reference answer',
      noReference: 'No reference answer supplied.', claims: 'Allowed claims', sourceTitle: 'Source title',
      inputLanguage: 'Input', outputLanguage: 'Requested answer', bo: 'Tibetan', zh: 'Chinese', en: 'English',
      modelScale: 'Model answers use a 1–4 scale. 1 = major failure; 2 = substantial problems; 3 = minor problems; 4 = no identified problems.',
      sourceScale: 'Source-material reviews use a 1–5 scale. This packet does not include scoring anchors; use the rubric agreed with your study coordinator. Leave uncertain scores blank.',
      medical: 'Medical review: fidelity and comprehension ratings are required for completion; naturalness is optional. This form does not verify clinical qualifications.',
      fidelity: 'Fidelity', comprehension: 'Comprehension', naturalness: 'Naturalness',
      fidelityHelp: 'Meaning and support in the passage', comprehensionHelp: 'Understanding of the question', naturalnessHelp: 'Clarity and everyday wording',
      blank: 'Not rated', optional: 'optional', issues: 'Issues or reasons for uncertainty', addIssue: 'Add issue', issue: 'Issue', remove: 'Remove',
      noIssues: 'No issues recorded. Add a separate note for each issue; your wording and spacing are preserved.',
      blind: 'Did you recognize or infer the model identity?', unset: 'Not answered', blindNo: 'No', blindYes: 'Yes — blinding may be compromised',
      minutes: 'Minutes spent', recommendation: 'Recommendation', pending: 'Pending', approve: 'Approve', revise: 'Revise', reject: 'Reject',
      markComplete: 'Mark my review of this item complete', completeHelp: 'Complete the required ratings, record time, and choose an explicit recommendation first.',
      previous: 'Previous', next: 'Next', saveTitle: 'Keep your work', download: 'Download responses / draft',
      downloadHelp: 'Downloads a new JSON response file, including incomplete items. Your browser may ask where to save it. Return that JSON file to your study coordinator.',
      resume: 'Resume from a response JSON file', resumeHelp: 'Choose a file exported from this exact packet. Loading it replaces responses on this page after confirmation if you have edits.',
      clean: 'Ready. No edits have been made in this session.', unsaved: 'You have responses in browser memory. Download a copy before closing.',
      prepared: 'Download prepared. Check your browser or Downloads folder to confirm the file was saved. Responses still remain only in browser memory here.',
      restored: 'Responses loaded. Further edits stay in browser memory; download a new copy to keep them.',
      invalid: 'Could not load the response file. It is invalid, oversized, or does not match this packet. Your current responses were kept.',
      invalidDraft: 'An issue is empty or a response is invalid. Correct it or remove the empty issue before downloading.',
      downloadFailed: 'The browser could not prepare the download. Your current responses were kept.',
      replacing: 'Replace the responses currently on this page with this file? Download a copy first if you need to keep your current edits.',
      cancelled: 'Loading was cancelled. Your current responses were kept.', instructions: 'Packet instructions (original wording)',
      metadata: 'Packet identity', packet: 'Packet', reviewer: 'Assigned reviewer', hash: 'Original packet file SHA-256',
      footer: 'A local research review form. Text is shown exactly as supplied. The interface language does not translate the review material.',
      fatal: 'This review form could not open. Ask your study coordinator for a fresh form. No responses were sent or stored.',
    },
    zh: {
      brand: '健康翻译 · 研究', title: '独立评审', uiLanguage: '界面语言', local: '离线 · 仅在此浏览器中',
      sourceMode: '来源材料评审', modelMode: '模型回答评审',
      intro: '请阅读每段材料和问题，再独立填写您的判断。无法判断时请留空，并在问题记录中说明原因。',
      privacy: '修改只保存在浏览器内存中。关闭页面前请下载评审结果。本页面不会上传或自动保存任何内容。',
      scope: '填写完成仅代表记录了评审意见。后续仍需单独导入和裁定；本表不能授权训练，也不代表健康指导已获批准。',
      synthetic: '工程测试材料 — 不能作为藏语质量或临床质量的证据。',
      complete: '项已完成', item: '第', of: '项，共', reading: '阅读材料', judgment: '您的判断',
      source: '原始材料', question: '问题', answer: '模型回答', reference: '参考答案', noReference: '未提供参考答案。', claims: '允许表述的内容', sourceTitle: '材料标题',
      inputLanguage: '输入语言', outputLanguage: '要求的回答语言', bo: '藏语', zh: '中文', en: '英语',
      modelScale: '模型回答采用 1–4 分：1 = 严重失败；2 = 有较大问题；3 = 有轻微问题；4 = 未发现问题。',
      sourceScale: '来源材料评审采用 1–5 分。本材料包未附各分值的具体定义，请使用与研究协调员约定的评分标准。不确定时请留空。',
      medical: '医学评审：完成时必须填写忠实度和理解度评分；自然度为选填。本表不核验临床资质。',
      fidelity: '忠实度', comprehension: '理解度', naturalness: '自然度',
      fidelityHelp: '含义是否忠实于材料，并有材料依据', comprehensionHelp: '是否理解了问题', naturalnessHelp: '表达是否清楚、符合日常用语',
      blank: '未评分', optional: '选填', issues: '问题或无法判断的原因', addIssue: '添加问题', issue: '问题', remove: '移除',
      noIssues: '尚未记录问题。每个问题请单独填写；文字、空格和换行将予以保留。',
      blind: '您是否认出了或推断出了模型身份？', unset: '未回答', blindNo: '否', blindYes: '是 — 盲评可能已受影响',
      minutes: '评审用时（分钟）', recommendation: '建议', pending: '待定', approve: '通过', revise: '修改', reject: '不通过',
      markComplete: '将我对本项的评审标记为完成', completeHelp: '请先填写必需评分、记录用时，并作出明确建议。',
      previous: '上一项', next: '下一项', saveTitle: '保留您的评审', download: '下载评审结果 / 草稿',
      downloadHelp: '下载一个新的 JSON 结果文件，其中包含尚未完成的项目。浏览器可能询问保存位置。请将该 JSON 文件交回研究协调员。',
      resume: '从评审结果 JSON 文件继续', resumeHelp: '请选择由本材料包导出的文件。若页面上已有修改，确认后才会替换这些评审内容。',
      clean: '已准备就绪。本次打开后尚未修改。', unsaved: '评审内容保存在浏览器内存中。关闭前请下载一份副本。',
      prepared: '下载已准备好。请检查浏览器或下载文件夹，确认文件确已保存。本页面的评审内容仍只保存在浏览器内存中。',
      restored: '已加载评审内容。后续修改只保存在浏览器内存中；请下载新副本以保留修改。',
      invalid: '无法加载结果文件：文件无效、过大，或与本材料包不符。当前评审内容已保留。',
      invalidDraft: '存在空白问题记录或无效评审。下载前请修正，或移除空白问题记录。',
      downloadFailed: '浏览器未能准备下载。当前评审内容已保留。',
      replacing: '要用此文件替换页面上的评审内容吗？如需保留当前修改，请先下载一份副本。',
      cancelled: '已取消加载。当前评审内容已保留。', instructions: '材料包说明（原文）', metadata: '材料包标识',
      packet: '材料包', reviewer: '指定评审员', hash: '原始材料包文件 SHA-256',
      footer: '本地研究评审表。材料按原文显示。切换界面语言不会翻译评审材料。',
      fatal: '无法打开此评审表。请向研究协调员索取新表。本页面未发送或保存任何评审内容。',
    },
  };
  const app = document.getElementById('review-app');
  let language = 'en', original, current, model, currentIndex = 0, dirty = false;
  let packetHash = '', statusKey = 'clean', statusError = false, resumeBusy = false, editVersion = 0;
  const t = key => COPY[language][key] || key;
  const clone = value => JSON.parse(JSON.stringify(value));
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const keysEqual = (value, keys) => isObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  const eq = (a, b) => {
    if (a === b) return true;
    if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((value, i) => eq(value, b[i]));
    return isObject(a) && isObject(b) && keysEqual(b, Object.keys(a)) && Object.keys(a).every(key => eq(a[key], b[key]));
  };
  const except = (value, omitted) => Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.includes(key)));
  const assert = condition => { if (!condition) throw new Error('Invalid review data'); };

  // JSON.parse silently accepts duplicate keys. This bounded parser rejects them,
  // unsafe integral values, and invalid Unicode before any imported state changes.
  function parseStrict(text) {
    assert(typeof text === 'string' && text.length <= MAX_BYTES);
    let position = 0;
    const space = () => { while (position < text.length && /[\x20\t\r\n]/.test(text[position])) position++; };
    function string() {
      const start = position++;
      let escaped = false;
      while (position < text.length) {
        const char = text[position++];
        if (!escaped && char === '"') {
          const value = JSON.parse(text.slice(start, position));
          for (let i = 0; i < value.length; i++) {
            const code = value.charCodeAt(i);
            if (code >= 0xd800 && code <= 0xdbff) {
              const next = value.charCodeAt(++i);
              assert(next >= 0xdc00 && next <= 0xdfff);
            } else assert(code < 0xdc00 || code > 0xdfff);
          }
          return value;
        }
        if (!escaped && char === '\\') escaped = true;
        else escaped = false;
      }
      throw new Error('Unclosed string');
    }
    function value(depth) {
      assert(depth <= 100); space();
      const char = text[position];
      if (char === '"') return string();
      if (char === '{') {
        position++; space(); const result = Object.create(null);
        if (text[position] === '}') { position++; return result; }
        while (true) {
          space(); assert(text[position] === '"'); const key = string();
          assert(!Object.hasOwn(result, key)); space(); assert(text[position++] === ':'); result[key] = value(depth + 1); space();
          if (text[position] === '}') { position++; return result; }
          assert(text[position++] === ',');
        }
      }
      if (char === '[') {
        position++; space(); const result = [];
        if (text[position] === ']') { position++; return result; }
        while (true) {
          result.push(value(depth + 1)); space();
          if (text[position] === ']') { position++; return result; }
          assert(text[position++] === ',');
        }
      }
      for (const [token, result] of [['true', true], ['false', false], ['null', null]]) {
        if (text.startsWith(token, position)) { position += token.length; return result; }
      }
      const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(position));
      assert(match); position += match[0].length;
      const number = Number(match[0]);
      assert(Number.isFinite(number) && (!Number.isInteger(number) || Number.isSafeInteger(number)));
      return number;
    }
    const result = value(0); space(); assert(position === text.length); return result;
  }

  function response(item) { return model ? item : item.review; }
  function ready(value) {
    const required = !model && original.review_type === 'medical' ? ['fidelity', 'comprehension'] : AXES;
    return required.every(axis => value.ratings[axis] !== null) && (model ? value.blind_compromised !== null
      : value.minutes_spent !== null && value.recommendation !== 'pending');
  }
  function validateResponse(value) {
    assert(keysEqual(value.ratings, AXES));
    for (const rating of Object.values(value.ratings)) assert(rating === null || (Number.isInteger(rating) && rating >= 1 && rating <= (model ? 4 : 5)));
    assert(Array.isArray(value.issues));
    if (model) assert(value.issues.length <= 128);
    for (const issue of value.issues) {
      assert(typeof issue === 'string' && issue.length > 0);
      if (model) assert(issue.trim().length > 0 && Array.from(issue).length <= 8192);
    }
    if (model) assert(value.blind_compromised === null || typeof value.blind_compromised === 'boolean');
    else {
      assert(value.minutes_spent === null || (typeof value.minutes_spent === 'number' && Number.isFinite(value.minutes_spent)
        && value.minutes_spent >= 0 && (!Number.isInteger(value.minutes_spent) || Number.isSafeInteger(value.minutes_spent))));
      assert(['pending', 'approve', 'revise', 'reject'].includes(value.recommendation));
      assert(['incomplete', 'complete'].includes(value.status));
      assert(value.status !== 'complete' || ready(value));
    }
  }
  function validateReturned(candidate) {
    assert(isObject(candidate) && eq(except(candidate, ['items']), except(original, ['items'])));
    assert(Array.isArray(candidate.items) && candidate.items.length === original.items.length);
    candidate.items.forEach((item, index) => {
      const before = original.items[index];
      assert(keysEqual(item, Object.keys(before)));
      if (model) assert(eq(except(item, MODEL_FIELDS), except(before, MODEL_FIELDS)));
      else {
        assert(eq(except(item, ['review']), except(before, ['review'])));
        assert(keysEqual(item.review, Object.keys(before.review)));
        assert(eq(except(item.review, SOURCE_FIELDS), except(before.review, SOURCE_FIELDS)));
      }
      validateResponse(response(item));
    });
  }
  function validateOriginal() {
    assert(isObject(original));
    model = original.kind === 'blind_model_output_review';
    const fields = model ? ['schema_version', 'kind', 'packet_id', 'reviewer_id', 'status', 'input_evidence_type', 'instructions', 'rating_scale', 'items']
      : ['schema_version', 'packet_id', 'dataset_sha256', 'reviewer_id', 'reviewer_role', 'review_type', 'items'];
    assert(keysEqual(original, fields));
    assert(Array.isArray(original.items) && original.items.length >= 1 && original.items.length <= 1000);
    assert(typeof original.packet_id === 'string' && typeof original.reviewer_id === 'string');
    if (model) {
      assert(['1.0', '1.1'].includes(original.schema_version) && original.status === 'unfilled');
      assert(['infrastructure_smoke', 'unscored_language_generation'].includes(original.input_evidence_type));
      assert(Array.isArray(original.instructions) && original.instructions.every(value => typeof value === 'string'));
      assert(eq(original.rating_scale, {'1': 'Major failure', '2': 'Substantial problems', '3': 'Minor problems', '4': 'No identified problems'}));
    } else assert(original.schema_version === '1.0' && ['language', 'medical'].includes(original.review_type));
    const identities = new Set();
    original.items.forEach(item => {
      if (model) {
        assert(keysEqual(item, ['blind_id', 'source_text', 'question', 'answer', ...MODEL_FIELDS,
          ...(original.schema_version === '1.1' ? ['input_language', 'requested_output_language'] : [])]));
        for (const key of ['source_text', 'question', 'answer', 'blind_id']) assert(typeof item[key] === 'string');
        if (original.schema_version === '1.1') assert(['bo', 'zh'].includes(item.input_language) && ['bo', 'zh'].includes(item.requested_output_language));
        assert(AXES.every(axis => item.ratings[axis] === null) && item.issues.length === 0 && item.blind_compromised === null);
      } else {
        assert(keysEqual(item, ['example', 'source', 'review', 'binding_sha256']));
        assert(isObject(item.source) && typeof item.source.original_text === 'string' && typeof item.source.title === 'string');
        assert(isObject(item.example) && typeof item.example.question === 'string' && Array.isArray(item.example.allowed_claims));
        assert(item.example.allowed_claims.every(claim => typeof claim === 'string'));
        assert(item.example.approved_answer === null || typeof item.example.approved_answer === 'string');
        assert(isObject(item.review) && item.review.review_type === original.review_type);
      }
      const id = model ? item.blind_id : item.review.review_id;
      assert(typeof id === 'string' && !identities.has(id)); identities.add(id);
    });
    validateReturned(original);
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function button(text, id, action, className) {
    const node = element('button', text, className); node.type = 'button'; node.id = id; node.addEventListener('click', action); return node;
  }
  function status(key, error = false) {
    statusKey = key; statusError = error;
    const node = document.getElementById('review-status');
    if (node) { node.textContent = t(key); node.className = `status${error ? ' error' : dirty ? ' unsaved' : ''}`; }
  }
  function edited() {
    dirty = true; editVersion++; status('unsaved'); updateProgress();
  }
  function select(id, label, options, selected, change) {
    const wrapper = element('div', null, 'field');
    const labelNode = element('label', label); labelNode.htmlFor = id;
    const control = element('select'); control.id = id;
    for (const [value, text] of options) { const option = element('option', text); option.value = value; control.append(option); }
    control.value = selected; control.addEventListener('change', () => { change(control.value); edited(); updateCompletion(); });
    wrapper.append(labelNode, control); return wrapper;
  }
  function textBlock(label, text, className = '') {
    const block = element('section', null, `reading-block ${className}`);
    block.append(element('h3', label), element('div', text, 'exact-text')); return block;
  }
  function updateProgress() {
    if (!current) return;
    const complete = current.items.filter(item => {
      try { validateResponse(response(item)); } catch { return false; }
      return model ? ready(response(item)) : response(item).status === 'complete';
    }).length;
    const label = document.getElementById('completion-count');
    if (label) label.textContent = `${complete} / ${current.items.length} ${t('complete')}`;
    const bar = document.getElementById('completion-progress');
    if (bar) { bar.value = complete; bar.setAttribute('aria-label', `${complete} / ${current.items.length} ${t('complete')}`); }
  }
  function updateCompletion() {
    if (model) return;
    const value = response(current.items[currentIndex]);
    let valid = true;
    try { validateResponse({...value, status: 'incomplete'}); } catch { valid = false; }
    const checkbox = document.getElementById('source-complete');
    if (!checkbox) return;
    checkbox.disabled = !ready(value) || !valid;
    if (checkbox.disabled && value.status === 'complete') { value.status = 'incomplete'; checkbox.checked = false; }
    updateProgress();
  }
  function renderIssues(parent, value) {
    parent.replaceChildren();
    if (value.issues.length === 0) parent.append(element('p', t('noIssues'), 'help'));
    value.issues.forEach((issue, index) => {
      const wrapper = element('div', null, 'issue'), top = element('div', null, 'issue-top');
      const label = element('label', `${t('issue')} ${index + 1}`); label.htmlFor = `issue-${index}`;
      const remove = button(t('remove'), `remove-issue-${index}`, () => {
        value.issues.splice(index, 1); edited(); renderIssues(parent, value); updateCompletion();
        document.getElementById(`issue-${Math.min(index, value.issues.length - 1)}`)?.focus();
        if (!value.issues.length) document.getElementById('add-issue').focus();
      }, 'quiet small');
      remove.setAttribute('aria-label', `${t('remove')} ${t('issue')} ${index + 1}`); top.append(label, remove);
      const control = element('textarea'); control.id = `issue-${index}`; control.value = issue;
      control.addEventListener('input', () => { value.issues[index] = control.value; edited(); updateCompletion(); });
      wrapper.append(top, control); parent.append(wrapper);
    });
    const add = document.getElementById('add-issue');
    if (add) add.disabled = model && value.issues.length >= 128;
  }
  function renderItem() {
    const grid = document.getElementById('item-container'); grid.replaceChildren();
    const item = current.items[currentIndex], value = response(item);
    const reading = element('article', null, 'card'), form = element('section', null, 'card');
    const heading = element('h2', t('reading')); heading.id = 'item-heading'; heading.tabIndex = -1; reading.append(heading);
    if (model && original.schema_version === '1.1') reading.append(element('p', `${t('inputLanguage')}: ${t(item.input_language)} · ${t('outputLanguage')}: ${t(item.requested_output_language)}`, 'language-pair'));
    if (!model) reading.append(textBlock(t('sourceTitle'), item.source.title));
    reading.append(textBlock(t('source'), model ? item.source_text : item.source.original_text), textBlock(t('question'), model ? item.question : item.example.question));
    if (model) reading.append(textBlock(t('answer'), item.answer, 'reference-note'));
    else {
      const block = element('section', null, 'reading-block'); block.append(element('h3', t('claims')));
      const list = element('ul'); item.example.allowed_claims.forEach(claim => list.append(element('li', claim, 'exact-text'))); block.append(list); reading.append(block);
      reading.append(textBlock(t('reference'), item.example.approved_answer === null ? t('noReference') : item.example.approved_answer, 'reference-note'));
    }
    form.append(element('h2', t('judgment')), element('p', t(model ? 'modelScale' : 'sourceScale'), 'scale-note'));
    if (!model && original.review_type === 'medical') form.append(element('p', t('medical'), 'help'));
    const ratings = element('div', null, 'ratings');
    AXES.forEach(axis => {
      const row = select(`rating-${axis}`, t(axis), [['', t('blank')], ...Array.from({length: model ? 4 : 5}, (_, i) => [String(i + 1), String(i + 1)])],
        value.ratings[axis] === null ? '' : String(value.ratings[axis]), selected => { value.ratings[axis] = selected === '' ? null : Number(selected); });
      row.className = 'rating-row';
      const help = element('span', t(`${axis}Help`) + (!model && original.review_type === 'medical' && axis === 'naturalness' ? ` (${t('optional')})` : ''), 'help');
      row.querySelector('label').append(help); ratings.append(row);
    });
    form.append(ratings);
    const issuesHeading = element('div', null, 'issues-heading');
    const issueList = element('div'); issueList.id = 'issue-list';
    issuesHeading.append(element('h3', t('issues')), button(t('addIssue'), 'add-issue', () => {
      if (model && value.issues.length >= 128) return;
      value.issues.push(''); edited(); renderIssues(issueList, value); updateCompletion(); document.getElementById(`issue-${value.issues.length - 1}`).focus();
    }, 'small'));
    form.append(issuesHeading, issueList);
    if (model) form.append(select('blind-compromised', t('blind'), [['', t('unset')], ['false', t('blindNo')], ['true', t('blindYes')]],
      value.blind_compromised === null ? '' : String(value.blind_compromised), selected => { value.blind_compromised = selected === '' ? null : selected === 'true'; }));
    else {
      const timeField = element('div', null, 'field'), timeLabel = element('label', t('minutes')); timeLabel.htmlFor = 'minutes-spent';
      const time = element('input'); time.id = 'minutes-spent'; time.type = 'number'; time.min = '0'; time.step = 'any'; time.inputMode = 'decimal';
      time.value = value.minutes_spent === null ? '' : String(value.minutes_spent);
      time.addEventListener('input', () => { value.minutes_spent = time.value === '' ? null : time.valueAsNumber; edited(); updateCompletion(); });
      timeField.append(timeLabel, time); form.append(timeField);
      form.append(select('recommendation', t('recommendation'), ['pending', 'approve', 'revise', 'reject'].map(key => [key, t(key)]), value.recommendation, selected => { value.recommendation = selected; }));
      const completeField = element('div', null, 'check-field');
      const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.id = 'source-complete'; checkbox.checked = value.status === 'complete';
      checkbox.addEventListener('change', () => { value.status = checkbox.checked ? 'complete' : 'incomplete'; edited(); });
      const completeLabel = element('label', t('markComplete')); completeLabel.htmlFor = checkbox.id;
      const completeHelp = element('p', t('completeHelp'), 'help'); completeHelp.id = 'completion-help'; checkbox.setAttribute('aria-describedby', completeHelp.id);
      completeField.append(checkbox, completeLabel); form.append(completeField, completeHelp);
    }
    grid.append(reading, form); renderIssues(issueList, value); updateCompletion();
    document.getElementById('item-position').textContent = `${t('item')} ${currentIndex + 1} ${t('of')} ${current.items.length}`;
    document.getElementById('previous-item').disabled = currentIndex === 0;
    document.getElementById('next-item').disabled = currentIndex === current.items.length - 1;
  }
  function navigate(direction) { currentIndex += direction; renderItem(); document.getElementById('item-heading').focus(); }
  function download() {
    try { validateReturned(current); } catch { status('invalidDraft', true); return; }
    let url;
    try {
      const text = JSON.stringify(current, null, 2) + '\n';
      assert(new TextEncoder().encode(text).byteLength <= MAX_BYTES);
      url = URL.createObjectURL(new Blob([text], {type: 'application/json;charset=utf-8'}));
      const link = element('a'); link.href = url; link.download = `review-${original.packet_id.replace(/[^A-Za-z0-9._-]/g, '_')}-responses.json`;
      document.body.append(link); link.click(); link.remove(); status('prepared');
      // Preparing a browser download cannot prove that the OS saved the file.
      // Keep beforeunload protection after export and after resuming a draft.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { if (url) URL.revokeObjectURL(url); status('downloadFailed', true); }
  }
  async function resume(event) {
    const input = event.target, file = input.files && input.files[0];
    if (!file || resumeBusy) return;
    resumeBusy = true; input.disabled = true;
    const versionAtRead = editVersion;
    try {
      assert(file.size > 0 && file.size <= MAX_BYTES);
      const data = await file.arrayBuffer(); assert(data.byteLength <= MAX_BYTES);
      const candidate = parseStrict(new TextDecoder('utf-8', {fatal: true}).decode(data));
      validateReturned(candidate);
      // A file read is asynchronous: preserve edits made while it was in flight.
      if (dirty || versionAtRead !== editVersion) {
        if (!window.confirm(t('replacing'))) { status('cancelled'); return; }
      }
      current = clone(candidate); dirty = true; editVersion++; statusKey = 'restored'; statusError = false; render();
    } catch { status('invalid', true); }
    finally {
      resumeBusy = false; input.value = ''; input.disabled = false;
      const currentInput = document.getElementById('resume-file');
      if (currentInput) currentInput.disabled = false;
    }
  }
  function render() {
    app.replaceChildren(); document.documentElement.lang = language;
    const header = element('header'), title = element('div'); title.append(element('div', t('brand'), 'brand'), element('h1', t('title')));
    const langLabel = element('label', t('uiLanguage'), 'language'); langLabel.htmlFor = 'ui-language';
    const langSelect = element('select'); langSelect.id = 'ui-language';
    [['en', 'English'], ['zh', '中文']].forEach(([value, text]) => { const option = element('option', text); option.value = value; langSelect.append(option); });
    langSelect.value = language; langSelect.addEventListener('change', () => { language = langSelect.value; render(); document.getElementById('ui-language').focus(); });
    langLabel.append(langSelect); header.append(title, langLabel); app.append(header);
    const workspace = element('div', null, 'workspace'), intro = element('section', null, 'intro');
    intro.append(element('span', t('local'), 'badge'), element('h2', t(model ? 'modelMode' : 'sourceMode')), element('p', t('intro')), element('p', t('privacy'), 'help'), element('p', t('scope'), 'help'));
    const synthetic = model ? original.input_evidence_type === 'infrastructure_smoke' : original.items.some(item => item.source.source_kind === 'synthetic_fixture');
    if (synthetic) intro.append(element('p', t('synthetic'), 'badge warning'));
    if (model) {
      const instructions = element('details'); instructions.append(element('summary', t('instructions')));
      const list = element('ul'); original.instructions.forEach(text => list.append(element('li', text, 'exact-text'))); instructions.append(list); intro.append(instructions);
    }
    workspace.append(intro);
    const progressRow = element('div', null, 'progress-row'), position = element('span'), count = element('span', null, 'muted');
    position.id = 'item-position'; count.id = 'completion-count'; progressRow.append(position, count); workspace.append(progressRow);
    const progress = element('progress'); progress.id = 'completion-progress'; progress.max = current.items.length; progress.value = 0; workspace.append(progress);
    const grid = element('div', null, 'review-grid'); grid.id = 'item-container'; workspace.append(grid);
    const nav = element('nav', null, 'navigation'); nav.setAttribute('aria-label', t('title'));
    nav.append(button(t('previous'), 'previous-item', () => navigate(-1)), button(t('next'), 'next-item', () => navigate(1))); workspace.append(nav);
    const save = element('section', null, 'save-area'); save.append(element('h2', t('saveTitle')));
    const saveButtons = element('div', null, 'save-buttons'); saveButtons.append(button(t('download'), 'download-review', download, 'primary')); save.append(saveButtons, element('p', t('downloadHelp'), 'help'));
    const notice = element('p', null, 'status'); notice.id = 'review-status'; notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite'); save.append(notice);
    const fileLabel = element('label', t('resume'), 'file-label'); fileLabel.htmlFor = 'resume-file';
    const file = element('input'); file.type = 'file'; file.id = 'resume-file'; file.accept = '.json,application/json'; file.disabled = resumeBusy;
    file.addEventListener('change', resume); fileLabel.append(file); save.append(fileLabel, element('p', t('resumeHelp'), 'help'));
    const metadata = element('details'); metadata.append(element('summary', t('metadata')));
    metadata.append(element('p', `${t('packet')}: ${original.packet_id}\n${t('reviewer')}: ${original.reviewer_id}\n${t('hash')}: ${packetHash}`, 'metadata exact-text')); save.append(metadata);
    workspace.append(save); app.append(workspace, element('footer', t('footer'), 'page-footer'));
    renderItem(); updateProgress(); status(statusKey, statusError);
  }
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  try {
    const encoded = document.getElementById('review-payload').textContent.trim();
    assert(encoded.length <= Math.ceil(MAX_BYTES * 4 / 3) + 4);
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    assert(bytes.byteLength <= MAX_BYTES);
    const envelope = parseStrict(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    assert(keysEqual(envelope, ['form_version', 'packet', 'packet_file_sha256']) && envelope.form_version === '1.0');
    assert(typeof envelope.packet_file_sha256 === 'string' && /^[a-f0-9]{64}$/.test(envelope.packet_file_sha256));
    original = envelope.packet; packetHash = envelope.packet_file_sha256; validateOriginal(); current = clone(original); render();
  } catch {
    app.replaceChildren(element('p', t('fatal'), 'fatal')); app.setAttribute('role', 'alert');
  }
})();
