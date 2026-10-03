---
title: "エージェントは非同期：「同じリクエスト ID で再実行」が冪等性を壊す理由"
description: "ある顧客から、失敗したエージェントのワークフローを同じリクエスト ID で再実行したいという要望がありました。それが冪等性、監査可能性、トレーシングを壊す理由と、代わりに何を作るべきかを解説します。"
sourceHash: "ad868bc710cfce0f"
---

私は、顧客が実際の業務をこなす AI エージェントをホストするプラットフォームの開発に携わっています。エージェントはチケットを解決し、コメントを追加し、インシデントをトリアージします。ある顧客のサービスは、私たちの API を呼び出してエージェントを直接起動しています。最近、その顧客から一見もっともな要望がありました。

> 「一時的なバックエンドエラーで実行が失敗したら、**同じリクエスト ID** と `retryable` フラグを付けてもう一度呼び出せるようにしてほしい。そうすればワークフロー全体がもう一度実行されるので。」

リトライのように聞こえますが、そうではありません。この記事では、その理由と、安全な設計とはどのようなものかを説明します。考え方の多くは、AWS Builders' Library の記事 [Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) に負っています。

## 現在の API

エンドポイントは `/query` の一つだけで、二つの役割を担っています。

1. 新しい `queryId` での**最初の呼び出し**：エージェントのワークフローを開始します。
2. 同じ `queryId` での**以降の呼び出し**：ワークフローの進捗を返します。

```http
POST /query
{ "queryId": "q-123", "input": "Triage incident INC-42" }
```

その裏では LLM が数秒から数分にわたって動作し、途中で MCP ツールを呼び出します。これらのツールには副作用（side effect）があります。コメントが投稿され、チケットの状態が変わり、誰かが呼び出されます。

つまり `/query` は一回の呼び出しで「作成または取得」を行います。これが成り立つのは、`queryId` がただ一つのこと、つまり**この一回の実行**を意味しているからです。再度呼び出しても安全なのは、サーバーが既知の ID を見て、すでに持っている結果を返すからです。これこそ冪等性（idempotency）が本来の役割を果たしている状態です。

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

非同期ワークフローは、ライフサイクルを持つリソースです。通常どおり作成と読み取りを分けるべきです。

```http
POST /queries                  # create an execution (idempotency key in header)
Idempotency-Key: 8f1c...
→ 202 Accepted  { "queryId": "q-123", "status": "RUNNING" }

GET  /queries/q-123            # read progress; always safe to repeat
→ 200 OK        { "status": "FAILED", "error": { "retryable": true } }
```

すると再実行は、古い実行を参照する**新しい**実行を作成する、独立した明示的な操作になります。

```http
POST /queries/q-123/retries
Idempotency-Key: 5d2e...
→ 202 Accepted  { "queryId": "q-124", "retryOf": "q-123", "status": "RUNNING" }
```

これで `q-123` は永久に `FAILED` のままとなり、`q-124` は独自のトレースを持ち、`q-123 → q-124` という系譜（lineage）が明示的かつ監査可能になります。

## まだ API の形を変えられない場合

現時点で私たちには `/query` しかなく、顧客もそれに依存しています。それでも、ID を再利用する代わりにフィールドを追加すれば、保証を維持できます。

```http
POST /query
{ "queryId": "q-124", "retryOf": "q-123", "input": "Triage incident INC-42" }
```

サーバー側のルールは次のとおりです。

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

重要なポイントは三つあります。

1. **条件付き書き込み（conditional write）で作成します**（たとえば DynamoDB の `attribute_not_exists` 条件）。これにより、同時に行われた二つの最初の呼び出しが両方とも実行を開始することを防げます。
2. **リクエストのフィンガープリントを取ります。** 誰かが異なる入力で ID を再利用した場合、無関係な結果を黙って返すのではなく、競合（conflict）を返します。Builders' Library もこの点を明示的に指摘しています。
3. **親を検証します。** 再実行は、終了状態でリトライ可能な失敗からのみ許可します。`RUNNING` や `SUCCEEDED` からは決して許可しません。

## 冪等性はツールにまで届かなければならない

新しい実行 ID で記録の管理は解決しますが、失敗した実行の副作用はすでに発生しています。実行 `q-123` が失敗する前にコメントを投稿していた場合、何かがそれを止めない限り、`q-124` は再びそのコメントを投稿します。

これに対処する方法は二つあり、エージェントプラットフォームでは通常その両方が必要です。

- **冪等なツール。** 各ツール呼び出しのキーを、`hash(rootQueryId, stepId, toolName)` のような安定した値から導出し、ツール側でそれをもとに重複を排除（dedupe）させます。リトライチェーンの*ルート*を使うことで、再実行しても同じ論理ステップには同じキーが対応します。キーを LLM に考えさせてはいけませんし、LLM の引数をハッシュするのもいけません。どちらも実行をまたいで安定しないからです。
- **再起動ではなく再開する。** 完了したステップをチェックポイントとして記録します。そうすれば再実行は、計画全体をやり直すのではなく、すでに成功したステップをスキップして失敗した地点から続行できます。

## チェックリスト

- 一つのリクエスト ID は、永久に一つの実行を意味する。
- 終了状態はイミュータブル（immutable）にする。復旧では新しい実行を作成する。
- リトライを明示的にリンク（`retryOf`）し、系譜を監査可能にする。
- 実行の作成には条件付き書き込みを使う。
- 異なるパラメーターで再利用された ID は拒否する。
- 可能であれば、非同期処理の作成と読み取りを分ける。
- 副作用を持つすべてのツールまで冪等性を行き渡らせる。

エージェントの登場によって、これらはむしろより差し迫った課題になっています。エージェントは長時間動作し、リトライし、実際のシステムに触れます。最も安全な前提は、あらゆる操作が二回以上実行されるということです。だからこそ、最初からそれを前提に設計しましょう。
