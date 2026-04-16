# Subagent Routing Convention

## Rule: Minions for all background work

All background agent work MUST go through Minions (`submit_job`), never
`sessions_spawn` with `runtime: "subagent"`. The native subagent runtime
has no persistence, no observability, and no recovery.

Reference: `skills/minion-orchestrator/SKILL.md`

## Decision matrix

| Condition | Action |
|---|---|
| Single tool call, < 30s | Do it inline |
| Multi-step, any duration | Submit as Minion job |
| Parallel work (2+ streams) | Submit N Minion jobs with shared parent |
| Needs to survive restart | Submit as Minion job |
| User wants progress updates | Submit as Minion job with progress tracking |
| Research / bulk operation | Submit as Minion job, always |

## Concurrency budget

- Check `get_job_stats` queue_health.active before submitting batch jobs
- If active > 5, submit remaining jobs with `delay` to stagger execution
- The resource governor auto-throttles, but don't dump 20 jobs at once
