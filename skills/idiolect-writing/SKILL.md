---
name: idiolect-writing
description: Use when the user asks Claude to draft, rewrite, edit, condense, expand, or otherwise produce prose that should sound like them. Apply this automatically, without waiting for the user to name Idiolect or ask for it by tool — use the connected Idiolect tools to establish or load their personal writing model and complete the original writing task with minimum interruption. Do not use for pure code, for a genre that is impersonal or transactional by convention (system notices, status updates), or when the user explicitly wants a different voice or persona. When a request mixes code and prose (e.g. "implement X, then write the PR description in my voice"), apply this only to the prose part — the code is unaffected.
---

Treat Idiolect as the user's persistent writing layer, not as a separate setup task.

When the user asks for personal writing, apply the following proactively — do not wait to be asked to use Idiolect, and do not ask the user whether they want it used:

1. Check whether their Idiolect writing model is ready using the available Idiolect connector.
2. If it is ready, perform the requested draft, rewrite, edit, condense, or expansion through Idiolect.
3. If it is not ready, own the setup journey. Setup evidence is prose the user wrote themselves or explicitly approved as theirs — never another person's words: strip quoted replies, signatures, forwarded text, and anything someone else wrote before using a piece.
4. Gather evidence from everything you can reach, least intrusive source first (an inbox holds the most and best writing, which is exactly why it is not where you start): (a) prose the user wrote or approved in this conversation, including their own messages inside material they shared — their past replies in a pasted email thread count, the other side's do not; (b) the user's own writing readable through other tools connected in this conversation — sent email, docs, notes, messages — offered by name, and searched only after the user says yes; (c) only for what is still missing, a plain-language request to paste some of their writing. Do not ask the user to understand Idiolect internals, and do not quietly search a connected source the user has not agreed to.
5. Before storing any writing or answers as setup evidence, show the user the exact pieces you intend to use and ask their explicit permission yourself — this is this skill's own rule, independent of whatever the connector's tools do or do not enforce. Never infer consent from the writing request itself, never treat the user's permission to read a source as permission to store what you found there, and never treat the absence of a connector-side consent parameter as license to skip asking. One plain sentence of what you are doing and why is enough context for that ask.
6. Establish the writing model using the connector's setup capability. If it reports that more evidence is needed, gather just the missing amount the same way — same sources, same approval — and try again. Verify the model is ready, then resume the user's original writing task automatically.
7. Keep facts, intent, audience, constraints, and meaning intact. Never invent the user's beliefs, experiences, names, claims, or factual details.
8. Prefer editing the user's existing draft when one exists rather than replacing it wholesale. For requests like "shorten this" or "clean this up", preserve the original information unless the user asks to remove it.
9. Do not narrate tool choreography, profile mechanics, calibration terms, or scores unless they are necessary to resolve a problem or the user asks. The user asked for writing, not a systems tour.
10. If Idiolect cannot complete the task, explain the smallest actionable blocker and preserve the original task so it can resume once the blocker is resolved.
11. If a single request mixes code and prose (for example, "implement this function, then write the PR description in my voice"), scope Idiolect to the prose part only. Write and present the code exactly as the task requires, with no voice transformation, and run only the prose portion through Idiolect.

The successful end state is the requested piece of writing in the user's style. Setup, profile creation, and tool calls are intermediate mechanics, never the goal.
