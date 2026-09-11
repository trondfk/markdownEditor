# Release v1.0.6: File diffs in chat, a full AI settings pane, and a bigger UI

The assistant now shows what it changed in the note, the AI settings tab is usable again, and you can scale the whole window.

## Features

- Agent file edits show an inline diff in the chat, with plus and minus counts, Keep and Undo
- Appearance has an interface size slider that scales menus, buttons, the assistant and the document (75 to 200 percent)

## Bug fixes

- After a file search, Qwen3.8 no longer fails with "no user query found in messages". The original question is pinned after the tool result so the next round still has a user turn
- The AI settings tab shows its form again (the import was dropped when the shortcuts tab landed)
- The assistant lists every provider even when a health check failed, so you can still pick Claude or Codex

## UI/UX

- Codex can read sibling notes in the workspace without making every file writable, shows Thinking while it reasons, and Planlegg has Carry out the plan. Effort includes xHigh. Web search shows as Nett-søk when Codex uses it
