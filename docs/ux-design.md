# UX: the reader, in graphite

The frontend was redesigned in October 2026. The inbox is the application: you
read one message at a time, the verdict and its reasons come first, and the
evidence behind them is one click away. The briefing answers "is there anything
I need to do?" before you open the inbox. This document records the design
system and the interaction model so later changes stay consistent with them.

The chosen mockup lives in `design/r8/` (variant "graphite"); the directions it
was chosen from are in `design/r7/`.

## Screens

| Route        | Job                                                                    |
| ------------ | ---------------------------------------------------------------------- |
| `/login`     | Sign in or create an account. Unchanged from the previous design.      |
| `/dashboard` | The briefing: the one decision, the breakdown, flagged per day, the queue, the sources. |
| `/inbox`     | The list on the chrome, the open message on a raised panel.            |
| `/senders`   | Trusted and blocked rules, with how much mail each one touches.        |
| `/settings`  | Profile, Gmail, detection, notifications, delete account.              |

On desktop, navigation is a 68px icon rail. On phones it is a bottom tab bar,
and an open message covers the list with a Back control.

## The open message

Top to bottom:

1. Sender, address, time, subject.
2. The verdict card: a score ring, the verdict, one sentence, and the two
   decisions. It is the only tinted surface on the screen. The coral
   "Mark as phishing" fill appears only when the scan says likely phishing.
3. "Why it was flagged" beside "Sender check" (SPF, DKIM, DMARC as three short
   lines, each passed, failed or not verified), plus first-time sender and a
   different Reply-To when they apply.
4. The message in a recessed well, every link disabled.
5. "Scoring details", folded: rule, AI and combined scores, every rule that
   fired with its points, what the AI read, the links (copyable), the DMARC
   policy, ARC, your decision, what Gmail did, when it was scanned.

Nothing from the audit trail is removed. It is folded so it does not compete
with the decision.

## Keyboard

One registry (`frontend/src/lib/commands.js`) holds every command. The palette
(`⌘K` / `Ctrl+K`) lists it and the key listener fires it, so a shortcut and a
palette entry are the same object. `?` shows the sheet of what is available on
the current screen.

| Keys        | Action                                     |
| ----------- | ------------------------------------------ |
| `j` / `k`   | next / previous message                    |
| `p` / `s`   | mark as phishing / mark as safe            |
| `r`         | rescan the open message                    |
| `d`         | show or hide scoring details               |
| `1` to `5`  | risk filters                               |
| `/`         | search                                     |
| `x`         | select several messages                    |
| `g b/i/s/,` | go to briefing / inbox / senders / settings |

## Design system

Tokens live in `frontend/src/index.css`.

- **Surfaces.** Graphite chrome `#141417`, the raised panel `#1c1c21`, cards
  `#232329` inside a panel, and a recessed well `#18181c` for the email itself.
  Not black: hairlines and shadows need something to sit on.
- **Type.** IBM Plex Sans only, self-hosted from `frontend/public/fonts/plex`,
  tabular figures for numbers. No monospace labels, no uppercase eyebrows.
- **Colour.** One interactive colour, a soft periwinkle `#a3adff`, for what
  you can press. Severity is a soft ramp used on small marks: mint (safe),
  amber (suspicious), coral (likely phishing), rose (confirmed). Every text
  colour clears WCAG AA on chrome, panel and card.
- **Scores.** A numeric score is coloured from the continuous ramp in
  `frontend/src/lib/scoreScale.js`, whose stops sit on the backend thresholds
  (30 suspicious, 60 likely phishing); a category from `frontend/src/lib/risk.js`.
- **Words.** A label appears only when it says something: safe rows in the list
  carry no pill, filters count only flagged mail.
- **Charts** are hand-drawn SVG; the app no longer ships a chart library.

## States

- No mailbox: the briefing and the inbox show the three-step first run with
  the Connect Gmail button.
- Nothing flagged: the briefing says so in a sentence and offers no review.
- A failed Gmail action is shown under "Scoring details", never hidden.
