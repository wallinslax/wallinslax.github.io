---
title: 'Agents are async: why "redrive with the same request ID" breaks idempotency'
description: 'A customer asked us to re-run failed agent workflows under the same request ID. Here is why that breaks idempotency, auditability, and tracing, and what to build instead.'
pubDate: 2026-10-03
tags: ['agents', 'api-design', 'idempotency']
---

I work on a platform where customers host AI agents that do real work: resolving tickets, adding comments, triaging incidents. One customer's service calls our API to trigger their agent directly. Recently they asked for something that sounded reasonable:

> "If a run fails with a transient backend error, let us call again with the **same request ID** and a `retryable` flag, so the whole workflow runs again."

It sounds like a retry. It isn't. This post explains why, and what a safe design looks like. The thinking leans heavily on the AWS Builders' Library article [Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/).

## The API we have

There is one endpoint, `/query`, and it does two jobs:

1. **First call** with a new `queryId`: starts the agent workflow.
2. **Later calls** with the same `queryId`: return the workflow's progress.

```http
POST /query
{ "queryId": "q-123", "input": "Triage incident INC-42" }
```

Behind it, an LLM runs for seconds to minutes and calls MCP tools along the way. Those tools have side effects: a comment is posted, a ticket changes state, someone gets paged.

So `/query` is "create or get" in one call. That works because the `queryId` means exactly one thing: **this one execution**. Calling again is safe, because the server sees a known ID and returns what it already has. That is idempotency doing its job.

## Why "same ID, run it again" is the wrong fix

An idempotency key is a promise: *every request with this key refers to the same single operation, and gets the same outcome.* The Builders' Library article frames it as **semantic equivalence**: a repeated request must mean the same thing as the original, and the caller must be able to treat the response as the result of that one operation.

Redriving under the same ID breaks that promise in several ways:

- **Terminal states stop being terminal.** `FAILED` was a fact about what happened. Re-running under the same ID overwrites it with `RUNNING`, then maybe `SUCCEEDED`. The history of what actually happened is gone.
- **Auditability breaks.** For an agent that posts comments and changes tickets, "what did run `q-123` do?" must have one stable answer. With redrive it depends on *when* you ask.
- **Tracing breaks.** Logs, traces, and metrics keyed by `q-123` now mix two different executions. Debugging the first failure gets harder exactly when you need it.
- **Clients get confused.** Any poller that already saw `FAILED` and cached it now disagrees with the server. Two pollers with the same ID can race: one sees the old run, one sees the new.
- **Side effects can repeat.** The first run may have posted two comments before failing. Running everything again posts them again, unless every tool is idempotent too.

The customer's real need is valid: *transient failures should be recoverable.* The fix is to make that recovery a **new, linked execution**, not a rewrite of the old one.

## The root cause: one endpoint, two jobs

An async workflow is a resource with a lifecycle. It wants the usual create/read split:

```http
POST /queries                  # create an execution (idempotency key in header)
Idempotency-Key: 8f1c...
→ 202 Accepted  { "queryId": "q-123", "status": "RUNNING" }

GET  /queries/q-123            # read progress; always safe to repeat
→ 200 OK        { "status": "FAILED", "error": { "retryable": true } }
```

Redrive then becomes its own explicit operation that creates a **new** execution pointing at the old one:

```http
POST /queries/q-123/retries
Idempotency-Key: 5d2e...
→ 202 Accepted  { "queryId": "q-124", "retryOf": "q-123", "status": "RUNNING" }
```

Now `q-123` stays `FAILED` forever, `q-124` has its own trace, and the lineage `q-123 → q-124` is explicit and auditable.

## If you can't change the API shape yet

We only have `/query` today, and customers depend on it. You can still keep the guarantees by adding a field instead of reusing the ID:

```http
POST /query
{ "queryId": "q-124", "retryOf": "q-123", "input": "Triage incident INC-42" }
```

The server-side rules:

```python
def handle_query(req):
    existing = store.get(req.query_id)
    if existing:
        # Same ID: never re-run. Reject if the request means something different.
        if existing.fingerprint != fingerprint(req):
            raise Conflict("queryId reused with different parameters")
        return existing.status_view()

    if req.retry_of:
        parent = store.get(req.retry_of)
        if parent is None or parent.status != "FAILED" or not parent.error.retryable:
            raise BadRequest("retryOf must point to a failed, retryable query")

    execution = store.create(           # conditional write: fails if the ID already exists
        query_id=req.query_id,
        retry_of=req.retry_of,
        fingerprint=fingerprint(req),
        status="RUNNING",
    )
    start_workflow(execution)
    return execution.status_view()
```

Three details matter:

1. **Create with a conditional write** (for example a DynamoDB `attribute_not_exists` condition), so two concurrent first calls can't both start a run.
2. **Fingerprint the request.** If someone reuses an ID with a different input, return a conflict instead of silently handing back an unrelated result. The Builders' Library calls this out explicitly.
3. **Validate the parent.** Only allow a redrive from a terminal, retryable failure. Never from `RUNNING` or `SUCCEEDED`.

## Idempotency has to reach the tools

A new execution ID fixes the bookkeeping, but the side effects from the failed run already happened. If run `q-123` posted a comment before it failed, `q-124` will post it again unless something stops it.

Two ways to handle that, and agent platforms usually need both:

- **Idempotent tools.** Derive a key for each tool call from stable values, such as `hash(rootQueryId, stepId, toolName)`, and have the tool dedupe on it. Use the *root* of the retry chain, so a redrive maps to the same keys for the same logical step. Don't let the LLM invent the key, and don't hash the LLM's arguments either: neither is stable across runs.
- **Resume, don't restart.** Checkpoint completed steps. A redrive can then skip steps that already succeeded and continue from the failure point, instead of replaying the whole plan.

## Checklist

- One request ID means one execution, forever.
- Terminal states are immutable. Recovery creates a new execution.
- Link retries explicitly (`retryOf`) so lineage is auditable.
- Use conditional writes when creating executions.
- Reject an ID reused with different parameters.
- Split create and read for async work when you can.
- Push idempotency down to every tool with side effects.

Agents make all of this more pressing, not less. They are long-running, they retry, and they touch real systems. The safest assumption is that every operation will run more than once, so design for that from the start.
