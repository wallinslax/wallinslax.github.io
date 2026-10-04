---
title: "Agent 是非同步的：為什麼「用同一個 request ID 重新執行」會破壞冪等性"
description: "有客戶要求我們在同一個 request ID 下重新執行失敗的 agent 工作流程。本文說明這樣做為什麼會破壞冪等性、可稽核性與追蹤，以及應該怎麼設計。"
sourceHash: "9abe7b4bb6319777"
---

我在一個平台上工作，客戶在上面託管會做實事的 AI agent：處理工單、新增留言、分類事件。有一位客戶的服務會直接呼叫我們的 API 來觸發他們的 agent。最近他們提出了一個聽起來很合理的要求：

> 「如果某次執行因為暫時性的後端錯誤而失敗，讓我們能用**同一個 request ID** 加上 `retryable` 旗標再呼叫一次，讓整個工作流程重新跑一遍。」

聽起來像重試（retry），但其實不是。這篇文章會說明原因，以及安全的設計應該長什麼樣子。這些想法大量參考了 AWS Builders' Library 的文章〈[Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)〉。

## 我們現有的 API

只有一個端點 `/query`，以及三種 ID：

| ID | 由誰建立 | 代表什麼 |
|---|---|---|
| `requestId` | 用戶端 | 一次*呼叫*。它是冪等鍵，會保留幾天。 |
| `queryId` | 伺服器 | agent 的一次*執行*。永久保存，是我們稽核與追蹤的紀錄。 |
| `conversationId` | 伺服器 | 一串工作脈絡。多個 query 可以共用同一個 conversation。 |

`/query` 身兼兩職：

1. 用新的 `requestId` **第一次呼叫**：伺服器建立 query `q-123` 並啟動 agent 工作流程。
2. 用同一個 `requestId` **之後再呼叫**：回傳 `q-123` 的進度。

```http
POST /query
{ "requestId": "r-1", "conversationId": "c-7", "input": "Triage incident INC-42" }
→ { "queryId": "q-123", "status": "RUNNING" }
```

在背後，LLM 會跑上幾秒到幾分鐘，過程中呼叫 MCP 工具。這些工具有副作用（side effect）：會貼出留言、會改變工單狀態、會呼叫某人起來處理。

所以 `/query` 是把「建立或取得」合在一次呼叫裡。這之所以行得通，是因為一個 `requestId` 只會對應到一個 `queryId`：**這一次的執行**。再次呼叫是安全的，因為伺服器看到已知的 request ID，就回傳它已經有的結果。這正是冪等性（idempotency）在發揮作用。

## 為什麼「同一個 ID，再跑一次」是錯誤的解法

冪等鍵（idempotency key）是一種承諾：*所有帶著這個鍵的請求都指向同一個操作，也會得到同樣的結果。* Builders' Library 的文章把它描述為**語意等價（semantic equivalence）**：重複的請求必須與原始請求代表同一件事，呼叫端也必須能把回應視為那一次操作的結果。

在同一個 ID 下重新執行（redrive），會從好幾個方面打破這個承諾：

- **終止狀態不再是終止狀態。** `FAILED` 是對已發生之事的陳述。在同一個 ID 下重新執行，會把它覆寫成 `RUNNING`，接著可能變成 `SUCCEEDED`。實際發生過什麼的歷史就這樣消失了。
- **可稽核性（auditability）被破壞。** 對一個會貼留言、改工單的 agent 來說，「`q-123` 這次執行做了什麼？」必須有一個穩定的答案。有了 redrive，答案就取決於你*什麼時候*問。
- **追蹤（tracing）被破壞。** 以 `q-123` 為鍵的日誌、trace 與指標，現在混雜了兩次不同的執行。偏偏就在你最需要除錯第一次失敗的時候，它變得更難除錯。
- **用戶端會混亂。** 任何已經看到 `FAILED` 並快取起來的輪詢者，現在會和伺服器的說法不一致。兩個使用同一個 ID 的輪詢者可能發生競爭：一個看到舊的執行，另一個看到新的。
- **副作用可能重複發生。** 第一次執行可能在失敗前已經貼了兩則留言。整個重跑一次就會再貼一次，除非每個工具本身也是冪等的。

客戶真正的需求是合理的：*暫時性失敗應該要能復原。* 解法是讓這個復原成為一次**新的、有關聯的執行**，而不是改寫舊的那一次。

## 根本原因：一個端點，兩種職責

非同步工作流程是一個有生命週期的資源，它需要常見的建立／讀取分離，也就是 Microsoft 所說的 [Asynchronous Request-Reply 模式](https://learn.microsoft.com/en-us/azure/architecture/patterns/async-request-reply)：用 `POST` 啟動工作並回傳 `202 Accepted`，再用 `GET` 讀取狀態：

```http
POST /queries                  # create; the client's requestId is the idempotency key
Idempotency-Key: r-1
{ "conversationId": "c-7", "input": "Triage incident INC-42" }
→ 202 Accepted  { "queryId": "q-123", "status": "RUNNING" }

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

伺服器會從 `q-123` 複製輸入與 conversation：重試永遠不該改變被重試的內容。現在 `q-123` 永遠維持 `FAILED`，`q-124` 有自己的 trace，而 `q-123 → q-124` 的血緣關係（lineage）明確且可稽核。

`retryOf` 指向的是 `queryId`，而不是舊的 `requestId`。request ID 是針對一次*呼叫*的短期鍵；血緣關係則是*執行*之間的關係，所以應該參照永久保存的紀錄。

有些 API 則把重試做成一個明確的動作，例如採用 Google [自訂方法（custom methods）](https://google.aip.dev/136)風格的 `POST /queries/q-123:retry`。Azure Data Factory 會[啟動一次新的 pipeline 執行](https://learn.microsoft.com/en-us/rest/api/datafactory/pipelines/create-run)，參照失敗的那一次並沿用它的參數；GitHub Actions 則會把工作流程[重新執行](https://docs.github.com/en/rest/actions/workflow-runs#re-run-a-workflow)為一次新的嘗試（attempt），同時保留先前的嘗試。兩種形式都可行，重點在於建立一次新的、與舊執行相關聯的執行。

## 如果暫時還不能改變 API 的形狀

我們目前只有 `/query`，而且客戶依賴著它。只要使用新的 `requestId` 加上一個 `retryOf` 欄位，就能保住同樣的保證：

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

1. **用條件寫入（conditional write）來佔用 `requestId`**（例如 DynamoDB 的 `attribute_not_exists` 條件），並以租戶（tenant）為範圍，這樣兩個同時發生的第一次呼叫就不會都啟動執行。
2. **為請求計算指紋（fingerprint）。** 如果有人用不同的內容重複使用某個 request ID，就回傳衝突，而不是默默交回一個不相干的結果。Builders' Library 特別點出了這一點。
3. **驗證父執行。** 只允許從終止且可重試的失敗進行 redrive，絕不能從 `RUNNING` 或 `SUCCEEDED` 進行。
4. **在 conversation 中標記重試。** 一個 conversation 裡同時有新的回合（turn）與對失敗回合的重試。重建 agent 的上下文時，每個回合只保留最新的那次嘗試，否則失敗的嘗試和它的重試看起來會像兩個不同的回合。

## 冪等性必須延伸到工具

新的執行 ID 解決了記錄上的問題，但失敗那次執行的副作用已經發生了。如果 `q-123` 在失敗前貼了一則留言，除非有機制阻止，否則 `q-124` 會再貼一次。

有兩種處理方式，而 agent 平台通常兩者都需要：

- **冪等的工具。** 從穩定的值為每次工具呼叫推導出一個鍵，例如 `hash(rootQueryId, stepId, toolName)`，並讓工具依此去重。要使用重試鏈的*根*，這樣 redrive 時，同一個邏輯步驟會對應到相同的鍵。不要讓 LLM 自己產生這個鍵，也不要對 LLM 的參數做雜湊：兩者在不同執行之間都不穩定。
- **接續，而不是重來。** 為已完成的步驟建立檢查點（checkpoint）。這樣 redrive 就能跳過已經成功的步驟，從失敗的地方繼續，而不是把整個計畫重播一遍。

## 檢查清單

- 一個 request ID 永遠只對應一次執行。
- `requestId` 由用戶端掌握；`queryId` 與 `conversationId` 由伺服器掌握。
- 終止狀態不可變更。復原時要建立新的執行。
- 把重試連結到失敗的 `queryId`（`retryOf`），並在伺服器端複製輸入。
- 用條件寫入來佔用 request ID，並拒絕以不同參數重複使用。
- 在可行時，把非同步工作的建立與讀取分開。
- 把冪等性往下推到每一個有副作用的工具。

Agent 只會讓這些事情變得更迫切，而不是更不重要。它們執行時間長、會重試，而且會接觸真實的系統。最安全的假設是：每個操作都會執行不只一次，所以從一開始就要為此而設計。

## 想一想

AWS Step Functions 可以用**同一個執行 ARN** [redrive](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html) 一個失敗的執行，聽起來正是這篇文章警告的做法。

那麼，redrive 如何維持不可變性（immutability）與可稽核性（auditability）？提示：看看執行的事件歷史（event history）。
