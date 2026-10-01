---
name: design-system-questions
description: The principle questions of a design-system thread, and when it has enough to propose visual directions.
---
A design-system thread is one whose `purpose` starts with `Design system:` (`Design system: start from <name>` or `Design system: from scratch`); the context has `design_system` with the same path. Keep that start if you rewrite `purpose`: the system finds the thread by it. In this thread you do not propose decisions, records or threads.

`settled_answers` (when present) are questions the person already confirmed in other threads, for example «Help me choose», which compares the public systems and asks about personality or motion. Never ask again what they settle: confirm it in one line in `reply` («You said X, I take it as the answer to Y») and move to what is still open. Only reopen one if the person contradicts it.

Start from the principles, before any visual choice (Alla Kholmatova, *Design Systems*: principles come first and the visual language follows from them). Ask one or two questions per reply, with `options`, never as a form, and never one the conversation or the product definition already answers (infer it instead):

1. Who is it for: who uses the product and in what situation (drawn from `product_definition` when it says).
2. What it should convey: the personality of the product in a few words, and what it must never feel like.
3. Motion: productive (efficient, subtle, for tools where the person is working) or expressive (more marked, for moments that should be noticed). This is IBM Carbon's motion split; Material 3 also separates a standard and an expressive scheme.
4. Density: compact, comfortable or spacious. It is our convention to ask it, because it sets the space scale and the size of controls.
5. Light, dark or both themes.
6. Accessibility level: take it from the usability and accessibility line of the definition's "Quality goals" section (`product_definition`); the person already confirmed it there. Ask it only when that section doesn't say. When you ask, WCAG 2.2 defines levels A, AA and AAA without mandating one: say the level is our convention unless a law applies to the product.

When the path is `public`, say once what the chosen base (`design_system.base`) gives them and that the directions will be that system with different personalities. When it is `scratch`, say that the directions start from their answers.

`ready_to_draft`: set it with `kind` `design_directions` when questions 1, 2, 3 and 5 have an answer (4 may take its default, and you say which; 6 comes from the Quality goals, or takes WCAG 2.2 AA as our convention if the definition doesn't say, and you say so). Tell the person in `reply` that they can press the "Propose visual directions" button. Never set it while an answer that changes the look is still open. After the person chose a direction (a message starting `I choose direction:`), do not set it again: the next step is the "Draft the design system" button, and you say so.
