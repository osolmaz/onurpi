---
name: parallel-agent-kickoff
description: Use as a top-level orchestrator when clustering issues/PRs that look similar and creating a real interactive/resumable agent session for each group. Triggers include requests to kick off, start, create, launch, or run parallel Codex/Claude/Pi sessions; run sequential Socratic prompts with plainerization; drive no-mutation auto-triage in each child session without editing or writing on the PR; or keep prompting child sessions until they are ready for human takeover with mostly maintainer decision making left.
---

# Parallel Agent Kickoff

Use this skill to cluster issues/PRs that look similar, then create a single agent session for each group.

When the session is kicked off, drive it with sequential prompts for Socratic questioning and plainerization. Then auto-triage in that same session without editing or writing on GitHub. The handoff should leave mostly decision making: duplicate or separate, local fix or good global solution, enough proof or more repro, land or rework, close or keep open.

## Orchestrator Contract

This skill is addressed to the top-level orchestrator agent.

The orchestrator must launch real interactive/resumable child sessions and drive them to a takeover-ready end state. Kickoff alone is incomplete.

- For Codex, create real interactive Codex sessions that the human can resume with `codex resume <session-id>`.
- A valid Codex launch path is an interactive terminal session, started in a PTY and then driven with stdin.
- When the user has asked for autonomous kickoff and the parent environment allows it, launch Codex in full-access/yolo mode: `codex --no-alt-screen -C <worktree> --dangerously-bypass-approvals-and-sandbox $'<prompt>'`.
- If that flag is unavailable, use the closest explicit full-access form: `codex --no-alt-screen -C <worktree> --sandbox danger-full-access -a never $'<prompt>'`.
- Do not use subagents, `spawn_agent`, hidden worker sessions, `codex exec`, or one-shot command equivalents for child work. Those produce reports, not sessions the human can inspect and take over.
- Do not require Codex Desktop visibility. A terminal `codex` session is acceptable when it is an interactive, resumable session recorded by Codex.
- If the user asks for Claude, Pi, or another agent family, use that family's standalone session mechanism instead of Codex sessions.
- Keep one child session per cluster unless the user asks for one session per item.
- Track every child session until it reaches a clear end state.
- Feed the sequential prompts into each child session as needed. The child should not stop after its first review answer when the answer is still abstract, proof-light, or missing the maintainer decision.
- Report session identifiers, resume command when available, stored title when available, cluster membership, current state, and the remaining human decision for every child session. Do not guess the title.

## Session Mechanism Guard

Before launching child work, decide whether the available mechanism creates a real interactive/resumable standalone session.

- Accept: an interactive `codex` terminal session, a Codex app session, or another agent family's equivalent resumable/takeover-capable session.
- Reject: subagents, `spawn_agent`, background workers, `codex exec`, report-only runs, or anything that cannot be resumed or inspected by the human.
- If no acceptable mechanism is available, do not fake it. Create or identify the worktree, prepare the exact kickoff prompt, and tell the user the session could not be launched as a real resumable session.
- After launch, verify the session id through Codex output, `~/.codex/history.jsonl`, `~/.codex/sessions`, or `codex resume`. If no stored title is available, say that instead of inventing one.
- Do not pass `$parallel-agent-kickoff`, the skill body, or any instruction to "use this skill" into a child session. The child session should receive only the concrete triage task.

## Orchestrator Session Launch

Sometimes the user wants this skill itself to run inside a separate Codex session. In that case:

- Launch a real interactive Codex session with the user's `$parallel-agent-kickoff ...` skill invocation as the prompt.
- Start that orchestrator session from the requested repo or worktree.
- Let that orchestrator session cluster the refs and launch its own child sessions.
- Do not replace that with `spawn_agent`, `codex exec`, or a paste-only prompt.
- Use full-access/yolo mode for this orchestrator session when the parent environment allows it, so it can create worktrees, launch child sessions, and write Codex session state without artificial workspace sandbox failures.

## Default Rules

- Cluster first. Put issues/PRs that look similar into a single session when they may share the same bug.
- Create individual sessions only when items are related but need separate code/proof decisions.
- Keep GitHub mutation out of these sessions unless the user explicitly asks for comments, labels, assignment, closing, or PR creation.
- Run child sessions in git worktrees. Use one dedicated worktree per cluster unless the user asks for a different shape.
- Resolve the source checkout before creating worktrees. Use the current working directory when it is the repo the user means; otherwise find the main checkout for the referenced repo. Then create child worktrees from that source checkout.
- The working directory in each kickoff prompt must be the cluster's worktree root, not the shared main checkout.
- "No mutation" means no GitHub writes and no tracked file changes unless asked. It does not mean read-only or workspace-sandboxed execution. Do not use a restrictive sandbox when it prevents worktree creation, Codex session state, dependency install, temp files, or test artifacts inside the worktree.
- Include the known summary and live repro result in the first prompt.
- Treat "plain language" as a comprehension check: what does the agent mean, exactly, and does the explanation make sense?
- After the child's first reply, always send `Write it plainer and shorter.` as the next prompt before continuing the triage arc.
- Send `Write it plainer and shorter.` again any time the child writes dense, overly technical, hard-to-follow prose instead of a maintainer-usable answer.
- Distinguish source inspection, unit proof, synthetic repro, live local repro, reported-environment repro, and production proof.
- Use real interactive/resumable Codex sessions for Codex work. If no standalone session mechanism is available, say so and provide the prompts ready to paste.

## Workflow

1. Gather the issue/PR set.
   - List each item as `(issue)` or `(PR)`.
   - Capture title, current state, linked items, current assignee if relevant, and known summary.
   - Capture the live repro result exactly, including "not live", "synthetic only", "blocked", or "not reproduced".

2. Cluster by likely root cause.
   - Group together items that share the same causal mechanism.
   - Keep adjacent-only items separate, even if they share keywords or a subsystem.
   - Use the mechanism as the cluster name.

3. Kick off one standalone session per cluster.
   - Kickoff happens here, after clustering.
   - Resolve the source checkout first: use the orchestrator's current repo when it matches the target repo, or find the main checkout for the repo named by the refs/user request.
   - Create or choose a dedicated git worktree for the cluster from that source checkout before launching the session.
   - Start the child session from that worktree root.
   - Use the kickoff prompt template below.
   - If multiple real standalone sessions can be started in parallel, start them in parallel.
   - If no real standalone session mechanism is available, create the prompts and tell the user which sessions failed to launch.
   - Keep the session no-mutation unless the user explicitly asks for writes.
   - The kickoff prompt must ask the child session to attempt a concrete repro or proof path when feasible.
   - Verify each launched session is discoverable before reporting it as started.

4. Drive the child sessions through the triage arc.
   - After the child's first reply, send `Write it plainer and shorter.`.
   - Identify the root cause in plain language.
   - Immediately judge local fix vs good global solution after root-cause finding.
   - Send `Write it plainer and shorter.` again whenever the child writes overly technical word diarrhea.
   - Map related refs, classify proof, and end with the maintainer decision and next action.

5. Drive Socratic follow-up prompts sequentially in that same session.
   - Treat the kickoff prompt as starting context.
   - Send one follow-up prompt at a time.
   - Wait for the child session's answer before sending the next prompt.
   - After the first agent response, always send `Write it plainer and shorter.`.
   - After that, send the follow-up prompts in order when the session answer is vague, proof-light, or decision-incomplete.
   - Repeat `Write it plainer and shorter.` whenever a later answer becomes overly technical or hard to follow.
   - Stop early only when the session already answers the maintainer decision clearly.

6. Drive every child session to human takeover.
   - Poll or inspect every child session until it answers the maintainer decision clearly.
   - Send the next Socratic prompt when a child session stalls at a generic review, skips proof classification, or fails to say local fix vs good global solution.
   - Mark a session takeover-ready only when the human can decide the next action without asking the child to explain the basics again.
   - Continue until all child sessions are takeover-ready, blocked for a concrete reason, or explicitly paused by the user.

## Kickoff Prompt Template

Use this structure for each session. Fill in concrete item numbers and evidence.

```text
Working directory: <absolute worktree path>. Start from that worktree and stay in that repository.

Worktree source repo: <absolute source checkout path, usually the orchestrator cwd when it is the target repo>.

Cluster: <short mechanism name>

Why these refs are grouped:
<brief, abstract rationale for why these issues/PRs look similar>

Items:
- #12345 (issue) - <title>. Summary: <one sentence>. Prior repro/proof context: <exact proof status>.
- #12346 (PR) - <title>. Summary: <one sentence>. Prior repro/proof context: <exact proof status>.

Task:
Inspect the current code, issue/PR state, linked work, and available proof. Attempt an appropriate repro or proof path yourself when feasible. Use the cheapest honest path first: source/test proof, focused unit or integration test, synthetic repro, local live repro, or remote/live environment proof when the issue actually needs it. If repro is unsafe, unavailable, too expensive, or requires credentials/hardware you do not have, say that clearly and use the strongest available proof instead.

First decide whether these items really belong in one session or should split. Then identify the root cause in plain language. After that, judge whether the available/current solution is a local fix or a good global solution. Identify what proof you ran, what happened, what proof was already available, what proof is still missing, what would be overkill, and what maintainer decision remains.

Keep GitHub and files unchanged unless explicitly asked. If you find a proposed comment or close/land recommendation, write it as draft text only.

Do not invoke orchestration skills from inside this child session. Do not create subagents or more child sessions. Do the triage work in this session.

End state:
Continue in this standalone session until you explain the maintainer decision, the recommended next action, and the proof behind it. The top-level orchestrator will keep prompting you if the answer is too abstract, missing proof classification, or missing the local fix vs good global solution judgment.
```

## Sequential Follow-Ups

Use these as follow-up prompts inside the same child session.

Each fenced block is one prompt turn. Send one block, read the child session's answer, then decide whether to send the next block. Do not batch multiple follow-up blocks into one message.

### 1. Plainerization

```text
Write it plainer and shorter.
```

Send this immediately after the child's first reply. Send it again whenever a later answer becomes overly technical, too long, or hard to use for a maintainer decision.

### 2. Local Fix Vs Good Global Solution

```text
Is this a local fix or a good global solution?

Answer plainly:
- what exact failure it fixes
- what remains uncovered
- whether it is provider/channel/model-specific
- where the real fix should live: core, plugin/channel/provider code, docs, tests, or config
- whether the global version would break existing behavior
```

### 3. Production Ready Solution

```text
What is the most elegant and long term production ready solution?
```

### 4. Holy Grail Check

```text
Is that the holy grail?
```

### 5. Relationship Map

```text
Map the related issues/PRs. Which are duplicates, which share the same root cause, which are adjacent only, and which are unrelated? If a single PR could fix multiple items, say exactly which ones and why.
```

### 6. Proof Test

```text
Classify the evidence:
- source inspection
- unit test
- synthetic repro
- local live repro
- remote/live environment repro
- CI proof
- blocked/unproven

What proof is enough for a maintainer decision here? What proof would be ideal but unnecessary?
```

### 7. Next Step

```text
Ok, what should we do next?
```

## Common Failure Guards

- If the agent says "async" or "streaming", force it to explain the blocking mechanics.
- If the agent says "timeout", force it to separate idle/stall detection, hard wall-clock timeout, provider heartbeat, and operator-configured budget.
- If the agent says "memory leak", force it to separate retained process memory from expected durable history/artifact growth.
- If the agent says "live repro", force it to name the real process, real provider/channel, environment, and observed before/after behavior.
- If the agent pulls in the current branch's PR as "this PR", verify the user actually meant that PR.
- If the agent requires a large environment-specific repro, ask whether that proof is necessary for the exact bug claim or whether it is proving a broader support claim.
- If a channel/plugin-specific PR reveals a product rule, reframe the global fix as a core contract first and the channel as one proving case.

## Output Shape

When reporting back to the user, keep it decision-focused:

- clusters created
- standalone sessions started or prompts prepared
- session identifiers and current state for each child session
- one-line reason for each grouping
- local fix vs good global solution judgment for each cluster
- proof status for each cluster
- decision left for the human
- any standalone sessions that failed to launch
