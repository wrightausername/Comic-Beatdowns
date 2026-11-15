# Instructions for Codex and coding agents

This is the **Comic Beatdowns Production Studio** repository. Before any coding, review:

1. [Canonical project handoff](docs/CODEX_HANDOFF.md): current PR status, owner decisions, next milestones, and known limitations.
2. [README](README.md): architecture, existing workflows, startup commands, testing and security.
3. [Creative DNA PR #11](https://github.com/wrightausername/Comic-Beatdowns/pull/11) and [stacked Easy Mode PR #12](https://github.com/wrightausername/Comic-Beatdowns/pull/12). Do not assume these branches are merged into `main`.
4. Issues [#5](https://github.com/wrightausername/Comic-Beatdowns/issues/5), [#8](https://github.com/wrightausername/Comic-Beatdowns/issues/8), and [#10](https://github.com/wrightausername/Comic-Beatdowns/issues/10).

## Nonnegotiable
- Preserve the current React/FastAPI/FFmpeg project, Windows launcher, SQLite data, imported assets, and existing user edits. Implement features in focused branches/PRs rather than replacing the Studio.
- **ElevenLabs is the creator's external voice workflow.** Support easy narration MP3/WAV import; do not replace it with internal voice generation or require ElevenLabs API access.
- Verdict's commentary is panel-specific, organically unhinged comic analysis, not a generic recap or arbitrary AI insults; creator review always wins.
- Defaults should be beginner-friendly with an Advanced escape hatch, but **never silently publish or approve** an episode.
- Treat user corrections and audience comments as separate evidence. Global learnings require creator approval; private data must not be sent off device without explicit permission.
- Never conflate a GitHub PR comment with a started Codex work session. A repository missing from a given workspace is a workspace-attachment problem, not evidence that this GitHub project does not exist.

## Validate
For code changes run `make check`, `make e2e`, and the existing Windows GitHub Actions validation. Report exactly which checks actually ran and passed. Do not claim a packaged `.exe`, social analytics sync, fully automated narration, or fully learned preferences before verified implementation.

## Status upkeep
Update `docs/CODEX_HANDOFF.md` and the relevant PR on **material coding milestones**, including branch, verification evidence and remaining work. These updates are manual/agent-per-task, not automatic background sync.
