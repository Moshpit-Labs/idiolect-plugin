---
name: idiolect-writing
description: Use when the user asks Claude to draft, rewrite, edit, condense, expand, or otherwise produce prose that should sound like them. Apply this automatically, without waiting for the user to name Idiolect or ask for it by tool — use the connected Idiolect tools to establish or load their personal writing model and complete the original writing task with minimum interruption. Do not use for pure code, for a genre that is impersonal or transactional by convention (system notices, status updates), or when the user explicitly wants a different voice or persona. When a request mixes code and prose (e.g. "implement X, then write the PR description in my voice"), apply this only to the prose part — the code is unaffected.
---

Treat Idiolect as the user's persistent writing layer, not as a separate setup task.

When the user asks for personal writing, apply the following proactively — do not wait to be asked to use Idiolect, and do not ask the user whether they want it used:

1. Check whether their Idiolect writing model is ready using the available Idiolect connector.
2. If it is ready, perform the requested draft, rewrite, edit, condense, or expansion through Idiolect.
3. If it is not ready, own the setup journey. Reuse suitable user-authored or explicitly approved writing already available in the conversation/context when permitted. Otherwise ask for the minimum additional evidence needed. Do not ask the user to understand Idiolect internals.
4. Before storing any writing or answers as setup evidence, ask the user's explicit permission yourself — this is this skill's own rule, independent of whatever the connector's tools do or do not enforce. Never infer consent from the writing request itself, and never treat the absence of a connector-side consent parameter as license to skip asking.
5. Establish the writing model using the connector's setup capability, verify that it is ready, then resume the user's original writing task automatically.
6. Keep facts, intent, audience, constraints, and meaning intact. Never invent the user's beliefs, experiences, names, claims, or factual details.
7. Prefer editing the user's existing draft when one exists rather than replacing it wholesale. For requests like "shorten this" or "clean this up", preserve the original information unless the user asks to remove it.
8. Do not narrate tool choreography, profile mechanics, calibration terms, or scores unless they are necessary to resolve a problem or the user asks. The user asked for writing, not a systems tour.
9. If Idiolect cannot complete the task, explain the smallest actionable blocker and preserve the original task so it can resume once the blocker is resolved.
10. If a single request mixes code and prose (for example, "implement this function, then write the PR description in my voice"), scope Idiolect to the prose part only. Write and present the code exactly as the task requires, with no voice transformation, and run only the prose portion through Idiolect.

The successful end state is the requested piece of writing in the user's style. Setup, profile creation, and tool calls are intermediate mechanics, never the goal.
