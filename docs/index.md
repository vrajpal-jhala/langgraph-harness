---
layout: home

hero:
  name: langgraph-harness
  text: The engineering context platform for GitLab
  tagline: Reviews merge requests, resolves issues autonomously, and chats with full project context — remembering what matters so every run builds on the last.
  image:
    src: /logo.svg
    alt: langgraph-harness
    width: 320
    height: 320
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Features
      link: /features
    - theme: alt
      text: View on GitHub
      link: https://github.com/vrajpal-jhala/langgraph-harness
---

<div class="landing">

<section class="landing-section">
  <p class="landing-eyebrow">Workflows</p>
  <h2>Four ways to run</h2>

  <div class="landing-grid landing-grid--2">
    <div class="landing-item landing-item--surface">
      <div class="landing-item-head">
        <span class="landing-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" /></svg></span>
        <h3>MR Review</h3>
      </div>
      <span class="landing-badge">Webhook</span>
      <p>Fires on webhook events — reads the diff, drafts comments, and publishes them, no polling or manual trigger.</p>
    </div>
    <div class="landing-item landing-item--surface">
      <div class="landing-item-head">
        <span class="landing-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" /></svg></span>
        <h3>Issue Resolution</h3>
      </div>
      <span class="landing-badge">Issue</span>
      <p>Assign an issue and the agent implements the fix in a sandboxed checkout, opens a draft MR, and keeps responding to follow-up comments.</p>
    </div>
    <div class="landing-item landing-item--surface">
      <div class="landing-item-head">
        <span class="landing-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><path d="m7 11 2-2-2-2" /><path d="M11 13h4" /></svg></span>
        <h3>Task Resolution</h3>
      </div>
      <span class="landing-badge">Manual · Scheduled</span>
      <p>The same sandboxed loop, started from a free-text instruction instead of a GitLab issue — on demand or on a recurring schedule.</p>
    </div>
    <div class="landing-item landing-item--surface">
      <div class="landing-item-head">
        <span class="landing-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" /></svg></span>
        <h3>Chat</h3>
      </div>
      <span class="landing-badge">Interactive</span>
      <p>A GitLab-aware assistant with full GitLab access, live web fetch, image uploads, and semantic search across past reviews and project history.</p>
    </div>
  </div>
</section>

<section class="landing-section">
  <p class="landing-eyebrow">Trust</p>
  <h2>Kept honest</h2>

  <div class="landing-grid landing-grid--3">
    <div class="landing-item">
      <div class="landing-item-head">
        <span class="landing-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></svg></span>
        <h3>Guardrails &amp; Self-Correction</h3>
      </div>
      <p>A run that repeats a tool call, ends on an unfinished-looking question, or skips checking for new feedback gets caught and corrected mid-run, not after the fact.</p>
    </div>
    <div class="landing-item">
      <div class="landing-item-head">
        <span class="landing-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><path d="m16 9-5.5 5.5L8 12" /></svg></span>
        <h3>Quality Control Before Publish</h3>
      </div>
      <p>Every drafted comment is screened for low-value noise, and its diff position is verified before and after posting — GitLab's own publish response isn't trusted blindly.</p>
    </div>
    <div class="landing-item">
      <div class="landing-item-head">
        <span class="landing-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" /><path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9" /><path d="M12 12v3" /></svg></span>
        <h3>Sub-agents</h3>
      </div>
      <p>MR Review can spawn an isolated verifier for a single file's change, so its own investigation doesn't fill the parent run's context — findings come back reported, not just trusted.</p>
    </div>
  </div>
</section>

<section class="landing-section">
  <p class="landing-eyebrow">Operations</p>
  <h2>Memory, analytics, and self-hosting</h2>

  <div class="landing-grid landing-grid--3">
    <div class="landing-item">
      <div class="landing-item-head">
        <span class="landing-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18V5" /><path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" /><path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" /><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" /><path d="M18 18a4 4 0 0 0 2-7.464" /><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" /><path d="M6 18a4 4 0 0 1-2-7.464" /><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" /></svg></span>
        <h3>Durable Memory</h3>
      </div>
      <p>The agent flags durable, project-specific facts as it works — conventions, recurring false positives, team decisions — seeding every future run of the same project.</p>
    </div>
    <div class="landing-item">
      <div class="landing-item-head">
        <span class="landing-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></svg></span>
        <h3>Live Analytics</h3>
      </div>
      <p>A React admin UI shows live runs, queue state, and per-project analytics — reliability, guardrail health, comment acceptance rate, and more.</p>
    </div>
    <div class="landing-item">
      <div class="landing-item-head">
        <span class="landing-icon"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="8" x="2" y="2" rx="2" ry="2" /><rect width="20" height="8" x="2" y="14" rx="2" ry="2" /><line x1="6" x2="6.01" y1="6" y2="6" /><line x1="6" x2="6.01" y1="18" y2="18" /></svg></span>
        <h3>Self-Hostable</h3>
      </div>
      <p>A single Docker Compose stack. Bring your own GitLab instance, your own LLM backend (OpenRouter, Ollama, or sglang), and your own data.</p>
    </div>
  </div>
</section>

</div>
