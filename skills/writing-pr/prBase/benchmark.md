# Benchmark PR body

Use when the PR claims a win in speed, size, memory, cost or query count.

````md
- <What got faster or smaller, with the headline number>. <Why it was slow before>.
- <The mechanism, one bullet, with a code ref.>
- <Anything that got worse. Say it here, do not leave it for the table to reveal.>

| Metric | Baseline (`main`) | Candidate (this PR) | Delta |
| --- | --- | --- | --- |
| p50 latency | 412 ms | 188 ms | -54% |
| p95 latency | 1.9 s | 0.7 s | -63% |
| Queries / request | 14 | 7 | -50% |
| Bundle (gzip) | 312 kB | 301 kB | -3.5% |

`scripts/bench.ts`, same machine and data, 20 runs, median.

```ts
// the change that moved the numbers
const rows = await loadOnce(orgId);
```
````

Rules:

- The baseline comes from the target branch and the candidate from the PR branch, measured the
  same way on the same machine.
- Always a table. Never "about 2x faster" in prose.
- Every value has a unit. The line under the table says the harness, run count and what was held
  constant.
- A metric that got worse stays in the table.
