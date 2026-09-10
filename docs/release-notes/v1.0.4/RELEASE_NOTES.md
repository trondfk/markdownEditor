# Release v1.0.4: An AI assistant that stays out of the way

The AI panel is closer to a normal chat: you see questions, answers and file changes, not a wall of tool calls. You can also remap writing shortcuts and send a bug report without putting chat or secrets on GitHub.

## Features

- Three modes on the composer: Ask only replies, Edit may change markdown, Plan writes a numbered plan and does not edit
- Your own instructions in Settings, plus `MERMARK.md` or `AGENTS.md` from the workspace root when that option is on
- Mention files with `@` in the chat instead of pasting them in
- Claude and Codex can look at pictures that are already in the open note
- Keyboard shortcuts for writing tools are listed under Settings, and you can rebind them
- Report a problem from the toolbar: the app copies a diagnostic report (version, last AI error, log tails, never the chat or the note) and opens a GitHub issue for you to send

## Bug fixes

- The "AI is working" spinner could sit on an empty chat while another conversation was still sending. It now belongs to the conversation that is actually sending, shows elapsed time, and you can cancel if it looks stuck
- Turning off write, shell or network in the access map now actually blocks those tools for Claude and Codex, not only the written instructions

## UI/UX

- The composer is just the input. Access map, snapshots and AI settings sit behind the gear
- Searches and shell calls collapse into one activity line you can open if you want the details
- When the assistant edits a file, the chat shows a Keep / Undo card instead of a raw write log
- The live selection chip grows with the marked text, then Show more reveals the rest
