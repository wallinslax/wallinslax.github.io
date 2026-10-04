---
title: "エージェントは非同期：「同じリクエスト ID で再実行」が冪等性を壊す理由"
description: "ある顧客から、失敗したエージェントのワークフローを同じリクエスト ID で再実行したいという要望がありました。それが冪等性、監査可能性、トレーシングを壊す理由と、代わりに何を作るべきかを解説します。"
sourceHash: "2ab4a5bb01733cd0"
---

私は、顧客が実際の業務をこなす AI エージェントをホストするプラットフォームの開発に携わっています。エージェントはチケットを解決し、コメントを追加し、インシデントをトリアージします。ある顧客のサービスは、私たちの API を呼び出してエージェントを直接起動しています。最近、その顧客から一見もっともな要望がありました。

> 「一時的なバックエンドエラーで実行が失敗したら、**同じリクエスト ID** と `retryable` フラグを付けてもう一度呼び出せるようにしてほしい。そうすればワークフロー全体がもう一度実行されるので。」

リトライのように聞こえますが、そうではありません。AWS Builders' Library の記事 [Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) [[1]](#ref-1) を手がかりに、その理由と代わりに作るべきものを説明します。

## 現在の API

エンドポイントは `/query` の一つだけで、ID は三つあります。

| ID | 誰が作成するか | 何を表すか |
|---|---|---|
| `requestId` | クライアント | 一回の*呼び出し*。冪等性キーであり、数日間保持されます。 |
| `queryId` | サーバー | エージェントの一回の*実行*。永続的で、監査とトレースの対象となる記録です。 |
| `conversationId` | サーバー | 一連の作業のスレッド。複数のクエリが一つの会話を共有できます。 |

`/query` は二つの役割を担っています。新しい `requestId` での最初の呼び出しはクエリ `q-123` を作成してエージェントを開始し、同じ `requestId` での以降の呼び出しはその進捗を返します。

```http
POST /query
{ "requestId": "r-1", "input": "Triage incident INC-42" }
→ { "queryId": "q-123", "conversationId": "c-7", "status": "RUNNING" }
```

その裏では LLM が数分にわたって動作し、実際の副作用（side effect）を持つ MCP ツールを呼び出します。コメントが投稿され、チケットの状態が変わり、誰かが呼び出されます。再度呼び出しても安全なのは、一つの `requestId` がちょうど一つの `queryId`、つまり**一回の実行**に対応しているからです。これこそ冪等性（idempotency）が本来の役割を果たしている状態です。

## 「同じ ID でもう一度実行」が誤った解決策である理由

冪等性キー（idempotency key）は約束です。*このキーを持つすべてのリクエストは同じ単一の操作を指し、同じ結果を得る*という約束です。Builders' Library はこれを**意味的等価性（semantic equivalence）**と呼んでいます [[1]](#ref-1)。同じ ID での再実行（redrive）は、この約束を破ります。

- **終了状態が終了状態でなくなります。** `FAILED` が `RUNNING` に、そしておそらく `SUCCEEDED` に上書きされます。実際に起きたことは失われます。
- **監査可能性（auditability）が壊れます。** 「`q-123` は何をしたのか？」という問いに一つの安定した答えがなくなり、*いつ*尋ねたかによって答えが変わります。
- **トレーシングが壊れます。** `q-123` のログとトレースに二つの実行が混在します。最初の失敗をデバッグしたい、まさにそのときにです。
- **クライアントが混乱します。** `FAILED` をキャッシュしたポーラーが、サーバーと食い違うことになります。
- **副作用が繰り返される可能性があります。** 失敗前に投稿されたコメントが、もう一度投稿されます。

顧客のニーズは正当なものです。*一時的な失敗からは復旧できるべき*です。解決策は古い実行の書き換えではなく、**新しく、リンクされた実行**です。

## 根本原因：一つのエンドポイントに二つの役割

非同期ワークフローは、ライフサイクルを持つリソースです。通常どおり作成と読み取りを分けるべきで、Microsoft はこれを [Asynchronous Request-Reply パターン](https://learn.microsoft.com/en-us/azure/architecture/patterns/async-request-reply) [[2]](#ref-2) としてまとめています。`POST` で処理を開始して `202 Accepted` を返し、`GET` で状態を読み取ります。

```http
POST /queries                  # create; the client's requestId is the idempotency key
Idempotency-Key: r-1
{ "input": "Triage incident INC-42" }    # no conversationId yet: the server starts one
→ 202 Accepted  { "queryId": "q-123", "conversationId": "c-7", "status": "RUNNING" }

GET  /queries/q-123            # read progress; always safe to repeat
→ 200 OK        { "status": "FAILED", "error": { "retryable": true } }
```

すると再実行は、失敗した実行にリンクされた**新しい実行**を作成する**新しい呼び出し**になります。

```http
POST /queries
Idempotency-Key: r-2
{ "retryOf": "q-123" }
→ 202 Accepted  { "queryId": "q-124", "retryOf": "q-123", "conversationId": "c-7", "status": "RUNNING" }
```

サーバーは入力と会話を `q-123` からコピーします。リトライによって、リトライ対象の中身が変わってはならないからです。`q-123` は永久に `FAILED` のままとなり、`q-124` は独自のトレースを持ち、系譜（lineage）が明示的になります。`retryOf` が指すのは短命な `requestId` ではなく、永続的な `queryId` です。系譜が結ぶのは呼び出しではなく*実行*だからです。

API によっては、Google の[カスタムメソッド（custom methods）](https://google.aip.dev/136) [[3]](#ref-3)のスタイルで `POST /queries/q-123:retry` のように、リトライを明示的なアクションにしているものもあります。Azure Data Factory は、失敗した実行を参照しそのパラメーターを再利用する[新しいパイプライン実行を開始](https://learn.microsoft.com/en-us/rest/api/datafactory/pipelines/create-run) [[4]](#ref-4)し、GitHub Actions はワークフローを新しい試行（attempt）として[再実行](https://docs.github.com/en/rest/actions/workflow-runs#re-run-a-workflow) [[5]](#ref-5)しつつ、以前の試行も保持します。リトライが新しくリンクされた実行である限り、どちらの形でも構いません。

## まだ API の形を変えられない場合

顧客は現在 `/query` に依存しています。新しい `requestId` と `retryOf` フィールドを使えば、同じ保証が得られます。

```http
POST /query
{ "requestId": "r-2", "retryOf": "q-123" }
```

サーバー側のルールは次のとおりです。

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

重要なポイントは四つあります。

1. **条件付き書き込み（conditional write）で `requestId` を確保します**（たとえば DynamoDB の `attribute_not_exists`）。テナントごとに行うことで、同時に行われた二つの呼び出しが両方とも実行を開始することを防げます。
2. **リクエストのフィンガープリントを取ります。** 異なるボディで再利用されたリクエスト ID には、他人の結果ではなく競合（conflict）を返します [[1]](#ref-1)。
3. **親を検証します。** 再実行は、終了状態でリトライ可能な失敗からのみ許可します。
4. **会話の中でリトライであることを明示します。** エージェントのコンテキストを再構築するときは各ターンの最新の試行だけを残します。そうしないと、失敗した試行とそのリトライが二つのターンに見えてしまいます。

## 冪等性はツールにまで届かなければならない

新しい実行 ID で記録の管理は解決しますが、失敗した実行の副作用はすでに発生しています。`q-123` がコメントを投稿していた場合、何かが止めない限り `q-124` は再びそれを投稿します。エージェントプラットフォームでは通常、次の両方が必要です。

- **冪等なツール。** 各ツール呼び出しのキーを `hash(rootQueryId, stepId, toolName)` のような安定した値にし、それをもとに重複を排除（dedupe）します。リトライチェーンの*ルート*を使うことで、再実行でも同じキーが対応します。キーを LLM に考えさせたり、引数をハッシュしたりしてはいけません。どちらも実行をまたいで安定しないからです。
- **再起動ではなく再開する。** 完了したステップをチェックポイントとして記録し、再実行が失敗した地点から続行できるようにします。

## チェックリスト

- 一つのリクエスト ID は、永久に一つの実行に対応させる。`requestId` はクライアントが、`queryId` と `conversationId` はサーバーが管理する。
- 終了状態はイミュータブル（immutable）にする。リトライは `retryOf` でリンクされた新しい実行とし、入力はサーバー側でコピーする。
- リクエスト ID は条件付き書き込みで確保し、異なるパラメーターでの再利用は拒否する。
- 非同期処理の作成と読み取りを分ける。
- 副作用を持つすべてのツールまで冪等性を行き渡らせる。

エージェントは長時間動作し、リトライし、実際のシステムに触れます。あらゆる操作が二回以上実行されると想定し、最初からそれを前提に設計しましょう。

## あなたへの問い

AWS Step Functions は、失敗した実行を**同じ実行 ARN のまま** [redrive](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html) [[6]](#ref-6) できます。まさにこの記事が警告していることのように聞こえます。

では、redrive はどうやって不変性（immutability）と監査可能性を保っているのでしょうか。ヒント：実行のイベント履歴を見てみてください。

## 参考文献

- <span id="ref-1"></span>[1] M. Featonby, "Making retries safe with idempotent APIs," *Amazon Builders' Library*, Amazon Web Services. [Online]. Available: <https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/>
- <span id="ref-2"></span>[2] Microsoft, "Asynchronous Request-Reply pattern," *Azure Architecture Center*. [Online]. Available: <https://learn.microsoft.com/en-us/azure/architecture/patterns/async-request-reply>
- <span id="ref-3"></span>[3] Google, "AIP-136: Custom methods," *API Improvement Proposals*. [Online]. Available: <https://google.aip.dev/136>
- <span id="ref-4"></span>[4] Microsoft, "Pipelines - Create Run," *Azure Data Factory REST API Reference*. [Online]. Available: <https://learn.microsoft.com/en-us/rest/api/datafactory/pipelines/create-run>
- <span id="ref-5"></span>[5] GitHub, "Re-run a workflow," *GitHub REST API Documentation*. [Online]. Available: <https://docs.github.com/en/rest/actions/workflow-runs#re-run-a-workflow>
- <span id="ref-6"></span>[6] Amazon Web Services, "Redriving executions in Step Functions," *AWS Step Functions Developer Guide*. [Online]. Available: <https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html>
