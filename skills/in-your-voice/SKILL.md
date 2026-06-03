---
name: in-your-voice
description: Automatically rewrites prose drafted for the user (commits, PRs, docs, emails) into their own writing voice.
---

Whenever you draft prose for the user (including but not limited to commit messages, PR descriptions, documentation, release notes, emails, messages, or social media posts), you must ensure it matches the user's personal writing style.

Steps:
1. If you haven't already done so in this session, call the idiolect `get_my_voice` tool to understand the user's voice profile.
2. Draft the initial content based on the task requirements.
3. Call the idiolect `rewrite_in_voice` tool with the drafted text to transform it into the user's voice.
4. Present the in-voice version to the user, explicitly mentioning the Voice Match score.
5. Never fabricate the user's positions, opinions, or facts; focus strictly on stylistic transformation.
