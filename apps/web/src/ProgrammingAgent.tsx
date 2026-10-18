import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot, Check, ChevronDown, LoaderCircle, Plug, RotateCcw, SendHorizontal, ShieldCheck, Sparkles, Wrench } from 'lucide-react';
import { AgentChatError, getAgentConversation, getAgentStatus, getState, resetAgentConversation, streamAgentChat, type AgentMessage, type AgentPending, type AgentStep } from './api';
import { useWorkstation } from './store';
import './agent-chat.css';

const PROMPTS = [
  'Plan our two-night season and explain each pick',
  'Which film best serves the Gaming & Speculative Fiction crowd, and why?',
  'Rights to Her just fell through — fix the programme',
];
const TOOL_VERB: Record<string, string> = {
  get_workspace: 'Reading the workspace', get_taste_dna: 'Reading Qloo Taste DNA', search_films: 'Searching the catalogue', generate_programme: 'Running the solver',
  explain_film: 'Explaining a film', approve_programme: 'Preparing approval', withdraw_rights: 'Simulating the rights change', repair_programme: 'Repairing the programme',
  compare_versions: 'Comparing versions', export_programme: 'Preparing the export',
};

/** Tiny, safe formatter for the model's light markdown: paragraphs, "- " lists, **bold**, `code`. No HTML is ever injected. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, i) =>
    part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part);
}
export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = []; let list: string[] = [];
  const flush = () => { if (list.length) { blocks.push(<ul key={`l${blocks.length}`}>{list.map((x, i) => <li key={i}>{inline(x)}</li>)}</ul>); list = []; } };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const item = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) { list.push(item[1]!); continue; }
    flush();
    if (line) blocks.push(<p key={`p${blocks.length}`}>{inline(line)}</p>);
  }
  flush();
  return <div className="chat-rich">{blocks}</div>;
}

function ProvenanceBadge({ step }: { step: AgentStep }) {
  if (step.confirmedByUser) return <span className="badge green">Approved by you</span>;
  if (step.requiresConfirmation) return <span className="badge orange">Awaiting your confirmation</span>;
  if (!step.ok) return <span className="badge red">{step.code ?? 'Failed'}</span>;
  if (step.provenance === 'QLOO_LIVE') return <span className="badge green">Qloo live</span>;
  if (step.provenance === 'DEMO') return <span className="badge orange">Demo</span>;
  return null;
}
const argText = (args: Record<string, unknown>) => Object.entries(args).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ');

function StepList({ steps }: { steps: AgentStep[] }) {
  return <ol className="chat-steps-list">{steps.map(s => <li key={s.id} className={s.ok ? '' : s.requiresConfirmation ? 'is-held' : 'is-failed'}>
    <div className="chat-step-head"><code>{s.tool}</code><ProvenanceBadge step={s} />{s.mutated && <span className="badge neutral">Changed workspace</span>}</div>
    {Object.keys(s.args).length > 0 && <div className="chat-step-args">{argText(s.args)}</div>}
    <p>{s.summary}</p>
  </li>)}</ol>;
}
function StepTrace({ steps, defaultOpen = false }: { steps: AgentStep[]; defaultOpen?: boolean }) {
  if (!steps.length) return null;
  const mutated = steps.filter(s => s.mutated).length;
  return <details className="chat-steps" open={defaultOpen}>
    <summary><Wrench aria-hidden="true" /><span>What the agent did · {steps.length} tool call{steps.length === 1 ? '' : 's'}{mutated ? ` · ${mutated} changed the workspace` : ''}</span><ChevronDown className="chev" aria-hidden="true" /></summary>
    <StepList steps={steps} />
  </details>;
}

export function ProgrammingAgent() {
  const queryClient = useQueryClient();
  const ui = useWorkstation();
  const status = useQuery({ queryKey: ['agent-status'], queryFn: ({ signal }) => getAgentStatus(signal), staleTime: 60_000, retry: false });
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [pending, setPending] = useState<AgentPending | null>(null);
  const [live, setLive] = useState<{ tool: string | null; steps: AgentStep[] } | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const busy = live !== null;
  const available = status.data?.available === true;
  const max = status.data?.limits?.maxMessageChars ?? 1200;

  useEffect(() => {
    if (!available) return;
    const controller = new AbortController();
    getAgentConversation(controller.signal).then(c => { setMessages(c.messages); setPending(c.pendingApproval); }).catch(() => undefined).finally(() => setLoaded(true));
    return () => controller.abort();
  }, [available]);
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }, [messages.length, live?.steps.length, live?.tool, pending]);

  /** The agent edits the same workspace the other screens show: refresh it, and focus the newest programme version. */
  const refreshWorkspace = useCallback(async (steps: AgentStep[]) => {
    try {
      const state = await queryClient.fetchQuery({ queryKey: ['state'], queryFn: ({ signal }) => getState(signal), staleTime: 0 });
      if (steps.some(s => s.mutated || s.confirmedByUser)) ui.setSelectedVersionId(state.versions.at(-1)?.id ?? null);
    } catch { /* the workspace query shows its own error state */ }
    void queryClient.invalidateQueries({ queryKey: ['films'] });
    void queryClient.invalidateQueries({ queryKey: ['taste'] });
  }, [queryClient, ui]);

  const send = useCallback(async (body: { message: string } | { confirmApproval: string }) => {
    if (busy) return;
    setError(null); setLive({ tool: null, steps: [] });
    const stamp = new Date().toISOString();
    if ('message' in body) { setMessages(m => [...m, { id: `u${Date.now()}`, role: 'user', text: body.message, at: stamp }]); setPending(null); setInput(''); }
    else setMessages(m => [...m, { id: `u${Date.now()}`, role: 'user', text: 'Confirmed approval.', at: stamp }]);
    const seen: AgentStep[] = [];
    try {
      const result = await streamAgentChat(body, e => {
        if (e.type === 'step_start') setLive(l => l && { ...l, tool: e.tool });
        if (e.type === 'thinking') setLive(l => l && { ...l, tool: null });
        if (e.type === 'step') { seen.push(e.step); setLive(l => l && { tool: null, steps: [...l.steps, e.step] }); }
      });
      setMessages(m => [...m, { id: `a${Date.now()}`, role: 'assistant', text: result.reply, steps: result.steps, at: new Date().toISOString() }]);
      setPending(result.pendingApproval);
      await refreshWorkspace(result.steps);
    } catch (e) {
      const err = e instanceof AgentChatError ? e : null;
      const message = err?.message ?? 'Something went wrong reaching the agent. Please try again.';
      const steps = err?.steps?.length ? err.steps : seen;
      setMessages(m => [...m, { id: `e${Date.now()}`, role: 'assistant', text: message, steps, at: new Date().toISOString(), error: true }]);
      setPending(err?.pendingApproval ?? null);
      if (err?.code === 'AGENT_RATE_LIMITED' || err?.code === 'AGENT_DAILY_LIMIT') setError(message);
      if (steps.length) await refreshWorkspace(steps);
    } finally { setLive(null); }
  }, [busy, refreshWorkspace]);

  const submit = () => { const text = input.trim(); if (text && !busy) void send({ message: text }); };
  const reset = async () => { try { await resetAgentConversation(); setMessages([]); setPending(null); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not start a new conversation.'); } };

  const goMcp = () => { ui.setSurface('agent'); window.scrollTo({ top: 0 }); };
  if (status.isLoading) return <div className="agent-chat-wrap"><div className="chat-loading"><LoaderCircle className="spinner" /> Checking the agent…</div></div>;

  return <div className="agent-chat-wrap" id="agent-chat">
    <section className="chat-panel" aria-label="Programming agent chat">
      <header className="chat-header">
        <div className="chat-title"><Bot aria-hidden="true" /><div><h2>Programming agent</h2><span>Gemini function calling · same ten tools as MCP</span></div></div>
        <div className="chat-header-actions">
          {status.data?.scripted && <span className="badge orange" title="Offline development model that follows fixed plans. Not Gemini.">Scripted demo model</span>}
          {available && !status.data?.scripted && <span className="badge neutral">{status.data?.model}</span>}
          {available && messages.length > 0 && <button className="button small ghost" onClick={() => void reset()} disabled={busy}><RotateCcw />New conversation</button>}
        </div>
      </header>

      {!available ? <div className="chat-unavailable" role="status">
        <Bot aria-hidden="true" />
        <h3>Agent unavailable on this deployment</h3>
        <p>The in-app agent needs a Gemini API key, and this deployment doesn’t have one. Everything else in the workstation works as normal. You can still use the same Qloo-backed tools from your own agent, Claude Code or Claude Desktop, through MCP.</p>
        <button className="button primary" onClick={goMcp}><Plug />Connect your own agent via MCP</button>
      </div> : <>
        <div className="chat-scroll" ref={scrollRef} role="log" aria-live="polite" aria-label="Conversation">
          {loaded && messages.length === 0 && !busy && <div className="chat-welcome">
            <Sparkles aria-hidden="true" />
            <h3>Ask for a season, in plain language.</h3>
            <p>The agent calls the same tools you see in the workstation: it reads Qloo Taste DNA, asks the solver for a programme, and explains every pick. Watch each call as it happens. It cannot approve anything without you.</p>
            <div className="chat-chips" aria-label="Suggested prompts">{PROMPTS.map(p => <button key={p} className="chip-button" onClick={() => void send({ message: p })} disabled={busy}>{p}</button>)}</div>
          </div>}
          {messages.map(m => m.role === 'user'
            ? <div key={m.id} className="chat-msg user"><div className="bubble">{m.text}</div></div>
            : <div key={m.id} className={`chat-msg assistant ${m.error ? 'is-error' : ''}`}>
              <div className="avatar" aria-hidden="true">{m.error ? <AlertTriangle /> : <Bot />}</div>
              <div className="bubble">
                {m.steps && m.steps.length > 0 && <StepTrace steps={m.steps} />}
                {m.error ? <p className="chat-error-text">{m.text}</p> : <RichText text={m.text} />}
              </div>
            </div>)}
          {busy && <div className="chat-msg assistant live" aria-live="polite">
            <div className="avatar" aria-hidden="true"><Bot /></div>
            <div className="bubble">
              {live!.steps.length > 0 && <StepTrace steps={live!.steps} defaultOpen />}
              <div className="chat-progress"><LoaderCircle className="spinner" />{live!.tool ? <span>Calling <code>{live!.tool}</code>… <em>{TOOL_VERB[live!.tool] ?? ''}</em></span> : <span>{live!.steps.length ? 'Reading the results…' : 'Thinking…'}</span>}</div>
            </div>
          </div>}
          {pending && !busy && <div className="chat-confirm" role="group" aria-label="Approval needed">
            <div className="chat-confirm-text"><ShieldCheck aria-hidden="true" /><div><strong>Your decision</strong><span>The agent can’t approve for you. Approve <b>{pending.summary}</b>? This records a planning decision only; nothing is booked and no real rights are cleared.</span></div></div>
            <div className="chat-confirm-actions">
              <button className="button primary" onClick={() => void send({ confirmApproval: pending.versionId })}><Check />Confirm approval</button>
              <button className="button ghost" onClick={() => setPending(null)}>Not yet</button>
            </div>
          </div>}
        </div>

        {error && <div className="alert" role="alert"><AlertTriangle /><div>{error}</div></div>}
        <form className="chat-composer" onSubmit={e => { e.preventDefault(); submit(); }}>
          <label className="sr-only" htmlFor="agent-input">Message the programming agent</label>
          <textarea id="agent-input" value={input} rows={2} maxLength={max} placeholder="Ask about the programme, an audience, or a rights change…" disabled={busy}
            onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
          <div className="chat-composer-row">
            <small>{busy ? 'Working…' : `Enter to send · Shift+Enter for a new line${input.length > max * 0.8 ? ` · ${input.length}/${max}` : ''}`}</small>
            <button type="submit" className="button primary" disabled={busy || !input.trim()}>{busy ? <LoaderCircle className="spinner" /> : <SendHorizontal />}Send</button>
          </div>
        </form>
      </>}
    </section>

    <aside className="chat-rail" aria-label="About the programming agent">
      <div className="mini-heading"><ShieldCheck />How it stays honest</div>
      <ul>
        <li><b>The solver picks films</b>, not the model. The agent explains and operates; it can’t override a rights or budget rule.</li>
        <li><b>You approve.</b> It can ask, but only your “Confirm approval” click records a decision.</li>
        <li><b>Every call is shown</b> with its Qloo or demo provenance.</li>
        <li><b>Synthetic rights and fees.</b> Affinity is cultural relevance, not an attendance forecast.</li>
      </ul>
      <div className="chat-rail-foot">
        <p>Only synthetic programme data and Qloo aggregates are sent to the model. No personal data.</p>
        <button className="button small" onClick={goMcp}><Plug />Use your own agent via MCP</button>
      </div>
    </aside>
  </div>;
}
