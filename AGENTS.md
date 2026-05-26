# Project Rules

This project is a local-first horror story video studio. Do not enable publishing automation unless the user explicitly asks for that phase.

Use memory only as orientation. Before production-facing changes, verify the current files, env defaults, provider settings, generated output paths, and any deploy or workflow target.

Implementation priorities:

- Keep YouTube, Facebook, and Instagram publishing disabled by default.
- Build each step so it can be reviewed independently: story, scenes, image prompts, TTS, effects, render, then upload later.
- Estimate costs before any paid API call.
- Prefer high-quality visual prompts, clear scene direction, and consistent story style over generating many cheap images.
- Stage and commit only files that belong to the requested change when the worktree is mixed.
