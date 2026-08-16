# dsh-trace — aggregate observability dashboard for DeepSeek Harness

Decode **every** `session.jsonl.zstd` under a sessions root and render one self-contained HTML dashboard: total sessions, estimated input/output tokens, tool-call counts, error rate, top tools, and a per-session table. Zero dependencies (Node ≥ 22.19 for bundled zstd).

```sh
node bin/trace.mjs [sessions-root] --out trace.html
# default root: ~/.dsh/sessions
```

This is the aggregate sibling to [dsh-replay](https://github.com/zoahdev/dsh-replay) (per-session trajectory) — replay answers "what did this agent do?", trace answers "how is my agent fleet doing overall?".

Token numbers are a rough chars/4 estimate (no false precision); cost is intentionally left to you because pricing varies per provider/model.

---

# dsh-trace — DeepSeek Harness 的聚合可观测仪表盘

解码 sessions 根目录下的**每个** `session.jsonl.zstd`，渲染成一张自包含 HTML 仪表盘：总会话数、估算输入/输出 token、工具调用数、错误率、Top 工具、逐会话表格。零依赖。

```sh
node bin/trace.mjs [sessions-root] --out trace.html
```

它是 [dsh-replay](https://github.com/zoahdev/dsh-replay)（单会话轨迹）的聚合版：replay 回答"这个 agent 干了什么"，trace 回答"我这一堆 agent 整体跑得怎么样"。token 是 chars/4 的粗略估算，成本刻意留给你自己按模型定价算。
