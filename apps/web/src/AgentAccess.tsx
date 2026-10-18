import { useState, type ReactNode } from 'react';
import { Bot, Check, Copy, Plug, ShieldCheck, Sparkles } from 'lucide-react';
import './agent.css';

const TOOLS: Array<[string, string]> = [
  ['get_workspace', 'Cinema, slots, budget, cohorts and their cross-domain seeds, evidence mode, Qloo status'],
  ['get_taste_dna', 'Live Qloo cohort themes and per-film shared themes, with provenance'],
  ['search_films', 'Catalogue search with synthetic rights and slot eligibility'],
  ['generate_programme', 'Constrained solver: four films, cost, coverage, why-lines'],
  ['explain_film', 'Per-cohort Qloo rank, shared themes, seed-film handling'],
  ['approve_programme', 'Records a human decision (the agent must ask you first)'],
  ['withdraw_rights', 'Simulate a rights change; get a minimal-change repair draft'],
  ['repair_programme', 'Repair draft with a diff: swaps, cost delta, coverage moves'],
  ['compare_versions', 'Diff any two programme versions'],
  ['export_programme', 'Approved schedule plus an unsent rights-enquiry draft'],
];
const EXAMPLE_PROMPT = 'Plan a two-night season at the Lantern for our three audiences, explain each pick with Qloo themes, then tell me what happens if the rights to Her fall through.';

function CopyBlock({ label, text, onCopied }: { label: string; text: string; onCopied: (message: string) => void }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const area = document.createElement('textarea'); area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
      document.body.appendChild(area); area.select(); try { document.execCommand('copy'); } finally { document.body.removeChild(area); }
    }
    setDone(true); onCopied(`${label} copied.`); window.setTimeout(() => setDone(false), 2000);
  };
  return <div className="agent-code">
    <pre tabIndex={0} aria-label={label}><code>{text}</code></pre>
    <button className="button small" onClick={() => void copy()} aria-label={`Copy ${label}`}>{done ? <Check /> : <Copy />}{done ? 'Copied' : 'Copy'}</button>
  </div>;
}

function Snippet({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section className="agent-snippet"><h3>{title}</h3>{hint && <p>{hint}</p>}{children}</section>;
}

/** "Agent access": how existing agents (Claude Code, Claude Desktop, any MCP client) use this app's Qloo-backed tools. */
export function AgentAccessPanel({ onCopied, onOpenChat }: { onCopied: (message: string) => void; onOpenChat: () => void }) {
  const url = `${window.location.origin}/mcp`;
  const json = JSON.stringify({ mcpServers: { 'rights-resonance': { type: 'http', url } } }, null, 2);
  const stdio = JSON.stringify({ mcpServers: { 'rights-resonance': { command: 'pnpm', args: ['--silent', '--dir', '/path/to/rights-and-resonance', 'mcp'], env: { QLOO_API_KEY: 'optional: enables live Qloo mode' } } } }, null, 2);
  return <div className="agent-access">
    <section className="agent-banner">
      <div className="agent-banner-main"><Plug aria-hidden="true" />
        <div>
          <h2>Use it from any agent <span className="badge green">MCP · Streamable HTTP</span></h2>
          <p>Rights &amp; Resonance is an agentic tool. Point Claude Code, Claude Desktop or any MCP client at the endpoint below and the agent can read Qloo taste data, run the constrained solver, explain every pick and handle a rights change. Each connection gets its own isolated demo workspace.</p>
        </div>
      </div>
      <div className="eyebrow">MCP server URL</div>
      <CopyBlock label="MCP URL" text={url} onCopied={onCopied} />
    </section>

    <div className="agent-grid">
      <Snippet title="Claude Code" hint="Run once in your terminal:">
        <CopyBlock label="Claude Code command" text={`claude mcp add --transport http rights-resonance ${url}`} onCopied={onCopied} />
      </Snippet>
      <Snippet title="Claude Desktop and other clients" hint="Claude Desktop: Settings, Connectors, Add custom connector, paste the URL above. For clients that read a JSON file:">
        <CopyBlock label="JSON config" text={json} onCopied={onCopied} />
      </Snippet>
      <Snippet title="Local stdio (from a clone of the repo)" hint="Runs a private workspace on your machine. Add QLOO_API_KEY to use live Qloo; without it, ask the agent to use DEMO mode.">
        <CopyBlock label="stdio config" text={stdio} onCopied={onCopied} />
      </Snippet>
      <Snippet title="Try this prompt" hint="Paste into the connected agent:">
        <CopyBlock label="example prompt" text={EXAMPLE_PROMPT} onCopied={onCopied} />
      </Snippet>
    </div>

    <section className="agent-tools" aria-label="Available agent tools">
      <div className="mini-heading"><Sparkles />Ten tools, two prompts (plan_season, handle_rights_change)</div>
      <ul>{TOOLS.map(([name, text]) => <li key={name}><code>{name}</code><span>{text}</span></li>)}</ul>
      <p className="agent-guardrail"><ShieldCheck />Guardrails: the solver, not the model, picks films; approval is a separate human decision the agent must ask you for; rights and fees are synthetic; the Qloo key stays on the server.</p>
    </section>

    <section className="agent-chat-slot" id="agent-chat" aria-label="In-app agent">
      <div className="mini-heading"><Bot />Rather not set anything up?</div>
      <p>The workstation has its own Programming agent, powered by Gemini function calling over the same ten tools. Ask for a season in plain language and watch each tool call.</p>
      <button className="button primary" onClick={onOpenChat}><Bot />Open the Programming agent</button>
    </section>
  </div>;
}
