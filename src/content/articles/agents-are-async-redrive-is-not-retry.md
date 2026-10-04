---
title: 'Agents are async: why "redrive with the same request ID" breaks idempotency'
description: 'A customer asked us to re-run failed agent workflows under the same request ID. Here is why that breaks idempotency, auditability, and tracing, and what to build instead.'
pubDate: 2026-10-03
tags: ['agents', 'api-design', 'idempotency']
---

I work on a platform where customers host AI agents that do real work: resolving tickets, adding comments, triaging incidents. One customer's service calls our API to trigger their agent directly. Recently they asked for something that sounded reasonable:

> "If a run fails with a transient backend error, let us call again with the **same request ID** and a `retryable` flag, so the whole workflow runs again."

It sounds like a retry. It isn't. Here is why, and what to build instead, leaning on the AWS Builders' Library article [Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) [[1]](#ref-1).

## The API we have

There is one endpoint, `/query`, and three IDs:

| ID | Who creates it | What it names |
|---|---|---|
| `requestId` | Client | One *call*. It is the idempotency key, kept for a few days. |
| `queryId` | Server | One *execution* of the agent. Permanent, and the record we audit and trace. |
| `conversationId` | Server | A thread of work. Many queries can share one conversation. |

`/query` does two jobs: the first call with a new `requestId` creates query `q-123` and starts the agent; later calls with the same `requestId` return its progress.

```http
POST /query
{ "requestId": "r-1", "input": "Triage incident INC-42" }
→ { "queryId": "q-123", "conversationId": "c-7", "status": "RUNNING" }
```

Behind it, an LLM runs for minutes and calls MCP tools with real side effects: comments get posted, tickets change state, people get paged. Calling again is safe because a `requestId` maps to exactly one `queryId`, **one execution**. That is idempotency doing its job.

## Why "same ID, run it again" is the wrong fix

An idempotency key is a promise: *every request with this key means the same single operation and gets the same outcome*. The Builders' Library calls this **semantic equivalence** [[1]](#ref-1). Redriving under the same ID breaks it:

- **Terminal states stop being terminal.** `FAILED` gets overwritten by `RUNNING`, then maybe `SUCCEEDED`. What actually happened is gone.
- **Auditability breaks.** "What did `q-123` do?" no longer has one stable answer; it depends on *when* you ask.
- **Tracing breaks.** Logs and traces for `q-123` mix two executions, just when you need to debug the first.
- **Clients get confused.** A poller that cached `FAILED` now disagrees with the server.
- **Side effects can repeat.** Comments posted before the failure get posted again.

The customer's need is valid: *transient failures should be recoverable.* The fix is a **new, linked execution**, not a rewrite of the old one.

## The root cause: one endpoint, two jobs

An async workflow is a resource with a lifecycle. It wants the usual create/read split, which Microsoft documents as the [Asynchronous Request-Reply pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/async-request-reply) [[2]](#ref-2): `POST` starts the work and returns `202 Accepted`, and `GET` reads its status:

```http
POST /queries                  # create; the client's requestId is the idempotency key
Idempotency-Key: r-1
{ "input": "Triage incident INC-42" }    # no conversationId yet: the server starts one
→ 202 Accepted  { "queryId": "q-123", "conversationId": "c-7", "status": "RUNNING" }

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

The server copies the input and conversation from `q-123`, because a retry should never change what is being retried. `q-123` stays `FAILED` forever, `q-124` gets its own trace, and the lineage is explicit. `retryOf` points at the permanent `queryId`, not the short-lived `requestId`: lineage links *executions*, not calls.

Some APIs make retry an explicit action instead, like `POST /queries/q-123:retry` in the style of Google's [custom methods](https://google.aip.dev/136) [[3]](#ref-3). Azure Data Factory [starts a new pipeline run](https://learn.microsoft.com/en-us/rest/api/datafactory/pipelines/create-run) [[4]](#ref-4) that references the failed one and reuses its parameters, and GitHub Actions [re-runs](https://docs.github.com/en/rest/actions/workflow-runs#re-run-a-workflow) [[5]](#ref-5) a workflow as a new attempt while keeping earlier ones. Either shape works, as long as the retry is a new, linked execution.

## If you can't change the API shape yet

Customers depend on `/query` today. A new `requestId` plus a `retryOf` field gives the same guarantees:

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

1. **Claim the `requestId` with a conditional write** (e.g. DynamoDB `attribute_not_exists`), per tenant, so two concurrent calls can't both start a run.
2. **Fingerprint the request.** A reused request ID with a different body gets a conflict, not someone else's result [[1]](#ref-1).
3. **Validate the parent.** Only redrive a terminal, retryable failure.
4. **Mark retries in the conversation.** When rebuilding the agent's context, keep only the latest attempt of each turn, or a failed attempt and its retry look like two turns.

## Idempotency has to reach the tools

A new execution ID fixes the bookkeeping, but the failed run's side effects already happened. If `q-123` posted a comment, `q-124` will post it again unless something stops it. Agent platforms usually need both of these:

- **Idempotent tools.** Key each tool call on stable values, like `hash(rootQueryId, stepId, toolName)`, and dedupe on it. Using the *root* of the retry chain maps a redrive to the same keys. Never let the LLM invent the key or hash its arguments; neither is stable across runs.
- **Resume, don't restart.** Checkpoint completed steps so a redrive continues from the failure point.

## Checklist

- One request ID maps to one execution, forever. The client owns `requestId`; the server owns `queryId` and `conversationId`.
- Terminal states are immutable. A retry is a new execution linked by `retryOf`, with the input copied on the server.
- Claim request IDs with conditional writes; reject reuse with different parameters.
- Split create and read for async work.
- Push idempotency down to every tool with side effects.

Agents are long-running, they retry, and they touch real systems. Assume every operation runs more than once, and design for it from the start.

## Question for you

AWS Step Functions can [redrive](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html) [[6]](#ref-6) a failed execution under the **same execution ARN**, which sounds like exactly what this post warns against.

So how does redrive stay immutable and auditable? Hint: look at the execution's event history.

## References

- <span id="ref-1"></span>[1] M. Featonby, "Making retries safe with idempotent APIs," *Amazon Builders' Library*, Amazon Web Services. [Online]. Available: <https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/>
- <span id="ref-2"></span>[2] Microsoft, "Asynchronous Request-Reply pattern," *Azure Architecture Center*. [Online]. Available: <https://learn.microsoft.com/en-us/azure/architecture/patterns/async-request-reply>
- <span id="ref-3"></span>[3] Google, "AIP-136: Custom methods," *API Improvement Proposals*. [Online]. Available: <https://google.aip.dev/136>
- <span id="ref-4"></span>[4] Microsoft, "Pipelines - Create Run," *Azure Data Factory REST API Reference*. [Online]. Available: <https://learn.microsoft.com/en-us/rest/api/datafactory/pipelines/create-run>
- <span id="ref-5"></span>[5] GitHub, "Re-run a workflow," *GitHub REST API Documentation*. [Online]. Available: <https://docs.github.com/en/rest/actions/workflow-runs#re-run-a-workflow>
- <span id="ref-6"></span>[6] Amazon Web Services, "Redriving executions in Step Functions," *AWS Step Functions Developer Guide*. [Online]. Available: <https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html>
