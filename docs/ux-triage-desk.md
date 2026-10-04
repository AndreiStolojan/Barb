# UX: the triage desk

The frontend was rebuilt from scratch on 2026-10-04 around one idea: the inbox
is the application. Everything else either feeds it (the briefing) or
configures it (senders, settings). This document records the design system and
the interaction model so later changes can stay consistent with them.

## Screens

| Route        | Job                                                                 |
| ------------ | ------------------------------------------------------------------- |
| `/login`     | Sign in or create an account. Shows one rendered verdict as the pitch. |
| `/dashboard` | The briefing: posture, review queue, risk over time, attacking domains. |
| `/inbox`     | The triage desk: message list on the left, evidence pane on the right. |
| `/senders`   | Trusted and blocked rules, with the mail each rule touches.         |
| `/settings`  | Profile, Gmail connection, detection, notifications, delete account. |

The signed-in frame is a 56px icon rail on desktop and a bottom tab bar on
phones. A command palette (`⌘K` / `Ctrl+K`) lists every action the current
screen offers; `?` opens the shortcut sheet.

## Evidence pane

The pane for one message has a fixed order:

1. Header: subject, sender name, address, time, and the sender-scoped
   Trust / block control.
2. Verdict strip: score, verdict, the two review actions and Rescan. The strip
   carries the verdict colour; it is the only large colour on the screen.
3. Three tabs:
   - Verdict: why we flagged it, what the AI read, how the score was reached,
     the rules that fired.
   - Message: the sanitised body with every link disabled, the links, the
     attachments.
   - Evidence: From versus Reply-To, first-time sender, SPF / DKIM / DMARC with
     the published policy and ARC, links at a glance, your decision, what Gmail
     did with the message, scan metadata.

Nothing in the rendered body is navigable. The real destinations are listed in
the Links section, copyable.

## Keyboard model

One registry (`frontend/src/lib/commands.js`) holds every command. The palette
lists it and the global key listener fires it, so a shortcut and a palette entry
are the same object. Pages register their commands while mounted.

| Keys        | Action                              |
| ----------- | ----------------------------------- |
| `j` / `k`   | next / previous message             |
| `s` / `p`   | mark safe / mark phishing           |
| `r`         | rescan the open message             |
| `v` `m` `e` | Verdict / Message / Evidence tab    |
| `1` to `5`  | risk filters                        |
| `/`         | focus search                        |
| `x`         | select several messages             |
| `g b/i/s/,` | go to briefing / inbox / senders / settings |
| `⌘K`, `?`   | command palette, shortcut sheet     |

Typing in a field only lets `⌘` shortcuts and Escape through.

## Design system

Tokens live in `frontend/src/index.css`.

- Canvas: pure black. Surfaces are translucent white lifts, so everything reads
  as one material.
- Type: IBM Plex Sans for prose and labels; IBM Plex Mono for literal data
  (addresses, domains, URLs, scores, timestamps, key hints). Both self-hosted
  from `frontend/public/fonts/plex`.
- Colour means severity. The warm ramp runs safe (quiet bone-grey), review
  (amber), quarantine (orange-red), phishing (red). Interactive chrome is bone
  or white, never blue, so an action cannot be mistaken for a warning.
- A numeric score is coloured from the continuous ramp in
  `frontend/src/lib/scoreScale.js`; a category from `frontend/src/lib/risk.js`.
  The ramp's stops sit on the backend thresholds (30 suspicious, 60 likely
  phishing) so a number and the word beside it agree.
- No cards. Structure comes from hairlines, alignment and spacing.
- Motion only in response to an action, and respects reduced motion.

## States

- No mailbox connected: the briefing and the inbox show the three-step first
  run with the Connect Gmail button.
- Empty filter or search: a sentence that says what to do next.
- A failed external action (Gmail move to spam) is shown as a fact under
  "Your decision", never hidden.
