(() => {
  'use strict';
  const axes = ['fidelity', 'comprehension', 'naturalness'];
  const words = {
    en: {title:'Independent answer review', intro:'Read each passage and answer, then record your own judgments. You may download an unfinished review at any time.',
      evidence:'Practice material: this packet is an engineering exercise. Its ratings will not become evidence of Tibetan language quality.', reviewer:'Reviewer',
      answerHeading:'Review the answers', item:'Answer', source:'Original passage', question:'Question', answer:'Model answer', instructions:'Instructions and context shown to the model',
      scale:'Use 1–4: 1 = major problems; 2 = substantial problems; 3 = minor problems; 4 = no identified problems. Leave unassessed fields blank.',
      fidelity:'Faithfulness to the passage', comprehension:'Understanding of the question', naturalness:'Natural language', critical:'Critical errors',
      minutes:'Minutes you actually spent reviewing this answer', notes:'Notes (optional)', blind:'I recognized this candidate from the text or prior knowledge.', itemComplete:'I have finished reviewing this answer.',
      candidateHeading:'Candidate suitability', suitability:'Judge suitability for the registered, bounded language experiment. This does not approve health advice or public use.', candidate:'Candidate', recommendation:'Recommendation', rationale:'Reason for this recommendation',
      independent:'I made these judgments independently.', reviewComplete:'I have completed all answers and candidate recommendations.', download:'Download review',
      save:'Your entries stay in this page until you download them. Closing or reloading it loses unsaved work. Downloading does not submit the review.',
      limitations:'Review notes and limits', blank:'Not assessed', present:'Present', absent:'Absent', pending:'No recommendation yet', approve:'Suitable', reject:'Not suitable', revise:'Changes needed',
      complete:'answers complete', error:'Check the review time and notes. Time must be 0–1,000,000 minutes; notes and reasons may have up to 8,000 characters.',
      broken:'This review file could not be opened. Ask the person who supplied it for a new copy.'},
    zh: {title:'独立回答评审', intro:'阅读每段原文和回答，再记录您自己的判断。您可以随时下载尚未完成的评审。',
      evidence:'练习材料：此评审用于检验工具流程。评分不会成为藏语质量的证据。', reviewer:'评审人',
      answerHeading:'评审回答', item:'回答', source:'原文', question:'问题', answer:'模型回答', instructions:'模型看到的指令和上下文',
      scale:'使用 1–4 分：1 = 严重问题；2 = 较大问题；3 = 轻微问题；4 = 未发现问题。尚未评估的项目请留空。',
      fidelity:'对原文的忠实程度', comprehension:'对问题的理解', naturalness:'语言自然程度', critical:'关键错误',
      minutes:'您实际评审此回答所用的分钟数', notes:'备注（可选）', blind:'我通过文本或已有知识认出了此候选模型。', itemComplete:'我已完成此回答的评审。',
      candidateHeading:'候选模型适用性', suitability:'请判断是否适合已登记、范围有限的语言实验。这不代表批准健康建议或公开使用。', candidate:'候选模型', recommendation:'建议', rationale:'建议理由',
      independent:'这些判断由我独立作出。', reviewComplete:'我已完成所有回答和候选模型建议。', download:'下载评审',
      save:'下载前，您的填写内容仅保留在此页面。关闭或刷新页面会丢失未保存的内容。下载不会提交评审。',
      limitations:'评审说明与限制', blank:'尚未评估', present:'存在', absent:'不存在', pending:'尚无建议', approve:'适合', reject:'不适合', revise:'需要修改',
      complete:'个回答已完成', error:'请检查时间与备注。时间须为 0–1,000,000 分钟；备注与理由最多 8,000 个字符。',
      broken:'无法打开此评审文件。请联系提供者索取新副本。'}
  };
  const byId = id => document.getElementById(id);
  let packet, index = 0, candidateIndex = 0, language = 'en', invalidMinutes = false;
  const w = () => words[language];
  const length = text => Array.from(text).length;
  function option(value, label) { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; }
  function options(node, values, value) { node.replaceChildren(...values.map(([key,label]) => option(key,label))); node.value = value; }
  function labelCandidate(alias) { return `${w().candidate} ${packet.candidate_decisions.findIndex(row => row.candidate_alias === alias) + 1}`; }
  function ready(row) { return axes.every(axis => Number.isInteger(row.ratings[axis]) && row.ratings[axis] >= 1 && row.ratings[axis] <= 4)
    && Object.values(row.critical_errors).every(value => value === 'present' || value === 'absent')
    && row.minutes_spent !== null && Number.isFinite(row.minutes_spent) && row.minutes_spent >= 0 && row.minutes_spent <= 1000000 && length(row.notes) <= 8000; }
  function updateStatus() {
    const row = packet.items[index];
    if (!ready(row)) { row.status = 'incomplete'; }
    const full = packet.items.every(item => ready(item) && item.status === 'complete') && packet.independent
      && packet.candidate_decisions.every(item => item.recommendation !== 'pending' && item.rationale.trim() && length(item.rationale) <= 8000);
    if (!full) packet.status = 'incomplete';
    byId('item-complete').disabled = !ready(row) || invalidMinutes;
    byId('item-complete').checked = row.status === 'complete';
    byId('review-complete').disabled = !full || invalidMinutes;
    byId('review-complete').checked = packet.status === 'complete';
    byId('progress').textContent = `${packet.items.filter(item => item.status === 'complete').length} / ${packet.items.length} ${w().complete}`;
    const invalid = invalidMinutes || packet.items.some(item => length(item.notes) > 8000)
      || packet.candidate_decisions.some(item => length(item.rationale) > 8000);
    byId('error').textContent = invalid ? w().error : '';
    byId('download-review').disabled = invalid;
  }
  function field(container, id, label, values, value, changed) {
    const wrapper = document.createElement('div'), text = document.createElement('label'), select = document.createElement('select');
    text.htmlFor = id; text.textContent = label; select.id = id;
    options(select, values, value); select.addEventListener('change', () => { changed(select.value); updateStatus(); });
    wrapper.append(text, select); container.append(wrapper);
  }
  function renderItem() {
    const row = packet.items[index]; invalidMinutes = false;
    byId('source-text').textContent = row.source_text ?? '';
    byId('question-text').textContent = row.question ?? '';
    byId('answer-text').textContent = row.answer;
    byId('instruction-text').textContent = row.messages.map(message => message.content).join('\n\n');
    byId('ratings').replaceChildren();
    for (const axis of axes) field(byId('ratings'), `rating-${axis}`, w()[axis], [['',w().blank],...[1,2,3,4].map(number => [String(number),String(number)])],
      row.ratings[axis] === null ? '' : String(row.ratings[axis]), value => { row.ratings[axis] = value === '' ? null : Number(value); });
    byId('critical-errors').replaceChildren();
    Object.keys(row.critical_errors).forEach((key, position) => field(byId('critical-errors'), `critical-${position}`, key.replaceAll('_', ' '),
      [['not_assessed',w().blank],['present',w().present],['absent',w().absent]], row.critical_errors[key], value => { row.critical_errors[key] = value; }));
    byId('minutes-spent').value = row.minutes_spent === null ? '' : String(row.minutes_spent);
    byId('notes').value = row.notes;
    byId('blind-compromised').checked = row.blind_compromised;
    updateStatus();
  }
  function renderCandidate() {
    const row = packet.candidate_decisions[candidateIndex];
    options(byId('recommendation'), ['pending','approve','reject','revise'].map(key => [key,w()[key]]), row.recommendation);
    byId('rationale').value = row.rationale;
    updateStatus();
  }
  function render() {
    document.documentElement.lang = language;
    const labels = {'title':'title','intro':'intro','answer-heading':'answerHeading','item-label':'item','source-label':'source',
      'question-label':'question','answer-label':'answer','instructions-label':'instructions','scale-note':'scale','critical-heading':'critical',
      'minutes-label':'minutes','notes-label':'notes','blind-label':'blind','item-complete-label':'itemComplete','candidate-heading':'candidateHeading',
      'suitability-note':'suitability','candidate-label':'candidate','recommendation-label':'recommendation','rationale-label':'rationale',
      'independent-label':'independent','review-complete-label':'reviewComplete','download-review':'download','save-note':'save','limitations-label':'limitations'};
    for (const [id,key] of Object.entries(labels)) byId(id).textContent = w()[key];
    document.title = w().title;
    byId('evidence-note').textContent = packet.evidence_kind === 'synthetic_test' ? w().evidence : '';
    byId('evidence-note').hidden = packet.evidence_kind !== 'synthetic_test';
    byId('reviewer').textContent = `${w().reviewer}: ${packet.reviewer_id}`;
    options(byId('item-select'), packet.items.map((row,position) => [String(position),`${position + 1} — ${labelCandidate(row.candidate_alias)}`]), String(index));
    options(byId('candidate-select'), packet.candidate_decisions.map((row,position) => [String(position),labelCandidate(row.candidate_alias)]), String(candidateIndex));
    byId('independent').checked = packet.independent;
    byId('limitations').replaceChildren(...packet.limitations.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
    renderItem(); renderCandidate();
  }
  try {
    const encoded = byId('evaluation-packet').textContent.trim();
    packet = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Uint8Array.from(atob(encoded), char => char.charCodeAt(0))));
    if (packet.kind !== 'blinded_evaluation_native_review' || packet.schema_version !== '1.0' || !Array.isArray(packet.items)
      || packet.items.length < 1 || packet.items.length > 1000 || !Array.isArray(packet.candidate_decisions) || !packet.candidate_decisions.length) throw new Error('packet');
    byId('language').addEventListener('change', event => { language = event.target.value === 'zh' ? 'zh' : 'en'; render(); });
    byId('item-select').addEventListener('change', event => { index = Number(event.target.value); renderItem(); });
    byId('candidate-select').addEventListener('change', event => { candidateIndex = Number(event.target.value); renderCandidate(); });
    byId('minutes-spent').addEventListener('input', event => {
      const value = event.target.value;
      invalidMinutes = value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1000000);
      packet.items[index].minutes_spent = value === '' || invalidMinutes ? null : Number(value); updateStatus();
    });
    byId('notes').addEventListener('input', event => { packet.items[index].notes = event.target.value; updateStatus(); });
    byId('blind-compromised').addEventListener('change', event => { packet.items[index].blind_compromised = event.target.checked; });
    byId('item-complete').addEventListener('change', event => { packet.items[index].status = event.target.checked && ready(packet.items[index]) ? 'complete' : 'incomplete'; updateStatus(); });
    byId('recommendation').addEventListener('change', event => { packet.candidate_decisions[candidateIndex].recommendation = event.target.value; updateStatus(); });
    byId('rationale').addEventListener('input', event => { packet.candidate_decisions[candidateIndex].rationale = event.target.value; updateStatus(); });
    byId('independent').addEventListener('change', event => { packet.independent = event.target.checked; updateStatus(); });
    byId('review-complete').addEventListener('change', event => { packet.status = event.target.checked && !event.target.disabled ? 'complete' : 'incomplete'; updateStatus(); });
    byId('download-review').addEventListener('click', () => {
      updateStatus(); if (byId('download-review').disabled) return;
      const blob = new Blob([JSON.stringify(packet, null, 2) + '\n'], {type:'application/json;charset=utf-8'});
      const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url;
      anchor.download = 'evaluation-review.json'; document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    render();
  } catch {
    byId('error').textContent = w().broken;
    for (const node of document.querySelectorAll('input,select,textarea,button')) node.disabled = true;
  }
})();
