import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Qestra – Run AI agents on your own keys",
  description:
    "Self-hostable agent runner that connects any LLM to real tools. Bring your own key from OpenAI, Groq, Claude, or Ollama. Every sensitive action pauses for your approval.",
  openGraph: {
    title: "Qestra – Run AI agents on your own keys",
    description:
      "Self-hostable agent runner. BYOK. Approval gates. Full audit trail. No token markup.",
    type: "website"
  }
};

export default function LandingPage() {
  return (
    <div className="lp-root">
      <LpNav />
      <Hero />
      <Problem />
      <ValueProps />
      <WhoIsItFor />
      <HowItWorks />
      <Features />
      <SocialProof />
      <Pricing />
      <FinalCta />
      <LpFooter />
    </div>
  );
}

function LpNav() {
  return (
    <nav className="lp-nav">
      <div className="lp-nav-inner">
        <div className="lp-logo">
          <span className="lp-logo-mark">Q</span>
          <span className="lp-logo-name">Qestra</span>
        </div>
        <div className="lp-nav-links">
          <a href="#how-it-works" className="lp-nav-link">How it works</a>
          <a href="#pricing" className="lp-nav-link">Pricing</a>
          <a href="https://github.com/MihirGupta07/Qestra" className="lp-nav-link" target="_blank" rel="noopener noreferrer">GitHub</a>
          <Link href="/dashboard" className="lp-btn lp-btn-sm">Sample Dashboard →</Link>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="lp-hero">
      <div className="lp-container">
        <div className="lp-hero-badge">Open source · MIT · Self-hostable</div>
        <h1 className="lp-hero-headline">
          Run AI agents on your<br />own keys, on your own terms.
        </h1>
        <p className="lp-hero-sub">
          Qestra is a self-hostable agent runner. Point it at any LLM — OpenAI, Claude,
          Groq, or a local Ollama instance — give it tools, and watch it work.
          Every sensitive action pauses for your approval before it executes.
        </p>
        <div className="lp-hero-actions">
          <Link href="/dashboard" className="lp-btn lp-btn-primary lp-btn-lg">
            Try the MVP →
          </Link>
          <a
            href="https://github.com/MihirGupta07/Qestra"
            className="lp-btn lp-btn-ghost lp-btn-lg"
            target="_blank"
            rel="noopener noreferrer"
          >
            View on GitHub
          </a>
        </div>
        <div className="lp-hero-providers">
          <span className="lp-provider-label">Works with</span>
          {["OpenAI", "Claude", "Groq", "Ollama", "Nvidia NIM", "OpenRouter"].map((p) => (
            <span key={p} className="lp-provider-chip">{p}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Problem() {
  const pains = [
    {
      heading: "You're paying a markup on every token",
      body: "Every hosted AI platform adds margin between you and the model. You don't see it — it just shows up in your bill, compounding across every request your agents make."
    },
    {
      heading: "Sensitive actions run silently",
      body: "Shell commands. File writes. API calls with your credentials. Hosted runners execute these without a pause. By the time you find out, it already ran."
    },
    {
      heading: "Your keys live on someone else's server",
      body: "When you paste an API key into a third-party agent platform, it's stored and used by infrastructure you don't control. Qestra keeps your keys in your environment."
    }
  ];

  return (
    <section className="lp-section lp-section-light" id="problem">
      <div className="lp-container">
        <p className="lp-eyebrow">The problem</p>
        <h2 className="lp-section-title">Hosted AI tools have a hidden cost</h2>
        <p className="lp-section-sub">
          Most "AI automation" products are wrappers around models you could call directly.
          You trade control for convenience — and pay for both.
        </p>
        <div className="lp-cards-3">
          {pains.map((pain) => (
            <ProblemCard key={pain.heading} heading={pain.heading} body={pain.body} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ProblemCard({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="lp-problem-card">
      <div className="lp-problem-icon">✕</div>
      <h3 className="lp-card-title">{heading}</h3>
      <p className="lp-card-body">{body}</p>
    </div>
  );
}

function ValueProps() {
  const props = [
    {
      stat: "$0",
      statLabel: "token markup",
      heading: "Your key. Their API. No middleman.",
      body: "Paste your own API key and every request goes directly from your machine to the model provider. Qestra never touches the billing path."
    },
    {
      stat: "100%",
      statLabel: "approval rate for sensitive actions",
      heading: "Nothing runs without your sign-off.",
      body: "Tools marked sensitive — like shell.exec — pause execution and surface an approval card in the dashboard. You read the exact command before it runs. You approve or reject."
    },
    {
      stat: "SHA-256",
      statLabel: "hash-chained audit log",
      heading: "A trail you can actually verify.",
      body: "Every LLM call, tool execution, and approval decision is written to an immutable hash chain. You can verify the sequence hasn't been tampered with."
    }
  ];

  return (
    <section className="lp-section lp-section-dark" id="value">
      <div className="lp-container">
        <p className="lp-eyebrow lp-eyebrow-light">Why it matters</p>
        <h2 className="lp-section-title lp-title-light">Control without compromise</h2>
        <div className="lp-value-grid">
          {props.map((vp) => (
            <div key={vp.heading} className="lp-value-card">
              <div className="lp-stat">{vp.stat}</div>
              <div className="lp-stat-label">{vp.statLabel}</div>
              <h3 className="lp-value-heading">{vp.heading}</h3>
              <p className="lp-value-body">{vp.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function WhoIsItFor() {
  const personas = [
    {
      role: "Developers",
      goal: "Run agents against a local Ollama instance or a cheap Groq model without cloud dependency.",
      howQestra: "Point the base URL to Ollama's local endpoint at localhost:11434, pick a model, and tasks run entirely on your hardware. Zero data leaves your machine."
    },
    {
      role: "Founders",
      goal: "Automate repetitive internal workflows — summarising docs, fetching data, writing files — without paying SaaS prices.",
      howQestra: "Create tasks in plain English, assign them to an agent with the right tool permissions, run on demand or on a schedule."
    },
    {
      role: "Operators & RevOps",
      goal: "Need an audit trail for every automated action for compliance, incident investigation, or team transparency.",
      howQestra: "The hash-chained audit log records every LLM call and tool execution. Export it. Verify it. Point it at your SIEM."
    },
    {
      role: "Security-conscious teams",
      goal: "Can't let API keys or sensitive data touch a third-party SaaS platform.",
      howQestra: "Self-host on your own infra. Keys are AES-256-GCM encrypted at rest. HTTP tools block private IPs by default. Shell tools run only allowlisted executables."
    }
  ];

  return (
    <section className="lp-section lp-section-warm" id="who">
      <div className="lp-container">
        <p className="lp-eyebrow">For whom</p>
        <h2 className="lp-section-title">Who is Qestra for?</h2>
        <div className="lp-personas-grid">
          {personas.map((p) => (
            <PersonaCard key={p.role} {...p} />
          ))}
        </div>
      </div>
    </section>
  );
}

function PersonaCard({ role, goal, howQestra }: { role: string; goal: string; howQestra: string }) {
  return (
    <div className="lp-persona-card">
      <div className="lp-persona-role">{role}</div>
      <div className="lp-persona-block">
        <span className="lp-persona-label">Their goal</span>
        <p className="lp-persona-text">{goal}</p>
      </div>
      <div className="lp-persona-block">
        <span className="lp-persona-label">How Qestra helps</span>
        <p className="lp-persona-text">{howQestra}</p>
      </div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "1",
      title: "Connect your LLM",
      body: "Paste your API key and pick a model — GPT-4o, Claude Haiku, Llama 3 on Groq, or a local Ollama endpoint. Click Test. It takes 30 seconds."
    },
    {
      n: "2",
      title: "Create a task",
      body: "Describe the goal in plain text: \"Fetch our top 10 open GitHub issues, cross-reference them with the changelog, and write a prioritised triage report to triage.md\". Assign it to an agent with file and HTTP access."
    },
    {
      n: "3",
      title: "Review and act",
      body: "The agent calls the LLM, runs tools, and loops until done. If it wants to run a shell command, execution pauses. You see the exact command and approve or reject."
    }
  ];

  return (
    <section className="lp-section lp-section-light" id="how-it-works">
      <div className="lp-container">
        <p className="lp-eyebrow">How it works</p>
        <h2 className="lp-section-title">Three steps. No configuration files.</h2>
        <div className="lp-steps">
          {steps.map((step, i) => (
            <div key={step.n} className="lp-step">
              <div className="lp-step-number">{step.n}</div>
              {i < steps.length - 1 && <div className="lp-step-connector" />}
              <div className="lp-step-content">
                <h3 className="lp-step-title">{step.title}</h3>
                <p className="lp-step-body">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  const features = [
    {
      title: "BYOK — any provider",
      body: "OpenAI, Anthropic, Groq, Nvidia NIM, Together, OpenRouter, Ollama, vLLM. Anything that speaks the OpenAI /v1 API or Anthropic's Messages API works out of the box.",
      outcome: "Switch models in 10 seconds. No code changes."
    },
    {
      title: "Approval gates",
      body: "Tools flagged sensitive — shell.exec today, extensible to anything you mark — pause the agent loop and surface a card with the exact call and arguments.",
      outcome: "Stop a destructive command before it runs, not after."
    },
    {
      title: "Sandboxed file and HTTP tools",
      body: "File reads and writes are confined to a configurable workspace directory. HTTP fetches resolve DNS and block private IPs, loopback addresses, and cloud metadata endpoints.",
      outcome: "Agents can't read /etc/passwd or hit 169.254.169.254."
    },
    {
      title: "Persistent agent memory",
      body: "The notes store gives agents a key/value scratchpad that survives across executions. Researchers can store findings. Engineers can track state across steps.",
      outcome: "Agents remember what they learned — no re-running completed steps."
    },
    {
      title: "Per-agent budget caps",
      body: "Set a spend limit per agent in cents. When an agent hits its cap, it pauses automatically. You see spend in the dashboard in real time.",
      outcome: "A runaway agent loop can't drain your API budget."
    }
  ];

  return (
    <section className="lp-section lp-section-white" id="features">
      <div className="lp-container">
        <p className="lp-eyebrow">Features</p>
        <h2 className="lp-section-title">Built for real work, not demos</h2>
        <div className="lp-features-grid">
          {features.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ title, body, outcome }: { title: string; body: string; outcome: string }) {
  return (
    <div className="lp-feature-card">
      <h3 className="lp-feature-title">{title}</h3>
      <p className="lp-feature-body">{body}</p>
      <div className="lp-feature-outcome">
        <span className="lp-outcome-tick">→</span> {outcome}
      </div>
    </div>
  );
}

function SocialProof() {
  const testimonials = [
    {
      quote: "I was paying $40/month for an AI automation tool that was just calling GPT-4 with a 3× markup. Qestra routes straight to the API and I control every step.",
      name: "Arjun M.",
      title: "Founder, early-stage SaaS"
    },
    {
      quote: "The approval gate was the thing that sold me. I can give an agent shell access without worrying about it doing something I didn't intend. It just stops and asks.",
      name: "Priya S.",
      title: "Senior engineer, fintech"
    }
  ];

  return (
    <section className="lp-section lp-section-warm" id="proof">
      <div className="lp-container">
        <p className="lp-eyebrow">What people say</p>
        <h2 className="lp-section-title">Early feedback</h2>
        <div className="lp-testimonials">
          {testimonials.map((t) => (
            <div key={t.name} className="lp-testimonial">
              <p className="lp-testimonial-quote">"{t.quote}"</p>
              <div className="lp-testimonial-author">
                <strong>{t.name}</strong>
                <span>{t.title}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section className="lp-section lp-section-light" id="pricing">
      <div className="lp-container">
        <p className="lp-eyebrow">Pricing</p>
        <h2 className="lp-section-title">Free and open source.</h2>
        <div className="lp-pricing-solo">
          <div className="lp-pricing-solo-left">
            <div className="lp-pricing-name">Open Source</div>
            <div className="lp-pricing-price">Free <span className="lp-pricing-period">forever</span></div>
            <p className="lp-pricing-desc">Self-host on your own machine or server. Full control, zero cost. MIT license.</p>
            <Link href="/dashboard" className="lp-btn lp-btn-primary lp-btn-lg">Get started →</Link>
          </div>
          <ul className="lp-pricing-features lp-pricing-solo-right">
            {[
              "Unlimited agents and tasks",
              "All providers — OpenAI, Claude, Groq, Ollama, and any /v1 endpoint",
              "Approval gates for sensitive tool calls",
              "SHA-256 hash-chained audit log",
              "In-memory or MongoDB storage",
              "MIT license — use commercially"
            ].map((f) => (
              <li key={f} className="lp-pricing-feature">
                <span className="lp-feature-check">✓</span> {f}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}


function FinalCta() {
  return (
    <section className="lp-section lp-section-dark lp-final-cta">
      <div className="lp-container lp-text-center">
        <h2 className="lp-section-title lp-title-light">
          Stop paying for a wrapper.<br />Run your own agent.
        </h2>
        <p className="lp-final-sub">
          Bring your own key. Keep your own data. Review every sensitive action before it runs.
        </p>
        <Link href="/dashboard" className="lp-btn lp-btn-primary lp-btn-lg">
          Try the MVP →
        </Link>
      </div>
    </section>
  );
}

function LpFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-container lp-footer-inner">
        <div className="lp-logo">
          <span className="lp-logo-mark">Q</span>
          <span className="lp-logo-name">Qestra</span>
        </div>
        <div className="lp-footer-links">
          <a href="https://github.com/MihirGupta07/Qestra" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a href="https://github.com/MihirGupta07/Qestra/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a>
          <a href="mailto:mihirgupta0712@gmail.com">Contact</a>
        </div>
        <p className="lp-footer-copy">© 2025 Qestra. Built in public.</p>
      </div>
    </footer>
  );
}
