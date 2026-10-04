---
title: "エージェントは非同期：「同じリクエスト ID で再実行」が冪等性を壊す理由"
description: "ある顧客から、失敗したエージェントのワークフローを同じリクエスト ID で再実行したいという要望がありました。それが冪等性、監査可能性、トレーシングを壊す理由と、代わりに何を作るべきかを解説します。"
sourceHash: "9abe7b4bb6319777"
---

私は、顧客が実際の業務をこなす AI エージェントをホストするプラットフォームの開発に携わっています。エージェントはチケットを解決し、コメントを追加し、インシデントをトリアージします。ある顧客のサービスは、私たちの API を呼び出してエージェントを直接起動しています。最近、その顧客から一見もっともな要望がありました。

> 「一時的なバックエンドエラーで実行が失敗したら、**同じリクエスト ID** と `retryable` フラグを付けてもう一度呼び出せるようにしてほしい。そうすればワークフロー全体がもう一度実行されるので。」

リトライのように聞こえますが、そうではありません。この記事では、その理由と、安全な設計とはどのようなものかを説明します。考え方の多くは、AWS Builders' Library の記事 [Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) に負っています。

## 現在の API

エンドポイントは `/query` の一つだけで、ID は三つあります。

| ID | 誰が作成するか | 何を表すか |
|---|---|---|
| `requestId` | クライアント | 一回の*呼び出し*。冪等性キーであり、数日間保持されます。 |
| `queryId` | サーバー | エージェントの一回の*実行*。永続的で、監査とトレースの対象となる記録です。 |
| `conversationId` | サーバー | 一連の作業のスレッド。複数のクエリが一つの会話を共有できます。 |

`/query` は二つの役割を担っています。

1. 新しい `requestId` での**最初の呼び出し**：サーバーがクエリ `q-123` を作成し、エージェントのワークフローを開始します。
2. 同じ `requestId` での**以降の呼び出し**：`q-123` の進捗を返します。

```http
POST /query
{ "requestId": "r-1", "conversationId": "c-7", "input": "Triage incident INC-42" }
→ { "queryId": "q-123", "status": "RUNNING" }
```

その裏では LLM が数秒から数分にわたって動作し、途中で MCP ツールを呼び出します。これらのツールには副作用（side effect）があります。コメントが投稿され、チケットの状態が変わり、誰かが呼び出されます。

つまり `/query` は一回の呼び出しで「作成または取得」を行います。これが成り立つのは、一つの `requestId` がちょうど一つの `queryId`、つまり**この一回の実行**に対応しているからです。再度呼び出しても安全なのは、サーバーが既知のリクエスト ID を見て、すでに持っている結果を返すからです。これこそ冪等性（idempotency）が本来の役割を果たしている状態です。

## 「同じ ID でもう一度実行」が誤った解決策である理由

冪等性キー（idempotency key）は一種の約束です。*このキーを持つすべてのリクエストは同じ単一の操作を指し、同じ結果を得る*という約束です。Builders' Library の記事はこれを**意味的等価性（semantic equivalence）**として説明しています。繰り返されたリクエストは元のリクエストと同じ意味を持たなければならず、呼び出し側はそのレスポンスをその一つの操作の結果として扱えなければなりません。

同じ ID での再実行（redrive）は、この約束をいくつもの形で破ります。

- **終了状態が終了状態でなくなります。** `FAILED` は実際に起きたことについての事実でした。同じ ID で再実行すると、それが `RUNNING` に、そしておそらく `SUCCEEDED` に上書きされます。実際に何が起きたのかという履歴は失われます。
- **監査可能性（auditability）が壊れます。** コメントを投稿しチケットを変更するエージェントにとって、「実行 `q-123` は何をしたのか？」という問いには、一つの安定した答えがなければなりません。再実行があると、その答えは*いつ*尋ねたかによって変わってしまいます。
- **トレーシングが壊れます。** `q-123` をキーにしたログ、トレース、メトリクスに、二つの異なる実行が混在します。最初の失敗のデバッグは、まさにそれが必要なときに難しくなります。
- **クライアントが混乱します。** すでに `FAILED` を見てキャッシュしたポーラーは、サーバーと食い違うことになります。同じ ID を持つ二つのポーラーが競合し、一方は古い実行を、もう一方は新しい実行を見ることもあります。
- **副作用が繰り返される可能性があります。** 最初の実行は、失敗する前にコメントを二件投稿していたかもしれません。すべてをもう一度実行すれば、すべてのツールも冪等でない限り、それらが再び投稿されます。

顧客の本当のニーズは正当なものです。*一時的な失敗からは復旧できるべき*です。解決策は、その復旧を古い実行の書き換えではなく、**新しく、リンクされた実行**にすることです。

## 根本原因：一つのエンドポイントに二つの役割

非同期ワークフローは、ライフサイクルを持つリソースです。通常どおり作成と読み取りを分けるべきです。Microsoft はこれを [Asynchronous Request-Reply パターン](https://learn.microsoft.com/en-us/azure/architecture/patterns/async-request-reply) としてまとめています。`POST` で処理を開始して `202 Accepted` を返し、`GET` で状態を読み取ります。

```http
POST /queries                  # create; the client's requestId is the idempotency key
Idempotency-Key: r-1
{ "conversationId": "c-7", "input": "Triage incident INC-42" }
→ 202 Accepted  { "queryId": "q-123", "status": "RUNNING" }

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

サーバーは入力と会話を `q-123` からコピーします。リトライによって、リトライ対象の中身が変わってはならないからです。これで `q-123` は永久に `FAILED` のままとなり、`q-124` は独自のトレースを持ち、`q-123 → q-124` という系譜（lineage）が明示的かつ監査可能になります。

`retryOf` が指すのは古い `requestId` ではなく `queryId` です。リクエスト ID は一回の*呼び出し*に対する短命なキーです。一方、系譜は*実行*同士の関係なので、永続的な記録を参照すべきです。

API によっては、リトライを明示的なアクションにしているものもあります。たとえば Google の[カスタムメソッド（custom methods）](https://google.aip.dev/136)のスタイルでの `POST /queries/q-123:retry` です。Azure Data Factory は、失敗した実行を参照しそのパラメーターを再利用する[新しいパイプライン実行を開始](https://learn.microsoft.com/en-us/rest/api/datafactory/pipelines/create-run)し、GitHub Actions はワークフローを新しい試行（attempt）として[再実行](https://docs.github.com/en/rest/actions/workflow-runs#re-run-a-workflow)しつつ、以前の試行も保持します。どちらの形でも構いません。重要なのは、古い実行にリンクされた新しい実行であることです。

## まだ API の形を変えられない場合

現時点で私たちには `/query` しかなく、顧客もそれに依存しています。新しい `requestId` と `retryOf` フィールドを使えば、同じ保証を維持できます。

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

1. **条件付き書き込み（conditional write）で `requestId` を確保します**（たとえば DynamoDB の `attribute_not_exists` 条件）。テナントごとにスコープを分けることで、同時に行われた二つの最初の呼び出しが両方とも実行を開始することを防げます。
2. **リクエストのフィンガープリントを取ります。** 誰かが異なるボディでリクエスト ID を再利用した場合、無関係な結果を黙って返すのではなく、競合（conflict）を返します。Builders' Library もこの点を明示的に指摘しています。
3. **親を検証します。** 再実行は、終了状態でリトライ可能な失敗からのみ許可します。`RUNNING` や `SUCCEEDED` からは決して許可しません。
4. **会話の中でリトライであることを明示します。** 会話には新しいターンと、失敗したターンのリトライの両方が含まれます。エージェントのコンテキストを再構築するときは、各ターンの最新の試行だけを残してください。そうしないと、失敗した試行とそのリトライが別々の二つのターンに見えてしまいます。

## 冪等性はツールにまで届かなければならない

新しい実行 ID で記録の管理は解決しますが、失敗した実行の副作用はすでに発生しています。実行 `q-123` が失敗する前にコメントを投稿していた場合、何かがそれを止めない限り、`q-124` は再びそのコメントを投稿します。

これに対処する方法は二つあり、エージェントプラットフォームでは通常その両方が必要です。

- **冪等なツール。** 各ツール呼び出しのキーを、`hash(rootQueryId, stepId, toolName)` のような安定した値から導出し、ツール側でそれをもとに重複を排除（dedupe）させます。リトライチェーンの*ルート*を使うことで、再実行しても同じ論理ステップには同じキーが対応します。キーを LLM に考えさせてはいけませんし、LLM の引数をハッシュするのもいけません。どちらも実行をまたいで安定しないからです。
- **再起動ではなく再開する。** 完了したステップをチェックポイントとして記録します。そうすれば再実行は、計画全体をやり直すのではなく、すでに成功したステップをスキップして失敗した地点から続行できます。

## チェックリスト

- 一つのリクエスト ID は、永久に一つの実行に対応させる。
- `requestId` はクライアントが、`queryId` と `conversationId` はサーバーが管理する。
- 終了状態はイミュータブル（immutable）にする。復旧では新しい実行を作成する。
- リトライは失敗した `queryId` にリンク（`retryOf`）し、入力はサーバー側でコピーする。
- リクエスト ID は条件付き書き込みで確保し、異なるパラメーターでの再利用は拒否する。
- 可能であれば、非同期処理の作成と読み取りを分ける。
- 副作用を持つすべてのツールまで冪等性を行き渡らせる。

エージェントの登場によって、これらはむしろより差し迫った課題になっています。エージェントは長時間動作し、リトライし、実際のシステムに触れます。最も安全な前提は、あらゆる操作が二回以上実行されるということです。だからこそ、最初からそれを前提に設計しましょう。

## 考えてみてほしいこと

AWS Step Functions は、失敗した実行を**同じ実行 ARN のまま** [redrive](https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html) できます。まさにこの記事が警告してきたことのように聞こえます。

では、redrive はどうやって不変性（immutability）と監査可能性（auditability）を保っているのでしょうか。ヒント：実行のイベント履歴を見てみてください。
