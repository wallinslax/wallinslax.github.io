---
title: "Agent 是非同步的：為什麼「用同一個 request ID 重新執行」會破壞冪等性"
description: "有客戶要求我們在同一個 request ID 下重新執行失敗的 agent 工作流程。本文說明這樣做為什麼會破壞冪等性、可稽核性與追蹤，以及應該怎麼設計。"
sourceHash: "9a100fec07139b81"
---

我在一個平台上工作，客戶在上面託管會做實事的 AI agent：處理工單、新增留言、分類事件。有一位客戶的服務會直接呼叫我們的 API 來觸發他們的 agent。最近他們提出了一個聽起來很合理的要求：

> 「如果某次執行因為暫時性的後端錯誤而失敗，讓我們能用**同一個 request ID** 加上 `retryable` 旗標再呼叫一次，讓整個工作流程重新跑一遍。」

聽起來像重試（retry），但其實不是。以下說明原因，以及應該怎麼設計，主要參考 AWS Builders' Library 的文章〈[Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) [[1]](#ref-1)〉。

## 我們現有的 API

只有一個端點 `/query`，以及三種 ID：

| ID | 由誰建立 | 代表什麼 |
|---|---|---|
| `requestId` | 用戶端 | 一次*呼叫*。它是冪等鍵，會保留幾天。 |
| `queryId` | 伺服器 | agent 的一次*執行*。永久保存，是我們稽核與追蹤的紀錄。 |
| `conversationId` | 伺服器 | 一串工作脈絡。多個 query 可以共用同一個 conversation。 |

`/query` 身兼兩職：用新的 `requestId` 第一次呼叫時，會建立 query `q-123` 並啟動 agent；之後用同一個 `requestId` 呼叫，則回傳它的進度。

```http
POST /query
{ "requestId": "r-1", "input": "Triage incident INC-42" }
→ { "queryId": "q-123", "conversationId": "c-7", "status": "RUNNING" }
```

在背後，LLM 會跑上好幾分鐘，並呼叫帶有真實副作用（side effect）的 MCP 工具：貼出留言、改變工單狀態、呼叫某人起來處理。再次呼叫之所以安全，是因為一個 `requestId` 只會對應到一個 `queryId`，也就是**一次執行**。這正是冪等性（idempotency）在發揮作用。

## 為什麼「同一個 ID，再跑一次」是錯誤的解法

冪等鍵（idempotency key）是一種承諾：*所有帶著這個鍵的請求都代表同一個操作，也會得到同樣的結果。* Builders' Library 稱之為**語意等價（semantic equivalence）** [[1]](#ref-1)。在同一個 ID 下 redrive 會打破這個承諾：

- **終止狀態不再是終止狀態。** `FAILED` 被覆寫成 `RUNNING`，接著可能變成 `SUCCEEDED`，實際發生過什麼就此消失。
- **可稽核性（auditability）被破壞。** 「`q-123` 做了什麼？」不再有穩定的答案，而是取決於你*什麼時候*問。
- **追蹤（tracing）被破壞。** `q-123` 的日誌與 trace 混雜了兩次執行，偏偏是在你需要除錯第一次執行的時候。
- **用戶端會混亂。** 已經快取 `FAILED` 的輪詢者，現在會和伺服器的說法不一致。
- **副作用可能重複發生。** 失敗前已經貼出的留言會再被貼一次。

客戶的需求是合理的：*暫時性失敗應該要能復原。* 解法是建立一次**新的、有關聯的執行**，而不是改寫舊的那一次。

## 根本原因：一個端點，兩種職責

非同步工作流程是一個有生命週期的資源，它需要常見的建立／讀取分離，也就是 Microsoft 所說的 [Asynchronous Request-Reply 模式](https://learn.microsoft.com/en-us/azure/architecture/patterns/async-request-reply) [[2]](#ref-2)：用 `POST` 啟動工作並回傳 `202 Accepted`，再用 `GET` 讀取狀態：

```http
POST /queries                  # create; the client's requestId is the idempotency key
Idempotency-Key: r-1
{ "input": "Triage incident INC-42" }    # no conversationId yet: the server starts one
→ 202 Accepted  { "queryId": "q-123", "conversationId": "c-7", "status": "RUNNING" }

GET  /queries/q-123            # read progress; always safe to repeat
→ 200 OK        { "status": "FAILED", "error": { "retryable": true } }
```

這樣一來，redrive 就是一次**新的呼叫**，它會建立一個與失敗執行相關聯的**新執行**：

```http
POST /queries
Idempotency-Key: r-2
{ "retryOf": "q-123" }
→ 202 Accepted  { "queryId": "q-124", "retryOf": "q-123", "conversationId": "c-7", "status": "RUNNING" }
```

伺服器會從 `q-123` 複製輸入與 conversation，因為重試永遠不該改變被重試的內容。`q-123` 永遠維持 `FAILED`，`q-124` 有自己的 trace，血緣關係（lineage）也清楚明確。`retryOf` 指向永久保存的 `queryId`，而不是短期的 `requestId`：血緣關係連結的是*執行*，不是呼叫。

有些 API 則把重試做成一個明確的動作，例如採用 Google [自訂方法（custom methods）](https://google.aip.dev/136) [[3]](#ref-3)風格的 `POST /queries/q-123:retry`。Azure Data Factory 會[啟動一次新的 pipeline 執行](https://learn.microsoft.com/en-us/rest/api/datafactory/pipelines/create-run) [[4]](#ref-4)，參照失敗的那一次並沿用它的參數；GitHub Actions 則會把工作流程[重新執行](https://docs.github.com/en/rest/actions/workflow-runs#re-run-a-workflow) [[5]](#ref-5)為一次新的嘗試（attempt），同時保留先前的嘗試。兩種形式都可行，只要重試是一次新的、有關聯的執行。

## 如果暫時還不能改變 API 的形狀

客戶目前依賴著 `/query`。使用新的 `requestId` 加上 `retryOf` 欄位，就能得到同樣的保證：

```http
POST /query
{ "requestId": "r-2", "retryOf": "q-123" }
```

伺服器端的規則：

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

有四個細節很重要：

1. **用條件寫入（conditional write）佔用 `requestId`**（例如 DynamoDB 的 `attribute_not_exists`），並以租戶（tenant）為範圍，這樣兩個同時發生的呼叫就不會都啟動執行。
2. **為請求計算指紋（fingerprint）。** 以不同內容重複使用的 request ID 會得到衝突，而不是別人的結果 [[1]](#ref-1)。
3. **驗證父執行。** 只允許從終止且可重試的失敗進行 redrive。
4. **在 conversation 中標記重試。** 重建 agent 的上下文時，每個回合（turn）只保留最新的那次嘗試，否則失敗的嘗試和它的重試看起來會像兩個回合。

## 冪等性必須延伸到工具

新的執行 ID 解決了記錄上的問題，但失敗那次執行的副作用已經發生了。如果 `q-123` 貼了一則留言，除非有機制阻止，否則 `q-124` 會再貼一次。Agent 平台通常兩者都需要：

- **冪等的工具。** 以穩定的值為每次工具呼叫建立鍵，例如 `hash(rootQueryId, stepId, toolName)`，並依此去重。使用重試鏈的*根*，redrive 就會對應到相同的鍵。不要讓 LLM 自己產生這個鍵，也不要對它的參數做雜湊：兩者在不同執行之間都不穩定。
- **接續，而不是重來。** 為已完成的步驟建立檢查點（checkpoint），讓 redrive 從失敗的地方繼續。

## 檢查清單

- 一個 request ID 永遠只對應一次執行。`requestId` 由用戶端掌握；`queryId` 與 `conversationId` 由伺服器掌握。
- 終止狀態不可變更。重試是一次透過 `retryOf` 連結的新執行，輸入在伺服器端複製。
- 用條件寫入佔用 request ID；拒絕以不同參數重複使用。
- 把非同步工作的建立與讀取分開。
- 把冪等性往下推到每一個有副作用的工具。

Agent 執行時間長、會重試，而且會接觸真實的系統。請假設每個操作都會執行不只一次，並從一開始就為此而設計。

## 給你的問題

AWS Step Functions 可以用**同一個執行 ARN** [redrive](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html) [[6]](#ref-6) 一個失敗的執行，聽起來正是這篇文章警告的做法。

那麼，redrive 如何維持不可變性（immutability）與可稽核性？提示：看看執行的事件歷史（event history）。

## 參考資料

- <span id="ref-1"></span>[1] M. Featonby, "Making retries safe with idempotent APIs," *Amazon Builders' Library*, Amazon Web Services. [Online]. Available: <https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/>
- <span id="ref-2"></span>[2] Microsoft, "Asynchronous Request-Reply pattern," *Azure Architecture Center*. [Online]. Available: <https://learn.microsoft.com/en-us/azure/architecture/patterns/async-request-reply>
- <span id="ref-3"></span>[3] Google, "AIP-136: Custom methods," *API Improvement Proposals*. [Online]. Available: <https://google.aip.dev/136>
- <span id="ref-4"></span>[4] Microsoft, "Pipelines - Create Run," *Azure Data Factory REST API Reference*. [Online]. Available: <https://learn.microsoft.com/en-us/rest/api/datafactory/pipelines/create-run>
- <span id="ref-5"></span>[5] GitHub, "Re-run a workflow," *GitHub REST API Documentation*. [Online]. Available: <https://docs.github.com/en/rest/actions/workflow-runs#re-run-a-workflow>
- <span id="ref-6"></span>[6] Amazon Web Services, "Redriving executions in Step Functions," *AWS Step Functions Developer Guide*. [Online]. Available: <https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html>
