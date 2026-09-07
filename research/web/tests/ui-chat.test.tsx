// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResearchChat from "../components/ResearchChat";
import type { ChatRequest, ChatResponse, SourceCard } from "../lib/contracts";

const original = "ཀ་ ཁ་\n e\u0301 😀\n</script><img src=x onerror=alert(1)>";
const sources: SourceCard[] = [
  { source_id: "sample-one", version: 1, content_sha256: "a".repeat(64), title: "A small library", original_text: original,
    language: "bo", source_kind: "synthetic_fixture", scope: "nonclinical", language_review: "pending", medical_review: "not_applicable" },
  { source_id: "sample-two", version: 3, content_sha256: "b".repeat(64), title: "The afternoon bus", original_text: "The blue bus leaves at three.",
    language: "en", source_kind: "synthetic_fixture", scope: "nonclinical", language_review: "pending", medical_review: "not_applicable" },
];

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function success(request: ChatRequest, answer = "A complete simulated answer."): ChatResponse {
  return { schema_version: "1.0", request_id: request.request_id, outcome: "success", answer, citations: [request.source],
    model_identity: "fake://research-chat-v1", synthetic: true, input_tokens: null, output_tokens: null };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type ChatHandler = (request: ChatRequest, options: RequestInit) => Promise<Response> | Response;
let requests: ChatRequest[];
let requestOptions: RequestInit[];
let handler: ChatHandler;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  requests = [];
  requestOptions = [];
  handler = (request) => json(success(request));
  fetchMock = vi.fn(async (url: string, options: RequestInit = {}) => {
    if (url === "/api/catalog") return json({ schema_version: "1.0", mode: "synthetic_demo", sources });
    if (url !== "/api/chat") throw new Error(`Unexpected request: ${url}`);
    const request = JSON.parse(String(options.body)) as ChatRequest;
    requests.push(request);
    requestOptions.push(options);
    return handler(request, options);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openChat() {
  const view = render(<ResearchChat />);
  await screen.findByLabelText("Choose a sample passage");
  return view;
}

function writeQuestion(value = "What does this passage say?") {
  fireEvent.change(screen.getByLabelText("Your question"), { target: { value } });
}

function send() {
  fireEvent.click(screen.getByRole("button", { name: "Send question" }));
}

describe("source-based research conversation", () => {
  it("displays exact inert Unicode originals, pending review and an explicit synthetic boundary", async () => {
    const { container } = await openChat();
    expect(screen.getByTestId("original-passage").textContent).toBe(original);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByTestId("original-passage")).toHaveAttribute("lang", "bo");
    expect(screen.getByText("Language review pending")).toBeVisible();
    expect(screen.getByText("Nonclinical sample")).toBeVisible();
    expect(screen.getByText("No language model is connected. Replies are simulated and are not health advice.")).toBeVisible();
    expect(screen.queryByText(sources[0].content_sha256)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send question" })).toBeDisabled();
  });

  it("distinguishes passages with the same title using numbered exact excerpts", async () => {
    const sharedTitle = "Synthetic fixture";
    const firstText = "The community library opens at nine. " + "😀".repeat(80);
    fetchMock.mockImplementationOnce(() => Promise.resolve(json({ schema_version: "1.0", mode: "synthetic_demo", sources: [
      { ...sources[0], title: sharedTitle, original_text: firstText },
      { ...sources[1], title: sharedTitle, original_text: "A blue notebook is on the table." },
    ] })));
    await openChat();
    const select = screen.getByLabelText("Choose a sample passage") as HTMLSelectElement;
    expect(select.options[0].textContent?.trim()).toBe(`1 — ${Array.from(firstText).slice(0, 72).join("")}…`);
    expect(select.options[1].textContent?.trim()).toBe("2 — A blue notebook is on the table.");
    expect(screen.getByRole("heading", { name: sharedTitle })).toBeVisible();
    expect(screen.getByTestId("original-passage").textContent).toBe(firstText);
  });

  it("only publishes a complete valid reply and resolves its citation to the original source", async () => {
    await openChat();
    const answer = "ཀ་ e\u0301\n<strong>simulated</strong> 😀";
    handler = (request) => json(success(request, answer));
    const question = "  ཀ་ 😀\nA question?  ";
    writeQuestion(question);
    send();
    expect((await screen.findByTestId("assistant-answer")).textContent).toBe(answer);
    expect(screen.getByLabelText("Your question")).toHaveValue("");
    expect(screen.getByRole("link", { name: "Read original passage: A small library" })).toHaveAttribute("href", "#source-passage");
    expect(requests[0].messages).toEqual([{ role: "user", content: question }]);
    expect(requests[0].source).toEqual({ source_id: "sample-one", version: 1, content_sha256: "a".repeat(64) });
    expect(requestOptions[0]).toMatchObject({ credentials: "same-origin", cache: "no-store", redirect: "error", method: "POST" });
    expect(document.querySelector(".assistant-message strong")).toBeNull();
  });

  it("keeps only successful turns in later requests and retains the draft after a failed attempt", async () => {
    await openChat();
    writeQuestion("First question"); send();
    await screen.findByTestId("assistant-answer");
    handler = () => json({ error: { code: "internal", message: "Do not display internals" } }, 500);
    writeQuestion("Second question"); send();
    await screen.findByText(/The reply could not be completed/);
    expect(screen.getByLabelText("Your question")).toHaveValue("Second question");
    expect(screen.getAllByTestId("assistant-answer")).toHaveLength(1);
    expect(screen.queryByText("Do not display internals")).not.toBeInTheDocument();
    handler = (request) => json(success(request, "The retried complete answer."));
    send();
    await screen.findByText("The retried complete answer.");
    expect(requests[2].messages).toEqual([
      { role: "user", content: "First question" }, { role: "assistant", content: "A complete simulated answer." },
      { role: "user", content: "Second question" },
    ]);
    expect(requests[2].request_id).not.toBe(requests[1].request_id);
  });

  it.each(["timeout", "cancelled", "context_overflow", "runtime_failure"] as const)("withholds all output and keeps the question on %s", async (outcome) => {
    await openChat();
    handler = (request) => json({ ...success(request), outcome, answer: null, citations: [] });
    writeQuestion("Keep this question"); send();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel reply" })).not.toBeInTheDocument());
    expect(screen.queryByTestId("assistant-answer")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Your question")).toHaveValue("Keep this question");
    expect(screen.getByRole("status")).not.toBeEmptyDOMElement();
  });

  it.each([
    ["unknown source", (response: ChatResponse) => ({ ...response, citations: [{ ...response.citations[0], source_id: "unknown" }] })],
    ["wrong version", (response: ChatResponse) => ({ ...response, citations: [{ ...response.citations[0], version: 2 }] })],
    ["wrong hash", (response: ChatResponse) => ({ ...response, citations: [{ ...response.citations[0], content_sha256: "f".repeat(64) }] })],
    ["wrong request", (response: ChatResponse) => ({ ...response, request_id: "another-request" })],
    ["partial failure", (response: ChatResponse) => ({ ...response, outcome: "timeout", citations: [] })],
    ["unknown fields", (response: ChatResponse) => ({ ...response, unauthorized: true })],
    ["wrong identity", (response: ChatResponse) => ({ ...response, model_identity: "real-model" })],
    ["missing citation", (response: ChatResponse) => ({ ...response, citations: [] })],
  ] as const)("rejects %s without showing its text", async (_label, mutate) => {
    await openChat();
    handler = (request) => json(mutate(success(request, "Unsafe unvalidated text")));
    writeQuestion("A retained draft"); send();
    await screen.findByText(/The reply could not be completed/);
    expect(screen.queryByText("Unsafe unvalidated text")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Your question")).toHaveValue("A retained draft");
  });

  it("waits for the complete response body before displaying anything", async () => {
    await openChat();
    const body = deferred<unknown>();
    handler = () => ({ ok: true, status: 200, json: () => body.promise }) as Response;
    writeQuestion(); send();
    await screen.findByRole("button", { name: "Cancel reply" });
    expect(screen.queryByTestId("assistant-answer")).not.toBeInTheDocument();
    await act(async () => { body.resolve(success(requests[0])); });
    await screen.findByTestId("assistant-answer");
  });

  it("cancels immediately, retains the draft and ignores an old success during a new request", async () => {
    await openChat();
    const oldRequest = deferred<Response>();
    const nextRequest = deferred<Response>();
    handler = () => requests.length === 1 ? oldRequest.promise : nextRequest.promise;
    writeQuestion("First draft"); send();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel reply" }));
    expect(requestOptions[0].signal?.aborted).toBe(true);
    expect(screen.getByLabelText("Your question")).toHaveValue("First draft");
    expect(screen.getByLabelText("Your question")).not.toHaveAttribute("readonly");
    writeQuestion("Replacement draft"); send();
    await act(async () => { oldRequest.resolve(json(success(requests[0], "Stale answer"))); });
    expect(screen.queryByText("Stale answer")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel reply" })).toBeVisible();
    await act(async () => { nextRequest.resolve(json(success(requests[1], "Current answer"))); });
    expect(await screen.findByText("Current answer")).toBeVisible();
    expect(screen.getByLabelText("Your question")).toHaveValue("");
    expect(requests[1].messages).toEqual([{ role: "user", content: "Replacement draft" }]);
  });

  it.each(["request", "body"] as const)("times out a stalled chat %s and rejects its late success after retry", async (hang) => {
    await openChat();
    vi.useFakeTimers();
    const pendingRequest = deferred<Response>();
    const pendingBody = deferred<unknown>();
    handler = () => hang === "request" ? pendingRequest.promise
      : ({ ok: true, status: 200, json: () => pendingBody.promise }) as Response;
    writeQuestion("Keep my question"); send();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByText(/The reply took too long/)).toBeVisible();
    expect(requestOptions[0].signal?.aborted).toBe(true);
    expect(screen.getByLabelText("Your question")).toHaveValue("Keep my question");
    expect(screen.getByLabelText("Your question")).not.toHaveAttribute("readonly");
    vi.useRealTimers();
    handler = (request) => json(success(request, "Completed retry"));
    send();
    await screen.findByText("Completed retry");
    await act(async () => {
      pendingRequest.resolve(json(success(requests[0], "Expired reply")));
      pendingBody.resolve(success(requests[0], "Expired reply"));
    });
    expect(screen.queryByText("Expired reply")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("assistant-answer")).toHaveLength(1);
  });

  it.each(["reset", "source change"] as const)("aborts and rejects late response body completion after %s", async (action) => {
    await openChat();
    const body = deferred<unknown>();
    handler = () => ({ ok: true, status: 200, json: () => body.promise }) as Response;
    writeQuestion("Draft to clear"); send();
    await screen.findByRole("button", { name: "Cancel reply" });
    if (action === "reset") fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    else fireEvent.change(screen.getByLabelText("Choose a sample passage"), { target: { value: "1" } });
    expect(requestOptions[0].signal?.aborted).toBe(true);
    expect(screen.getByLabelText("Your question")).toHaveValue("");
    await act(async () => { body.resolve(success(requests[0], "Late hidden text")); });
    expect(screen.queryByText("Late hidden text")).not.toBeInTheDocument();
    handler = (request) => json(success(request, "New conversation answer"));
    writeQuestion("New question"); send();
    await screen.findByText("New conversation answer");
    expect(requests[1].messages).toEqual([{ role: "user", content: "New question" }]);
    expect(requests[1].source.source_id).toBe(action === "reset" ? "sample-one" : "sample-two");
  });

  it("prevents two synchronous submissions from starting parallel requests", async () => {
    const view = await openChat();
    const pending = deferred<Response>();
    handler = () => pending.promise;
    writeQuestion();
    const form = view.container.querySelector("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(requests).toHaveLength(1);
    expect(screen.getByLabelText("Your question")).toHaveAttribute("readonly");
    fireEvent.click(screen.getByRole("button", { name: "Cancel reply" }));
    await act(async () => { pending.resolve(json(success(requests[0]))); });
  });

  it("aborts pending requests on unmount without persisting a conversation", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem");
    const set = vi.spyOn(Storage.prototype, "setItem");
    const remove = vi.spyOn(Storage.prototype, "removeItem");
    const view = await openChat();
    const pending = deferred<Response>();
    handler = () => pending.promise;
    writeQuestion("Memory only"); send();
    view.unmount();
    expect(requestOptions[0].signal?.aborted).toBe(true);
    await act(async () => { pending.resolve(json(success(requests[0]))); });
    await openChat();
    expect(screen.getByLabelText("Your question")).toHaveValue("");
    expect(screen.queryByTestId("assistant-answer")).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("switches the controls to Chinese without changing original text or the draft", async () => {
    await openChat();
    writeQuestion("ཀ་ retained draft");
    fireEvent.change(screen.getByLabelText("Interface language"), { target: { value: "zh" } });
    expect(screen.getByLabelText("你的问题")).toHaveValue("ཀ་ retained draft");
    expect(screen.getByRole("button", { name: "发送问题" })).toBeVisible();
    expect(screen.getByText("语言审校待完成")).toBeVisible();
    expect(screen.getByTestId("original-passage").textContent).toBe(original);
    expect(document.documentElement).toHaveAttribute("lang", "zh-Hans");
  });

  it("counts Unicode code points and keeps overlong questions intact", async () => {
    await openChat();
    writeQuestion("😀".repeat(2000)); send();
    await screen.findByTestId("assistant-answer");
    expect(requests[0].messages[0].content).toBe("😀".repeat(2000));
    writeQuestion("😀".repeat(2001)); send();
    expect(screen.getByText(/Please shorten your question/)).toBeVisible();
    expect(screen.getByLabelText("Your question")).toHaveValue("😀".repeat(2001));
    expect(screen.getByLabelText("Your question")).toHaveAttribute("aria-invalid", "true");
    expect(requests).toHaveLength(1);
  });

  it("explains the turn limit without truncating history or sending another request", async () => {
    await openChat();
    for (let index = 0; index < 5; index += 1) {
      writeQuestion(`Question ${index}`); send();
      await waitFor(() => expect(screen.getAllByTestId("assistant-answer")).toHaveLength(index + 1));
    }
    writeQuestion("The sixth question"); send();
    expect(screen.getByText(/This conversation has reached its limit/)).toBeVisible();
    expect(requests).toHaveLength(5);
    expect(requests[4].messages).toHaveLength(9);
    expect(screen.getAllByTestId("assistant-answer")).toHaveLength(5);
    expect(screen.getByLabelText("Your question")).toHaveValue("The sixth question");
  });

  it("checks the combined context budget instead of silently dropping earlier messages", async () => {
    await openChat();
    handler = (request) => json(success(request, "a".repeat(1900)));
    for (let index = 0; index < 2; index += 1) {
      writeQuestion("q".repeat(1900)); send();
      await waitFor(() => expect(screen.getAllByTestId("assistant-answer")).toHaveLength(index + 1));
    }
    writeQuestion("q".repeat(1900)); send();
    expect(screen.getByText(/This conversation has reached its limit/)).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(screen.getByLabelText("Your question")).toHaveValue("q".repeat(1900));
  });

  it("checks serialized request bytes before sending and explains the context limit", async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve(json({ schema_version: "1.0", mode: "synthetic_demo", sources: [
      { ...sources[0], source_id: "x".repeat(65_536) }, sources[1],
    ] })));
    await openChat();
    writeQuestion("A short question"); send();
    expect(screen.getByText(/This conversation has reached its limit/)).toBeVisible();
    expect(requests).toHaveLength(0);
    expect(screen.getByLabelText("Your question")).toHaveValue("A short question");
  });

  it("requires a new conversation when a valid long reply cannot fit the next request", async () => {
    await openChat();
    handler = (request) => json(success(request, "a".repeat(2001)));
    writeQuestion(); send();
    await screen.findByTestId("assistant-answer");
    writeQuestion("Continue"); send();
    expect(screen.getByText(/This conversation has reached its limit/)).toBeVisible();
    expect(requests).toHaveLength(1);
  });

  it("can retry an unavailable catalogue without allowing a question against missing sources", async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error("Unavailable")));
    render(<ResearchChat />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The sample passages could not be loaded");
    expect(screen.getByLabelText("Your question")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Try loading again" }));
    await screen.findByLabelText("Choose a sample passage");
    expect(screen.getByLabelText("Your question")).not.toBeDisabled();
  });

  it.each(["request", "body"] as const)("times out a stalled catalogue %s and ignores its late completion", async (hang) => {
    vi.useFakeTimers();
    const pendingRequest = deferred<Response>();
    const pendingBody = deferred<unknown>();
    fetchMock.mockImplementationOnce(() => hang === "request" ? pendingRequest.promise
      : Promise.resolve({ ok: true, status: 200, json: () => pendingBody.promise } as Response));
    render(<ResearchChat />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("The sample passages could not be loaded");
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    vi.useRealTimers();
    fireEvent.click(screen.getByRole("button", { name: "Try loading again" }));
    await screen.findByLabelText("Choose a sample passage");
    fireEvent.change(screen.getByLabelText("Choose a sample passage"), { target: { value: "1" } });
    await act(async () => {
      const oldCatalog = { schema_version: "1.0", mode: "synthetic_demo", sources };
      pendingRequest.resolve(json(oldCatalog));
      pendingBody.resolve(oldCatalog);
    });
    expect(screen.getByLabelText("Choose a sample passage")).toHaveValue("1");
    expect(screen.getByTestId("original-passage")).toHaveTextContent("The blue bus leaves at three.");
  });

  it("rejects a catalogue with an unexpected review state", async () => {
    fetchMock.mockImplementationOnce(() => Promise.resolve(json({ schema_version: "1.0", mode: "synthetic_demo", sources: [
      { ...sources[0], language_review: "approved" }, sources[1],
    ] })));
    render(<ResearchChat />);
    await screen.findByRole("alert");
    expect(screen.queryByTestId("original-passage")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Your question")).toBeDisabled();
  });

  it("explains an expired local session without showing backend details", async () => {
    await openChat();
    handler = () => json({ error: { code: "unauthorized", message: "Internal authentication detail" } }, 401);
    writeQuestion(); send();
    await screen.findByText(/This local session has ended/);
    expect(screen.queryByText("Internal authentication detail")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Your question")).toHaveValue("What does this passage say?");
  });
});
