---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving every branch of the decision tree. Use when the user wants to stress-test a plan, poke holes in a design, get grilled on an architecture, or says "grill me" / "拷问我" / "审一下这个方案".
---

Interview the user relentlessly about every aspect of their plan until you reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one by one.

## How to ask questions

Use the **`ask_user_question` tool** for every question you ask. Never pose questions as plain text in your reply — always use the question card so the user can pick an option or type their own answer.

Ask **one question at a time**. Wait for the answer before moving on. This keeps the conversation focused and prevents overwhelm.

For each question, provide 2–4 concrete options that represent the most likely answers or directions. Think about what this specific user would realistically choose — generic options like "Yes" / "No" are useless unless the question is genuinely binary. Put your recommended option first and append "（推荐）" to its label when you have a clear recommendation. Set `multi_select: true` only when the options are genuinely non-exclusive.

## Flow

1. After each answer, acknowledge the decision in one or two sentences, then immediately ask the next question with `ask_user_question`.
2. If a question can be answered by reading the codebase or files, read them yourself instead of asking.
3. Keep going until every branch of the design tree is resolved — or until the user says stop.
4. When finished, produce a concise summary of every decision made, in the order they were resolved, plus the open questions that remain.

## What to grill on

- Scope: what is in, what is explicitly out.
- Success criteria: how we will know it worked, measured how.
- Constraints: time, budget, existing systems, people, compatibility.
- Data: where it comes from, who owns it, what happens when it is missing.
- Failure modes: what breaks first, what the rollback is.
- Alternatives: what was rejected and why.
- Sequencing: what must land before what.

Do not accept "it depends" as an answer. Turn it into a concrete question with options.
