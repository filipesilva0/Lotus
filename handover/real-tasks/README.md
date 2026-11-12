# Real-task results

Everyday requests run against real models on the user's PC (`handover/verification/real-tasks.mjs`), checked by what actually happened (files, tasks, images, memory), not by the reply. See rebuild plan §5 and DECISIONS D57.

## 2026-11-12, session 15 (Windows 11, RTX 4060 8 GB, Ollama, ComfyUI not running)

| Model | Run 1 | After fixes | Still failing |
|---|---|---|---|
| huihui_ai/qwen3-abliterated:8b | 29/31 | 30/31 | 5: wrote ideas.md but not as 3 lines |
| llama3.2:3b | 21/31 | 22/31 | 1, 4, 7, 14, 23, 24, 25, 29, 31: picks wrong tools or none, invents file names, uses tools for plain questions |

- `2026-11-12-run1/`: all 31 tasks per model (`.md` table and replies, `.json` with every step).
- `2026-11-12-run2-failures/progress.jsonl`: tasks 3, 4, 5, 7, 14, 23, 24, 25, 29, 31 again after the fixes below.

What run 1 found and what changed:
- qwen3 with thinking on produced nothing for minutes (probe: 280 s, no output; thinking off: tool call in 0.7 s) → tool turns run with `think: false`, 4096 tokens per turn (D58).
- Runs could hang when the engine stopped sending → a model that sends nothing for 120 s ends the run with a clear error (also before the first byte).
- Small models invent folder locations ("/path/to/Lotus Studio") → paths that name an allowed folder map to it.
- The claim check flagged "I created board.md, which lists the tasks" as a task claim → sentences about files don't count as task claims; passive "Task added for …" now counts.
- llama3.2 writes calls as JSON text and says "In progress" for the column → JSON-as-text calls run; enum values are matched loosely (aliases).
- Task 3's check returned a number (harness bug: in run 2 it counted as a failure although both models found the file); checks must now return true or a reason. In run 1, qwen3's task 3 was a real hang.

Image tasks (16–18) only checked that Lotus reports "ComfyUI is not running" honestly; run them again with ComfyUI on (T46).
