---
name: show-me
description: Use when the user wants to see the actual thing instead of a description of it, such as "show me", "example?", "show the thing", "paste it", "which line?" or "what does it say?". Puts the exact excerpt, line, diff, record, log or message on screen first, word for word with its source, and adds at most a few short sentences after it.
---

# Show me

> *Don't tell me about it. Show it.*

When this skill is invoked, put the thing itself in front of the reader. Explain only after it, and only as much as
the thing does not already say.

- show the thing first: no lead-in, no summary before it
- copy it word for word from the source: never paraphrase, retype from memory or tidy it up
- read the source before you quote it; if you cannot find the thing, say so and do not reconstruct it
- show the smallest part that answers the question, and mark each cut with `…`
- name the source on one line: a file path with line numbers, a URL, an id, a commit or a command
- put verbatim text in a fenced code block, with a language tag when one fits, so spacing survives
- for a change, show the before and the after, or a diff, both as real text
- for a command, show the command and the lines of its output that matter
- after the thing, write at most 3 short sentences, and none when the thing speaks for itself
- do not restate what the shown text already says
- show one example unless the user asked for more
- redact secrets, keys and personal data in what you show, and say that you did
- do not mention the skill by name in the answer

If the user says `the actual thing`, `word for word`, `the whole thing` or `just show it`, cut the commentary and
show more of the source.

The fenced blocks below hold example answers. In a real answer, use a fenced block only around the shown thing
itself.

## Examples

The user asks for the failing test.

Bad:

```text
The test fails because the parser returns null for an empty string, and the assertion expects an empty list.
```

Good:

````text
`tests/parser.test.ts:42`

```ts
it("parses an empty document", () => {
  expect(parse("")).toEqual([]);
});
```

```
AssertionError: expected null to deeply equal []
```

`parse` returns `null` for empty input, and the test expects `[]`.
````

The user asks what changed in the config.

Bad:

```text
I raised the request timeout and turned on retries for the upstream service.
```

Good:

````text
`config/upstream.yaml`

```diff
-timeout_seconds: 10
+timeout_seconds: 30
+retries: 3
```
````

The user asks for an example of a rubric item that checks too many things.

Bad:

```text
One item asks for four separate facts about the lease in a single check, so one miss fails all four.
```

Good:

````text
`rubric.json`, item R-07, word for word:

```
PASS if: The summary names the tenant, the monthly rent, the term and the break date.
```

Rewritten as one check per item:

```
R-07a  PASS if the summary names the tenant. FAIL if it names no tenant or the wrong one.
R-07b  PASS if the summary states the monthly rent. FAIL if the rent is missing or wrong.
R-07c  PASS if the summary states the term. FAIL if the term is missing or wrong.
R-07d  PASS if the summary states the break date. FAIL if the break date is missing or wrong.
```
````

The user asks why the worker died.

Bad:

```text
The worker ran out of memory while it loaded the second shard, and the kernel killed it.
```

Good:

````text
`journalctl -u worker --since 09:40`, the lines that matter:

```
09:41:07 worker[2211]: loading shard 2/4 (11.8 GiB)
09:41:19 kernel: Out of memory: Killed process 2211 (worker) total-vm:63.9GiB
09:41:19 systemd[1]: worker.service: Main process exited, code=killed, status=9/KILL
```
````

The user asks what the reply to the customer says.

Bad:

```text
The draft thanks them, says the fix ships on Friday and offers a credit for the outage.
```

Good:

````text
The draft, in full:

```
Hi Dana,

Thanks for the detailed report. The fix ships on Friday, 14 March. We have added a credit for the
two hours of downtime to your next invoice.

Sam
```
````

The user asks which query is slow.

Bad:

```text
The slow one is the orders lookup that filters by customer and sorts by date without an index.
```

Good:

````text
`api/orders.ts:88`, 2.4 s at p95:

```sql
SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 50;
```

`orders` has no index on `(customer_id, created_at)`.
````
