---
title: 'Agents are probabilistic: why evals come first in production'
description: 'I spent a week hand-checking 50 tickets to promote one agent change. Here is the eval framework I want instead: why evals matter, what they are, and how to run them before and after release.'
pubDate: 2026-10-04
tags: ['agents', 'evals', 'llm']
visibility: draft
---

A few months ago I joined an agent platform team in a payments organization at Amazon. We host AI agents for other teams: they resolve tickets, add comments, and triage incidents.

Recently I had to ship one change to one agent: a new system prompt, a new skill, a newer model, and thinking mode turned on. Simple question: is the new agent **better or worse**? We had no systematic way to answer it. So I pulled 50 recent tickets by hand, ran both versions, and compared what each one posted, ticket by ticket, with an LLM as the judge. Promoting that one change took about a week, and none of it was reusable for the next agent.

That is the gap: we don't yet have an evaluation framework that scales across every agent we host. So I looked at how the industry does it. This post is the framework I'd want us to build: why, what, and how.

## Why: you can't unit-test judgment

Most agent failures aren't in our code. They're in the model's decisions: the wrong tool, the wrong arguments, stopping too early, or posting something it shouldn't. Three things make that hard to catch:

- **Agents are non-deterministic.** One good run proves little. On τ-bench, the best function-calling agents solved under half the tasks, and succeeded on all 8 tries of the same task less than 25% of the time in retail [[1]](#ref-1).
- **Everything changes underneath you.** Model versions, prompts, skills, and tool schemas all move, and any of them can shift behavior without a code change.
- **Observability isn't evaluation.** In LangChain's 2026 survey of 1,340 practitioners, 89% had observability for their agents, but only 52.4% ran offline evals and 37.3% ran online evals [[2]](#ref-2). Traces tell you what happened; evals tell you whether it was right.

Without evals, teams end up in a reactive loop: problems surface in production, and fixing one breaks another [[3]](#ref-3). My 50-ticket week was that loop, done by hand.

## What: the vocabulary

Anthropic's guide to agent evals gives a useful shared language [[3]](#ref-3):

| Term | Meaning |
|---|---|
| Task | One test case: an input plus success criteria |
| Trial | One attempt at a task. Run several; results vary |
| Grader | What scores a trial: code, a model, or a human |
| Transcript | The full record of a run: messages, tool calls, reasoning |
| Outcome | The final state of the world, not just the reply |

Two kinds of suites matter. **Regression evals** check that the agent still does what it used to; they should stay near 100%. **Capability evals** measure what it can't do yet; they should start low.

And evals run in two places: **offline**, against a fixed dataset before release, and **online**, against real traffic after it. Offline gates the release; online watches what happens next.

## How, part 1: before release

Everything here runs against a **golden set**: real tasks with known good outcomes. Start with 20–50 tasks taken from real tickets and real failures, not hundreds of invented ones [[3]](#ref-3). Include cases where the right move is to do nothing.

| Check | What it answers |
|---|---|
| Regression gate | Does every golden task still pass after this model, prompt, skill, or tool change? Run it in CI on every change. |
| Quality checks | Pass/fail on specific behaviors ("Did it escalate to a human?") rather than vague 1–5 scores [[4]](#ref-4). |
| Trajectory grading | Did it pick the right tool, with the right arguments, and follow policy [[5]](#ref-5)? |
| Outcome checks | Is the final state correct, with no duplicate side effects? |
| Repeated trials | Run each task k times. pass^k, the chance that *all* k trials succeed, measures reliability, not luck [[1]](#ref-1), [[3]](#ref-3). |
| Safety cases | Prompt injection and policy-breaking tool calls. |
| Budgets | Cost and latency per task. A right answer that takes three minutes can still be a failure. |

An LLM judge is fine for the fuzzy parts, but only after you check it against human labels. If the judge and your experts disagree, the score means nothing [[4]](#ref-4).

With this in place, my 50-ticket week becomes one command: run the golden set on the old and new agent, and compare.

## How, part 2: after release

A golden set is a proxy for reality. Real traffic always contains something it doesn't.

**Shadow mode first.** Run the new agent on the same live tickets as the production agent, in parallel, but never show its output. Compare the two on the same checks you used offline: the same outcomes, the same tools, the same judge. Shadowing costs a second pipeline, but users never see a bad answer.

Then roll out in steps:

- **Canary.** Send a small slice of traffic, say 5–10%, to the new agent, and widen it only while the metrics hold.
- **Online evals.** Score a sample of production transcripts asynchronously with the same graders, and alert when quality drops.
- **Real signals.** Escalations to humans, reopened tickets, and user feedback are noisy, but they are ground truth.
- **Read transcripts.** A regular human pass catches what graders miss, and keeps the graders honest.

No single layer catches everything. Anthropic calls the combination a Swiss cheese model: each layer has holes, but stacked together, few failures get through [[3]](#ref-3).

## The flywheel

The most important arrow points backward. Every failure found in shadow, canary, or production becomes a new golden task. Over time the regression suite grows from real failures instead of imagined ones, and each promotion gets cheaper than the last.

For a platform team, that is the real payoff. A shared harness, golden sets per agent, and a standard promotion path turn "dial up an agent" from a week of manual work into a pipeline every hosted agent can use.

## Checklist

- Start a golden set of 20–50 real tasks per agent, including "do nothing" cases.
- Gate every model, prompt, skill, and tool change on regression evals in CI.
- Grade outcomes and trajectories, not just the final text; prefer pass/fail checks.
- Calibrate LLM judges against human labels.
- Run tasks more than once and track pass^k.
- Shadow before canary, canary before full rollout.
- Turn every production failure into a golden task.

## Question for you

How long does it take your team to promote a prompt or model change to an agent, and what tells you it's safe?

## References

- <span id="ref-1"></span>[1] S. Yao, N. Shinn, P. Razavi, and K. Narasimhan, "τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains," arXiv:2406.12045, 2024. [Online]. Available: <https://arxiv.org/abs/2406.12045>
- <span id="ref-2"></span>[2] LangChain, "State of Agent Engineering," 2026. [Online]. Available: <https://www.langchain.com/state-of-agent-engineering>
- <span id="ref-3"></span>[3] M. Grace, J. Hadfield, R. Olivares, and J. De Jonghe, "Demystifying evals for AI agents," *Anthropic Engineering*, Jan. 2026. [Online]. Available: <https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents>
- <span id="ref-4"></span>[4] H. Husain and S. Shankar, "AI Evals: Everything You Need to Know," *hamel.dev*. [Online]. Available: <https://hamel.dev/blog/posts/evals-faq/>
- <span id="ref-5"></span>[5] OpenAI, "Trace grading," *OpenAI API Documentation*. [Online]. Available: <https://developers.openai.com/api/docs/guides/trace-grading>
