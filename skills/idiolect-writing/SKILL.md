---
name: idiolect-writing
description: Use when the user asks Claude to draft, rewrite, edit, condense, expand, or otherwise produce prose that should sound like them. Use the connected Idiolect tools to establish or load their personal writing model and complete the original writing task with minimum interruption. Do not use for code or when the user explicitly wants a different voice.
---

Treat Idiolect as the user's persistent writing layer, not as a separate setup task.

When the user asks for personal writing:

1. Check whether their Idiolect writing model is ready using the available Idiolect connector.
2. If it is ready, perform the requested draft, rewrite, edit, condense, or expansion through Idiolect.
3. If it is not ready, own the setup journey. Reuse suitable user-authored or explicitly approved writing already available in the conversation/context when permitted. Otherwise ask for the minimum additional evidence needed. Do not ask the user to understand Idiolect internals.
4. Before storing writing or answers as setup evidence, obtain the explicit consent required by the connector. Never infer consent from the writing request itself.
5. Establish the writing model using the connector's setup capability, verify that it is ready, then resume the user's original writing task automatically.
6. Keep facts, intent, audience, constraints, and meaning intact. Never invent the user's beliefs, experiences, names, claims, or factual details.
7. Prefer editing the user's existing draft when one exists rather than replacing it wholesale. For requests like "shorten this" or "clean this up", preserve the original information unless the user asks to remove it.
8. Do not narrate tool choreography, profile mechanics, calibration terms, or scores unless they are necessary to resolve a problem or the user asks. The user asked for writing, not a systems tour.
9. If Idiolect cannot complete the task, explain the smallest actionable blocker and preserve the original task so it can resume once the blocker is resolved.

The successful end state is the requested piece of writing in the user's style. Setup, profile creation, and tool calls are intermediate mechanics, never the goal.
