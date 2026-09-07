"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  catalogSchema,
  codePointLength,
  MAX_CONVERSATION_CODEPOINTS,
  MAX_MESSAGE_CODEPOINTS,
  MAX_MESSAGES,
  MAX_REQUEST_BYTES,
  sameCitation,
  validateResponseForRequest,
  type ChatRequest,
  type Citation,
  type SourceCard,
} from "../lib/contracts";

type Language = "en" | "zh";
type MessageKey =
  | "catalogFailure" | "requestFailure" | "timeout" | "cancelled"
  | "contextOverflow" | "questionTooLong" | "sessionEnded" | "sourceChanged" | "reset";
type Turn = { user: string; assistant: string; citations: Citation[] };

const copy = {
  en: {
    language: "Interface language", project: "Tibetan language lab", title: "A conversation, with the original in view.",
    intro: "Explore how questions, replies and source passages fit together.", badge: "Synthetic demo",
    demo: "No language model is connected. Replies are simulated and are not health advice.",
    privacy: "Use sample questions only. Keep personal and health information out of this demo.",
    sourceStep: "01 / ORIGINAL TEXT", sourceTitle: "Start with a passage", chooseSource: "Choose a sample passage",
    sourceChange: "Choosing another passage starts a new conversation and clears your draft.",
    original: "Original passage", reviewPending: "Language review pending", nonclinical: "Nonclinical sample",
    syntheticSource: "Synthetic sample text", english: "English", chinese: "Chinese", tibetan: "Tibetan",
    loading: "Loading sample passages…", retryCatalog: "Try loading again", noSources: "No sample passages are available yet.",
    chatStep: "02 / CONVERSATION", chatTitle: "Try a question", newConversation: "New conversation",
    emptyTitle: "Your conversation starts here", emptyBody: "Ask a question about the selected passage to see the demo response.",
    user: "You", assistant: "Simulated reply", citation: "Source", readOriginal: "Read original passage",
    question: "Your question", placeholder: "Ask about the passage…", send: "Send question", cancel: "Cancel reply",
    busy: "Preparing a simulated reply…", questionHint: "Up to 2,000 characters. Press Send question when you are ready.",
    characters: "characters", memory: "Conversation stays in this page’s memory. Refreshing or closing the page clears it.",
    transcript: "Conversation", catalogueRetry: "Reload sample passages",
    messages: {
      catalogFailure: "The sample passages could not be loaded. Please try again.",
      requestFailure: "The reply could not be completed. Your question is still here; you can try again.",
      timeout: "The reply took too long. Your question is still here; you can try again.",
      cancelled: "Reply cancelled. Your question is still here.",
      contextOverflow: "This conversation has reached its limit. Start a new conversation to continue; your current question has been kept here.",
      questionTooLong: "Please shorten your question to 2,000 characters or fewer. Your draft has been kept.",
      sessionEnded: "This local session has ended. Reopen the demo to start a new session.",
      sourceChanged: "Passage changed. A new conversation is ready.",
      reset: "A new conversation is ready.",
    },
  },
  zh: {
    language: "界面语言", project: "藏语语言实验室", title: "对话时，原文始终在旁。",
    intro: "体验提问、回复与原文之间的联系。", badge: "模拟演示",
    demo: "尚未连接语言模型。回复是模拟内容，不构成健康建议。",
    privacy: "请仅使用示例问题，不要输入个人信息或健康信息。",
    sourceStep: "01 / 原文", sourceTitle: "从一段文字开始", chooseSource: "选择示例原文",
    sourceChange: "更换原文将开始新对话，并清空当前草稿。",
    original: "原文", reviewPending: "语言审校待完成", nonclinical: "非临床示例",
    syntheticSource: "模拟示例文本", english: "英语", chinese: "汉语", tibetan: "藏语",
    loading: "正在加载示例原文…", retryCatalog: "重新加载", noSources: "暂时没有可用的示例原文。",
    chatStep: "02 / 对话", chatTitle: "试着提问", newConversation: "新对话",
    emptyTitle: "从这里开始对话", emptyBody: "围绕所选原文提问，查看模拟回复。",
    user: "你", assistant: "模拟回复", citation: "来源", readOriginal: "查看原文",
    question: "你的问题", placeholder: "围绕原文提问…", send: "发送问题", cancel: "取消回复",
    busy: "正在准备模拟回复…", questionHint: "最多 2,000 个字符。准备好后，请点击“发送问题”。",
    characters: "字符", memory: "对话仅保存在当前页面的内存中。刷新或关闭页面后，对话将被清除。",
    transcript: "对话内容", catalogueRetry: "重新加载示例原文",
    messages: {
      catalogFailure: "无法加载示例原文，请重试。",
      requestFailure: "未能完成回复。你的问题已保留，可以重试。",
      timeout: "回复等待超时。你的问题已保留，可以重试。",
      cancelled: "回复已取消，你的问题已保留。",
      contextOverflow: "本次对话已达到长度上限，请开始新对话。当前问题仍保留在这里。",
      questionTooLong: "请将问题缩短至 2,000 个字符以内。草稿已保留。",
      sessionEnded: "本地会话已结束，请重新打开演示以开始新会话。",
      sourceChanged: "原文已更换，可以开始新对话。",
      reset: "可以开始新对话了。",
    },
  },
} as const;

export default function ResearchChat() {
  const [language, setLanguage] = useState<Language>("en");
  const [sources, setSources] = useState<SourceCard[]>([]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "failed">("loading");
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const requestEpoch = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const activeDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const text = copy[language];
  const source = sources[sourceIndex];
  const draftLength = codePointLength(draft);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-Hans" : "en";
  }, [language]);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const deadline = setTimeout(() => {
      if (current) {
        current = false;
        controller.abort();
        setCatalogState("failed");
      }
    }, 10_000);
    async function load() {
      setCatalogState("loading");
      try {
        const response = await fetch("/api/catalog", {
          signal: controller.signal, cache: "no-store", credentials: "same-origin", redirect: "error",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("Catalog unavailable");
        const catalog = catalogSchema.parse(await response.json());
        if (!current) return;
        setSources(catalog.sources);
        setSourceIndex(0);
        setCatalogState("ready");
      } catch {
        if (current && !controller.signal.aborted) setCatalogState("failed");
      } finally {
        clearTimeout(deadline);
      }
    }
    void load();
    return () => { current = false; clearTimeout(deadline); controller.abort(); };
  }, [catalogAttempt]);

  useEffect(() => () => {
    requestEpoch.current += 1;
    activeRequest.current?.abort();
    if (activeDeadline.current !== null) clearTimeout(activeDeadline.current);
    inFlight.current = false;
  }, []);

  function stopRequest() {
    requestEpoch.current += 1;
    activeRequest.current?.abort();
    if (activeDeadline.current !== null) clearTimeout(activeDeadline.current);
    activeDeadline.current = null;
    activeRequest.current = null;
    inFlight.current = false;
    setBusy(false);
  }

  function resetConversation(nextSource?: number) {
    stopRequest();
    setTurns([]);
    setDraft("");
    if (nextSource !== undefined) setSourceIndex(nextSource);
    setNotice(nextSource === undefined ? "reset" : "sourceChanged");
    composer.current?.focus();
  }

  function cancelReply() {
    stopRequest();
    setNotice("cancelled");
    composer.current?.focus();
  }

  async function sendQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !source || !draft.trim()) return;
    if (draftLength > MAX_MESSAGE_CODEPOINTS) { setNotice("questionTooLong"); return; }
    const messages: ChatRequest["messages"] = turns.flatMap((turn) => [
      { role: "user" as const, content: turn.user },
      { role: "assistant" as const, content: turn.assistant },
    ]);
    messages.push({ role: "user", content: draft });
    if (messages.length > MAX_MESSAGES || messages.some((message) => codePointLength(message.content) > MAX_MESSAGE_CODEPOINTS)
      || messages.reduce((total, message) => total + codePointLength(message.content), 0) > MAX_CONVERSATION_CODEPOINTS) {
      setNotice("contextOverflow");
      return;
    }
    const request: ChatRequest = {
      schema_version: "1.0", request_id: `chat-${crypto.randomUUID()}`,
      source: { source_id: source.source_id, version: source.version, content_sha256: source.content_sha256 },
      messages,
    };
    const requestBody = JSON.stringify(request);
    if (new TextEncoder().encode(requestBody).byteLength > MAX_REQUEST_BYTES) {
      setNotice("contextOverflow");
      return;
    }
    const controller = new AbortController();
    const epoch = ++requestEpoch.current;
    activeRequest.current = controller;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    const deadline = setTimeout(() => {
      if (requestEpoch.current === epoch) {
        requestEpoch.current += 1;
        controller.abort();
        activeRequest.current = null;
        activeDeadline.current = null;
        inFlight.current = false;
        setBusy(false);
        setNotice("timeout");
        composer.current?.focus();
      }
    }, 15_000);
    activeDeadline.current = deadline;
    try {
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: requestBody, signal: controller.signal,
        cache: "no-store", credentials: "same-origin", redirect: "error",
      });
      if (requestEpoch.current !== epoch) return;
      if (!response.ok) {
        setNotice(response.status === 401 ? "sessionEnded" : "requestFailure");
        return;
      }
      const result = validateResponseForRequest(await response.json(), request);
      if (requestEpoch.current !== epoch) return;
      if (result.outcome !== "success" || result.answer === null) {
        setNotice(result.outcome === "timeout" ? "timeout" : result.outcome === "cancelled" ? "cancelled"
          : result.outcome === "context_overflow" ? "contextOverflow" : "requestFailure");
        return;
      }
      if (!result.citations.length || result.citations.some((citation) =>
        !sameCitation(source, citation) || !sources.some((item) => sameCitation(item, citation)))) {
        throw new Error("Unresolved citation");
      }
      const answer = result.answer;
      setTurns((previous) => [...previous, { user: draft, assistant: answer, citations: result.citations }]);
      setDraft("");
    } catch {
      if (requestEpoch.current === epoch) setNotice(controller.signal.aborted ? "cancelled" : "requestFailure");
    } finally {
      clearTimeout(deadline);
      if (requestEpoch.current === epoch) {
        activeRequest.current = null;
        activeDeadline.current = null;
        inFlight.current = false;
        setBusy(false);
        composer.current?.focus();
      }
    }
  }

  return (
    <main className="workspace">
      <header className="masthead">
        <div className="brand"><span className="brand-mark" aria-hidden="true">༄</span><span>{text.project}</span></div>
        <div className="language-control">
          <label htmlFor="interface-language">{text.language}</label>
          <select id="interface-language" value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
            <option value="en">English</option><option value="zh">简体中文</option>
          </select>
        </div>
      </header>
      <section className="introduction" aria-labelledby="page-title">
        <span className="eyebrow">{text.badge}</span>
        <h1 id="page-title">{text.title}</h1>
        <p>{text.intro}</p>
      </section>
      <aside className="demo-notice" aria-label={text.badge}>
        <span className="notice-symbol" aria-hidden="true">i</span>
        <div><p>{text.demo}</p><p className="muted">{text.privacy}</p></div>
      </aside>
      <div className="workbench">
        <section className="source-panel panel" aria-labelledby="source-title">
          <div className="panel-header"><span className="step">{text.sourceStep}</span><h2 id="source-title">{text.sourceTitle}</h2></div>
          {catalogState === "loading" && <p className="panel-state" role="status">{text.loading}</p>}
          {catalogState === "failed" && <div className="panel-state"><p role="alert">{text.messages.catalogFailure}</p>
            <button className="secondary-button" onClick={() => setCatalogAttempt((value) => value + 1)}>{text.retryCatalog}</button></div>}
          {catalogState === "ready" && !source && <p className="panel-state" role="status">{text.noSources}</p>}
          {source && catalogState === "ready" && <>
            <div className="source-picker">
              <label htmlFor="source-selector">{text.chooseSource}</label>
              <select id="source-selector" value={sourceIndex} aria-describedby="source-change-note"
                onChange={(event) => resetConversation(Number(event.target.value))}>
                {sources.map((item, index) => {
                  const excerpt = Array.from(item.original_text).slice(0, 72).join("");
                  return <option key={`${item.source_id}:${item.version}`} value={index}>
                    {index + 1} — {excerpt}{codePointLength(item.original_text) > 72 ? "…" : ""}
                  </option>;
                })}
              </select>
              <p id="source-change-note" className="field-hint">{text.sourceChange}</p>
            </div>
            <article className="passage-card" id="source-passage" tabIndex={-1} aria-labelledby="passage-title">
              <div className="source-meta"><span>{text.syntheticSource}</span><span>{source.language === "bo" ? text.tibetan : source.language === "zh" ? text.chinese : text.english}</span></div>
              <h3 id="passage-title">{source.title}</h3>
              <p className="original-text" lang={source.language} data-testid="original-passage">{source.original_text}</p>
              <div className="review-status"><span className="status-dot" aria-hidden="true" /><span>{text.reviewPending}</span></div>
              <p className="scope-note">{text.nonclinical}</p>
            </article>
          </>}
        </section>
        <section className="chat-panel panel" aria-labelledby="chat-title">
          <div className="panel-header chat-header"><div><span className="step">{text.chatStep}</span><h2 id="chat-title">{text.chatTitle}</h2></div>
            <button className="text-button" onClick={() => resetConversation()} disabled={!source}>{text.newConversation}</button></div>
          <div className="transcript" role="log" aria-label={text.transcript} aria-live="polite" aria-relevant="additions">
            {turns.length === 0 && <div className="empty-conversation"><span className="conversation-mark" aria-hidden="true">“</span>
              <h3>{text.emptyTitle}</h3><p>{text.emptyBody}</p></div>}
            {turns.map((turn, index) => <div className="conversation-turn" key={index}>
              <div className="message user-message"><span className="message-label">{text.user}</span><p>{turn.user}</p></div>
              <div className="message assistant-message"><span className="message-label"><span className="small-mark" aria-hidden="true">✳</span>{text.assistant}</span><p data-testid="assistant-answer">{turn.assistant}</p>
                <div className="citations">{turn.citations.map((citation, citationIndex) => {
                  const cited = sources.find((item) => sameCitation(item, citation));
                  return cited ? <a key={citationIndex} href="#source-passage" aria-label={`${text.readOriginal}: ${cited.title}`}>
                    <span className="citation-number">{citationIndex + 1}</span><span>{text.citation}: {cited.title}</span><span aria-hidden="true">↗</span>
                  </a> : null;
                })}</div>
              </div>
            </div>)}
          </div>
          <div className="composer-area">
            <div className="request-status" role="status" aria-live="polite" aria-atomic="true">
              {busy && <p className="busy-message"><span className="busy-dot" aria-hidden="true" />{text.busy}</p>}
              {notice && <p className={notice === "reset" || notice === "sourceChanged" || notice === "cancelled" ? "status-message" : "error-message"}>{text.messages[notice]}</p>}
            </div>
            <form onSubmit={sendQuestion}>
              <label htmlFor="question">{text.question}</label>
              <textarea id="question" ref={composer} value={draft} onChange={(event) => { setDraft(event.target.value); setNotice(null); }}
                placeholder={text.placeholder} readOnly={busy} disabled={!source || catalogState !== "ready"}
                aria-describedby="question-hint question-count" aria-invalid={draftLength > 2000} rows={3} />
              <p id="question-hint" className="field-hint">{text.questionHint}</p>
              <div className="composer-actions"><span id="question-count" className={`character-count${draftLength > 2000 ? " over-limit" : ""}`}>{draftLength.toLocaleString(language)} / 2,000 {text.characters}</span>
                {busy ? <button type="button" className="secondary-button" onClick={cancelReply}>{text.cancel}</button>
                  : <button type="submit" className="primary-button" disabled={!source || !draft.trim() || catalogState !== "ready"}>{text.send}<span aria-hidden="true">↑</span></button>}
              </div>
            </form>
          </div>
        </section>
      </div>
      <footer className="memory-note"><span aria-hidden="true">◌</span>{text.memory}</footer>
    </main>
  );
}
