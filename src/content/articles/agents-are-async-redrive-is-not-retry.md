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

There is one endpoint, `/query`, and three IDs:

| ID | Who creates it | What it names |
|---|---|---|
| `requestId` | Client | One *call*. It is the idempotency key, kept for a few days. |
| `queryId` | Server | One *execution* of the agent. Permanent, and the record we audit and trace. |
| `conversationId` | Server | A thread of work. Many queries can share one conversation. |

`/query` does two jobs:

1. **First call** with a new `requestId`: the server creates query `q-123` and starts the agent workflow.
2. **Later calls** with the same `requestId`: return the progress of `q-123`.

```http
POST /query
{ "requestId": "r-1", "conversationId": "c-7", "input": "Triage incident INC-42" }
→ { "queryId": "q-123", "status": "RUNNING" }
```

Behind it, an LLM runs for seconds to minutes and calls MCP tools along the way. Those tools have side effects: a comment is posted, a ticket changes state, someone gets paged.

So `/query` is "create or get" in one call. That works because a `requestId` maps to exactly one `queryId`: **this one execution**. Calling again is safe, because the server sees a known request ID and returns what it already has. That is idempotency doing its job.

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

An async workflow is a resource with a lifecycle. It wants the usual create/read split, which Microsoft documents as the [Asynchronous Request-Reply pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/async-request-reply): `POST` starts the work and returns `202 Accepted`, and `GET` reads its status:

```http
POST /queries                  # create; the client's requestId is the idempotency key
Idempotency-Key: r-1
{ "conversationId": "c-7", "input": "Triage incident INC-42" }
→ 202 Accepted  { "queryId": "q-123", "status": "RUNNING" }

GET  /queries/q-123            # read progress; always safe to repeat
→ 200 OK        { "status": "FAILED", "error": { "retryable": true } }
```

A redrive is then a **new call** that creates a **new execution** linked to the failed one:

```http
POST /queries
Idempotency-Key: r-2
{ "retryOf": "q-123" }
→ 202 Accepted  { "queryId": "q-124", "retryOf": "q-123", "conversationId": "c-7", "status": "RUNNING" }
```

The server copies the input and conversation from `q-123`: a retry should never change what is being retried. Now `q-123` stays `FAILED` forever, `q-124` has its own trace, and the lineage `q-123 → q-124` is explicit and auditable.

`retryOf` points at the `queryId`, not the old `requestId`. Request IDs are short-lived keys for a *call*; lineage is a relationship between *executions*, so it should reference the permanent record.

Some APIs make retry an explicit action instead, such as `POST /queries/q-123:retry` in the style of Google's [custom methods](https://google.aip.dev/136). Azure Data Factory [starts a new pipeline run](https://learn.microsoft.com/en-us/rest/api/datafactory/pipelines/create-run) that references the failed one and reuses its parameters, and GitHub Actions [re-runs](https://docs.github.com/en/rest/actions/workflow-runs#re-run-a-workflow) a workflow as a new attempt while keeping earlier attempts. Either shape works. What matters is a new execution, linked to the old one.

## If you can't change the API shape yet

We only have `/query` today, and customers depend on it. You keep the same guarantees with a new `requestId` and a `retryOf` field:

```http
POST /query
{ "requestId": "r-2", "retryOf": "q-123" }
```

The server-side rules:

```python
def handle_query(req):
    claim = idempotency.get(req.tenant_id, req.request_id)
    if claim:
        # Same request ID: never re-run. Reject if the request means something different.
        if claim.fingerprint != fingerprint(req):
            raise Conflict("requestId reused with different parameters")
        return queries.get(claim.query_id).status_view()

    if req.retry_of:
        parent = queries.get(req.retry_of)
        if parent is None or parent.status != "FAILED" or not parent.error.retryable:
            raise BadRequest("retryOf must point to a failed, retryable query")
        input, conversation_id = parent.input, parent.conversation_id  # never trust a re-sent input
    else:
        input, conversation_id = req.input, req.conversation_id or new_conversation_id()

    query_id = new_query_id()
    # Conditional write: if another call claimed this requestId first, return its query instead.
    if not idempotency.put_if_absent(req.tenant_id, req.request_id, query_id, fingerprint(req), ttl=days(7)):
        return handle_query(req)

    query = queries.create(query_id=query_id, conversation_id=conversation_id,
                           retry_of=req.retry_of, input=input, status="RUNNING")
    start_workflow(query)
    return query.status_view()
```

Four details matter:

1. **Claim the `requestId` with a conditional write** (for example a DynamoDB `attribute_not_exists` condition), scoped per tenant, so two concurrent first calls can't both start a run.
2. **Fingerprint the request.** If someone reuses a request ID with a different body, return a conflict instead of silently handing back an unrelated result. The Builders' Library calls this out explicitly.
3. **Validate the parent.** Only allow a redrive from a terminal, retryable failure. Never from `RUNNING` or `SUCCEEDED`.
4. **Mark retries inside the conversation.** A conversation holds both new turns and retries of failed turns. When you rebuild the agent's context, keep only the latest attempt of each turn, or the failed attempt and its retry will look like two separate turns.

## Idempotency has to reach the tools

A new execution ID fixes the bookkeeping, but the side effects from the failed run already happened. If run `q-123` posted a comment before it failed, `q-124` will post it again unless something stops it.

Two ways to handle that, and agent platforms usually need both:

- **Idempotent tools.** Derive a key for each tool call from stable values, such as `hash(rootQueryId, stepId, toolName)`, and have the tool dedupe on it. Use the *root* of the retry chain, so a redrive maps to the same keys for the same logical step. Don't let the LLM invent the key, and don't hash the LLM's arguments either: neither is stable across runs.
- **Resume, don't restart.** Checkpoint completed steps. A redrive can then skip steps that already succeeded and continue from the failure point, instead of replaying the whole plan.

## Checklist

- One request ID maps to one execution, forever.
- The client owns `requestId`; the server owns `queryId` and `conversationId`.
- Terminal states are immutable. Recovery creates a new execution.
- Link retries to the failed `queryId` (`retryOf`), and copy the input on the server.
- Claim request IDs with conditional writes, and reject reuse with different parameters.
- Split create and read for async work when you can.
- Push idempotency down to every tool with side effects.

Agents make all of this more pressing, not less. They are long-running, they retry, and they touch real systems. The safest assumption is that every operation will run more than once, so design for that from the start.

## Food for thought

AWS Step Functions can [redrive](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html) a failed execution under the **same execution ARN**, which sounds like exactly what this post warns against.

So how does redrive stay immutable and auditable? Hint: look at the execution's event history.
