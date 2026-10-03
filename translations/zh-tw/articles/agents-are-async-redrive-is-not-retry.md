---
title: "Agent 是非同步的：為什麼「用同一個 request ID 重新執行」會破壞冪等性"
description: "有客戶要求我們在同一個 request ID 下重新執行失敗的 agent 工作流程。本文說明這樣做為什麼會破壞冪等性、可稽核性與追蹤，以及應該怎麼設計。"
sourceHash: "ad868bc710cfce0f"
---

我在一個平台上工作，客戶在上面託管會做實事的 AI agent：處理工單、新增留言、分類事件。有一位客戶的服務會直接呼叫我們的 API 來觸發他們的 agent。最近他們提出了一個聽起來很合理的要求：

> 「如果某次執行因為暫時性的後端錯誤而失敗，讓我們能用**同一個 request ID** 加上 `retryable` 旗標再呼叫一次，讓整個工作流程重新跑一遍。」

聽起來像重試（retry），但其實不是。這篇文章會說明原因，以及安全的設計應該長什麼樣子。這些想法大量參考了 AWS Builders' Library 的文章〈[Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)〉。

## 我們現有的 API

只有一個端點 `/query`，它身兼兩職：

1. 用新的 `queryId` **第一次呼叫**：啟動 agent 工作流程。
2. 用同一個 `queryId` **之後再呼叫**：回傳工作流程的進度。

```http
POST /query
{ "queryId": "q-123", "input": "Triage incident INC-42" }
```

在背後，LLM 會跑上幾秒到幾分鐘，過程中呼叫 MCP 工具。這些工具有副作用（side effect）：會貼出留言、會改變工單狀態、會呼叫某人起來處理。

所以 `/query` 是把「建立或取得」合在一次呼叫裡。這之所以行得通，是因為 `queryId` 只代表一件事：**這一次的執行**。再次呼叫是安全的，因為伺服器看到已知的 ID，就回傳它已經有的結果。這正是冪等性（idempotency）在發揮作用。

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

非同步工作流程是一個有生命週期的資源，它需要常見的建立／讀取分離：

```http
POST /queries                  # create an execution (idempotency key in header)
Idempotency-Key: 8f1c...
→ 202 Accepted  { "queryId": "q-123", "status": "RUNNING" }

GET  /queries/q-123            # read progress; always safe to repeat
→ 200 OK        { "status": "FAILED", "error": { "retryable": true } }
```

這樣一來，redrive 就成為一個獨立且明確的操作，它會建立一個指向舊執行的**新**執行：

```http
POST /queries/q-123/retries
Idempotency-Key: 5d2e...
→ 202 Accepted  { "queryId": "q-124", "retryOf": "q-123", "status": "RUNNING" }
```

現在 `q-123` 永遠維持 `FAILED`，`q-124` 有自己的 trace，而 `q-123 → q-124` 的血緣關係（lineage）明確且可稽核。

## 如果暫時還不能改變 API 的形狀

我們目前只有 `/query`，而且客戶依賴著它。不過你還是可以藉由新增一個欄位、而不是重複使用 ID，來保住這些保證：

```http
POST /query
{ "queryId": "q-124", "retryOf": "q-123", "input": "Triage incident INC-42" }
```

伺服器端的規則：

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

有三個細節很重要：

1. **用條件寫入（conditional write）來建立**（例如 DynamoDB 的 `attribute_not_exists` 條件），這樣兩個同時發生的第一次呼叫就不會都啟動執行。
2. **為請求計算指紋（fingerprint）。** 如果有人用不同的輸入重複使用某個 ID，就回傳衝突，而不是默默交回一個不相干的結果。Builders' Library 特別點出了這一點。
3. **驗證父執行。** 只允許從終止且可重試的失敗進行 redrive，絕不能從 `RUNNING` 或 `SUCCEEDED` 進行。

## 冪等性必須延伸到工具

新的執行 ID 解決了記錄上的問題，但失敗那次執行的副作用已經發生了。如果 `q-123` 在失敗前貼了一則留言，除非有機制阻止，否則 `q-124` 會再貼一次。

有兩種處理方式，而 agent 平台通常兩者都需要：

- **冪等的工具。** 從穩定的值為每次工具呼叫推導出一個鍵，例如 `hash(rootQueryId, stepId, toolName)`，並讓工具依此去重。要使用重試鏈的*根*，這樣 redrive 時，同一個邏輯步驟會對應到相同的鍵。不要讓 LLM 自己產生這個鍵，也不要對 LLM 的參數做雜湊：兩者在不同執行之間都不穩定。
- **接續，而不是重來。** 為已完成的步驟建立檢查點（checkpoint）。這樣 redrive 就能跳過已經成功的步驟，從失敗的地方繼續，而不是把整個計畫重播一遍。

## 檢查清單

- 一個 request ID 永遠只代表一次執行。
- 終止狀態不可變更。復原時要建立新的執行。
- 明確連結重試（`retryOf`），讓血緣關係可以稽核。
- 建立執行時使用條件寫入。
- 拒絕以不同參數重複使用的 ID。
- 在可行時，把非同步工作的建立與讀取分開。
- 把冪等性往下推到每一個有副作用的工具。

Agent 只會讓這些事情變得更迫切，而不是更不重要。它們執行時間長、會重試，而且會接觸真實的系統。最安全的假設是：每個操作都會執行不只一次，所以從一開始就要為此而設計。
