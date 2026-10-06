import { FRONTEND_APP_URL } from '../../src/config/env.js';

/*
  Barb transactional emails: phishing alert, daily digest, report, welcome, and
  the contact message sent to support. They share one shell that mirrors the
  app's dashboard: a graphite panel with cards, IBM Plex Sans, initials avatars,
  and tinted score pills. Every colour is inline and solid so Gmail, Apple Mail,
  and Outlook render the same thing. Hexes mirror frontend/src/index.css.
*/

const C = {
  page: '#141417',
  panel: '#1c1c21',
  card: '#232329',
  line: '#2c2c33',
  avatar: '#34343a',
  fg: '#edece9',
  muted: '#a6a5a2',
  subtle: '#8b8a8f',
  primary: '#a3adff',
  onPrimary: '#14162b',
  safe: '#8ccbb0',
  review: '#f1bb63',
  quarantine: '#ff8e7c',
  phishing: '#f1677d',
};

const FONT =
  "'IBM Plex Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const APP_URL = (FRONTEND_APP_URL || 'http://localhost:5173').replace(/\/$/, '');

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const formatNumber = (value) => new Intl.NumberFormat('en').format(Number(value) || 0);

// "3 messages", "1 message"
const countOf = (count, noun) => `${formatNumber(count)} ${noun}${count === 1 ? '' : 's'}`;

const formatMonth = (month) => {
  const [year, monthValue] = String(month).split('-');
  const date = new Date(Date.UTC(Number(year), Number(monthValue) - 1, 1));
  return new Intl.DateTimeFormat('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
};

/*
 * Label for a from/to report period (the global time-range filter). Prefers
 * the display label the app sent (e.g. "Yesterday"); falls back to the dates
 * themselves. `to` is exclusive, so the last shown day is the instant just
 * before it.
 */
const formatRangePeriod = ({ from, to, label }) => {
  if (label) return label;
  const formatDay = (value) =>
    new Intl.DateTimeFormat('en', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'Europe/Bucharest',
    }).format(new Date(value));
  const firstDay = formatDay(from);
  const lastDay = formatDay(new Date(new Date(to).getTime() - 1));
  return firstDay === lastDay ? firstDay : `${firstDay} – ${lastDay}`;
};

// Plain-language description for every warning sign. Copied from
// frontend/src/lib/risk.js so the email says what the dashboard says.
// The raw rule id is never shown to the user.
const RULE_DESCRIPTIONS = {
  reply_to_mismatch: 'Reply address differs from the sender — a common phishing trick',
  shortened_url_detected: 'Email contains shortened links that hide the real destination',
  too_many_links_high: 'Unusually high number of links in the message',
  too_many_links_medium: 'Higher than normal number of links in the message',
  high_risk_attachment_extension: 'Attachment has a file type that could be used to install malware (.exe, .bat, etc.)',
  archive_attachment_extension: 'Attachment is a compressed archive that may hide malicious files (.zip, .rar, etc.)',
  'suspicious_link_pattern:ip_address_link': 'A link points to a raw IP address instead of a normal website name',
  'suspicious_link_pattern:embedded_credentials': 'A link contains login details — a strong sign of phishing',
  'suspicious_link_pattern:punycode_domain': 'A link uses a lookalike web address that imitates a real brand',
  'suspicious_link_pattern:very_long_url': 'A link is unusually long, which can hide where it really leads',
  'ai_semantic:urgency_high': 'AI detected language designed to create panic and rush you into acting',
  'ai_semantic:urgency_medium': 'AI detected words pressuring you to act immediately',
  'ai_semantic:social_engineering_high': 'AI detected manipulative tactics — using fear, authority, or rewards to trick you',
  'ai_semantic:social_engineering_medium': 'AI detected some manipulation tactics in the email',
  'ai_semantic:login_or_action_request': 'AI detected language pushing you to click a link or sign in right away',
  'ai_semantic:sensitive_data_request': 'AI detected a request for your password, payment details, or personal codes',
  'ai_semantic:brand_impersonation_suspected': 'AI suspects this email is impersonating a company or brand you know',
  'email_auth:dmarc_fail_policy_reject': 'The sender domain rejects unauthenticated mail, and this message failed that check',
  'email_auth:dmarc_fail_policy_quarantine': 'The sender domain asks that unauthenticated mail be quarantined, and this message failed that check',
  'email_auth:dmarc_fail_policy_none': 'This message did not pass the sender domain’s authentication checks',
  'email_auth:spf_hardfail': 'The server that sent this message is not authorised to send for the sender domain',
  'email_auth:dkim_invalid_signature': 'The message carries a cryptographic signature that does not verify',
  'email_auth:no_authentication_at_all': 'The sender provided no way to verify that this message really came from them',
  'email_auth:claimed_brand_authentication_failed': 'The sender claims a known brand, but could not prove it owns that domain',
  'threat_intelligence:url_known_malicious': 'A link matches a threat intelligence source for malware',
  'threat_intelligence:url_known_phishing_campaign': 'A link matches a known phishing campaign',
  'threat_intelligence:domain_registered_days_ago_lt_7': 'A linked domain was registered in the last week — common for throwaway phishing sites',
  'threat_intelligence:domain_registered_days_ago_lt_30': 'A linked domain was registered within the last month',
  'threat_intelligence:link_text_href_mismatch': 'A link displays one address but actually leads somewhere else',
  'threat_intelligence:redirect_chain_to_different_tld': 'A link redirects to a different site than the sender’s',
  'threat_intelligence:excessive_redirect_chain': 'A link passes through an unusually long chain of redirects',
  'threat_intelligence:redirect_to_private_address': 'A link redirects to a private network address',
};

const getRuleDescription = (rule) => {
  if (RULE_DESCRIPTIONS[rule]) return RULE_DESCRIPTIONS[rule];
  if (/^suspicious_link_pattern:/.test(rule)) return 'A link in the email looks suspicious';
  if (/^too_many_links/.test(rule)) return 'An unusually high number of links';
  if (/^ai_semantic:/.test(rule)) return 'AI detected suspicious intent';
  return 'A suspicious pattern was detected';
};

// The rules that added the most risk to one message, strongest first.
const topReasons = (triggeredRules = [], limit) =>
  triggeredRules
    .filter((item) => (item.points ?? 1) > 0)
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
    .slice(0, limit)
    .map((item) => getRuleDescription(item.rule));

const VERDICTS = {
  suspicious: C.review,
  likely_phishing: C.quarantine,
};

// "PayPal <a@b.com>" -> { name: 'PayPal', address: 'a@b.com' }
const parseSender = (from) => {
  const match = String(from || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1] || match[2], address: match[2] };
  return { name: from || 'Unknown sender', address: '' };
};

// Two initials, the way the app's Avatar shows them.
const initials = (name) =>
  String(name)
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase() || '?';

// Solid equivalent of `hex` at `alpha` over the card, since email clients
// handle rgba() inconsistently.
const tint = (hex, alpha, base = C.card) => {
  const channels = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
  const top = channels(hex);
  const bottom = channels(base);
  return `#${top
    .map((value, i) => Math.round(bottom[i] + (value - bottom[i]) * alpha).toString(16).padStart(2, '0'))
    .join('')}`;
};

const messageHref = (email) => {
  const id = email.emailId ?? email._id;
  return id ? `${APP_URL}/inbox?selected=${encodeURIComponent(String(id))}` : `${APP_URL}/inbox`;
};

// ── Building blocks ──────────────────────────────────────────────────────────

const table = (rows, style = '') =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${style}">${rows}</table>`;

const text = (html, style = '') =>
  `<p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.5;color:${C.fg};${style}">${html}</p>`;

// One card on the panel, like a dashboard section.
const card = (inner, isFirst) => `
  <tr><td style="padding:${isFirst ? 0 : 12}px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.card};border-radius:16px;">
      <tr><td style="padding:24px 26px;">${inner}</td></tr>
    </table>
  </td></tr>`;

/** Shared shell: wordmark, greeting, a stack of cards, and a footer line. */
const shell = ({ preheader, title, subtitle, cards, footer }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <style>@font-face{font-family:'IBM Plex Sans';font-style:normal;font-weight:100 700;src:url('${APP_URL}/fonts/plex/IBMPlexSans-Roman-100to700-latin.woff2') format('woff2');}</style>
</head>
<body style="margin:0;padding:0;background:${C.page};">
  <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>
  ${table(`<tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${C.panel};border-radius:22px;">
      <tr><td style="padding:32px 28px 28px;">
        ${text('Barb', `font-size:13px;font-weight:600;color:${C.muted};`)}
        ${text(title, 'font-size:24px;font-weight:500;line-height:1.25;letter-spacing:-0.015em;margin-top:22px;')}
        ${subtitle ? text(subtitle, `font-size:15px;color:${C.muted};margin-top:4px;`) : ''}
        ${table(cards.map((inner, i) => card(inner, i === 0)).join(''), 'margin-top:24px;')}
        ${text(footer, `font-size:12px;color:${C.subtle};margin-top:24px;`)}
      </td></tr>
    </table>
  </td></tr>`, `background:${C.page};`)}
</body>
</html>`;

// "<coloured count> looks like phishing", with an optional muted line below.
const lead = (highlight, phrase, color, detail) =>
  text(`<span style="color:${color};">${highlight}</span> ${phrase}`, 'font-size:22px;font-weight:500;line-height:1.3;letter-spacing:-0.01em;') +
  (detail ? text(detail, `color:${C.muted};margin-top:6px;`) : '');

// Primary filled button plus an optional text link, like the dashboard hero.
const actions = (primary, secondary) => table(`<tr>
  ${primary ? `<td style="padding-right:22px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td bgcolor="${C.primary}" style="border-radius:10px;">
        <a href="${primary.href}" target="_blank" style="display:inline-block;padding:11px 18px;font-family:${FONT};font-size:14px;font-weight:500;line-height:1;color:${C.onPrimary};text-decoration:none;white-space:nowrap;">${primary.label}</a>
      </td>
    </tr></table>
  </td>` : ''}
  ${secondary ? `<td><a href="${secondary.href}" target="_blank" style="font-family:${FONT};font-size:14px;font-weight:500;color:${C.fg};text-decoration:none;white-space:nowrap;">${secondary.label}</a></td>` : ''}
  <td width="100%"></td>
</tr>`, 'margin-top:22px;');

const sectionHeading = (label, right = '') => table(`<tr>
  <td>${text(label, 'font-weight:600;')}</td>
  ${right ? `<td align="right">${right}</td>` : ''}
</tr>`, 'margin-bottom:6px;');

const scorePill = (score, color) =>
  `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${tint(color, 0.14)};font-family:${FONT};font-size:12px;font-weight:600;color:${color};">${Math.round(score)}</span>`;

// Flagged messages as the app lists them: avatar, sender and address,
// subject, the strongest reasons, and the score.
const messageList = (emails, reasonsPerEmail) =>
  table(emails.map((email, index) => {
    const sender = parseSender(email.from);
    const color = VERDICTS[email.verdict] || C.quarantine;
    const reasons = topReasons(email.triggeredRules, reasonsPerEmail);
    const divider = index < emails.length - 1 ? `border-bottom:1px solid ${C.line};` : '';
    return `<tr>
      <td width="48" style="padding:12px 0;vertical-align:top;${divider}">
        <div style="width:36px;height:36px;border-radius:18px;background:${C.avatar};text-align:center;font-family:${FONT};font-size:12px;font-weight:600;line-height:36px;color:${C.muted};">${escapeHtml(initials(sender.name))}</div>
      </td>
      <td style="padding:12px 0;vertical-align:top;${divider}">
        <a href="${messageHref(email)}" target="_blank" style="text-decoration:none;">
          ${text(`${escapeHtml(sender.name)} <span style="font-size:12px;font-weight:400;color:${C.subtle};">${escapeHtml(sender.address)}</span>`, 'font-weight:600;')}
          ${text(escapeHtml(email.subject || '(no subject)'), `color:${C.muted};margin-top:1px;`)}
        </a>
        ${reasons.length ? text(reasons.map(escapeHtml).join('<br>'), `font-size:13px;color:${C.subtle};margin-top:6px;`) : ''}
      </td>
      <td width="52" align="right" style="padding:14px 0 12px;vertical-align:top;${divider}">${email.score != null ? scorePill(email.score, color) : ''}</td>
    </tr>`;
  }).join(''));

// Dashboard-style legend: dot, label, count.
const legend = (rows, note) =>
  table(rows.map(([label, value, color]) => `<tr>
    <td width="16" style="padding:5px 0;"><div style="width:7px;height:7px;border-radius:4px;background:${color};font-size:0;line-height:0;">&nbsp;</div></td>
    <td style="padding:5px 0;">${text(label, `color:${C.muted};`)}</td>
    <td align="right" style="padding:5px 0;">${text(formatNumber(value), 'font-weight:600;')}</td>
  </tr>`).join('')) +
  (note ? text(note, `font-size:13px;color:${C.subtle};margin-top:10px;`) : '');

// One thin stacked bar of the verdict split.
const verdictBar = (rows, total) => {
  const parts = rows.filter(([, value]) => value > 0);
  if (total <= 0 || parts.length === 0) return '';
  return table(`<tr>${parts.map(([, value, color], i) => {
    const radius = `${i === 0 ? 'border-top-left-radius:3px;border-bottom-left-radius:3px;' : ''}${i === parts.length - 1 ? 'border-top-right-radius:3px;border-bottom-right-radius:3px;' : ''}`;
    return `<td width="${((value / total) * 100).toFixed(2)}%" style="background:${color};height:6px;font-size:0;line-height:0;${radius}">&nbsp;</td>`;
  }).join('')}</tr>`, 'margin:22px 0 16px;');
};

// ── Templates ────────────────────────────────────────────────────────────────

const welcomeTemplate = (userName) => ({
  subject: `Welcome to Barb, ${userName}`,
  html: shell({
    preheader: 'Connect Gmail and Barb will check every new message for phishing.',
    title: `Welcome to Barb, ${escapeHtml(userName)}`,
    subtitle: 'Connect Gmail and Barb will check every new message for phishing.',
    cards: [
      table([
        ['Every message gets a verdict', 'Safe, suspicious, or likely phishing, with the rules that decided it.'],
        ['Alerts when it matters', 'An email as soon as something looks like phishing.'],
        ['A short digest each morning', 'What arrived, and what is worth a second look.'],
      ].map(([heading, detail], i, all) => `<tr><td style="padding:10px 0;${i < all.length - 1 ? `border-bottom:1px solid ${C.line};` : ''}">
        ${text(heading, 'font-weight:600;')}
        ${text(detail, `color:${C.muted};margin-top:2px;`)}
      </td></tr>`).join('')) +
      actions({ label: 'Connect Gmail', href: `${APP_URL}/settings` }),
    ],
    footer: 'You get this email because you created a Barb account.',
  }),
});

export const monthlyDigestTemplate = ({ summary }) => {
  // Month mode keeps the historical "June 2026" label; range mode (global
  // time filter) labels the report with the selected period instead.
  const isMonthPeriod = Boolean(summary.period.month);
  const periodLabel = isMonthPeriod
    ? formatMonth(summary.period.month)
    : formatRangePeriod(summary.period);
  const counts = summary.counts;
  const ai = summary.ai || {};

  /*
   * Use the EFFECTIVE verdicts (the user's manual "mark safe" / "mark phishing"
   * overrides applied on top of the raw scan), so the email matches the
   * dashboard. The raw scan counts do NOT move when a user reviews an email.
   * Fall back to the raw counts only if a caller supplies a summary without the
   * effective fields.
   */
  const safeCount = counts.effectiveSafe ?? counts.safe ?? 0;
  const suspiciousCount = counts.effectiveSuspicious ?? counts.suspicious ?? 0;
  const likelyPhishingCount = counts.effectiveLikelyPhishing ?? counts.likelyPhishing ?? 0;
  const markedPhishingCount = counts.effectiveMarkedPhishing ?? counts.markedPhishing ?? 0;

  const scanned = counts.scannedEmails || 0;
  const synced = counts.syncedEmails ?? scanned;
  const safeRate = scanned > 0 ? Math.round((safeCount / scanned) * 100) : 0;
  const threats = suspiciousCount + likelyPhishingCount + markedPhishingCount;
  const rateColor = safeRate >= 80 ? C.safe : safeRate >= 50 ? C.review : C.quarantine;

  const verdictRows = [
    ['Safe', safeCount, C.safe],
    ['Suspicious', suspiciousCount, C.review],
    ['Likely phishing', likelyPhishingCount, C.quarantine],
    ['Confirmed by you', markedPhishingCount, C.phishing],
  ];

  // Say when the AI layer did not run, so the numbers are not over-trusted.
  const aiNotes = [];
  if ((ai.failed || 0) > 0) {
    aiNotes.push(`The AI model was unavailable for ${countOf(ai.failed, 'message')}. The rules still scored them.`);
  }
  if ((ai.disabled || 0) > 0) {
    aiNotes.push((ai.evaluated || 0) > 0
      ? `AI analysis was off for ${countOf(ai.disabled, 'message')}. The rules still scored them.`
      : 'AI analysis is off. The rule score stands alone.');
  }

  const scannedLine = synced > scanned
    ? `${formatNumber(scanned)} of ${formatNumber(synced)} messages scanned`
    : `${countOf(scanned, 'message')} scanned`;

  const rules = (summary.topTriggeredRules || []).slice(0, 5);

  return {
    subject: `Your Barb report: ${periodLabel}`,
    html: shell({
      preheader: `${safeRate}% safe, ${formatNumber(threats)} flagged. ${periodLabel}.`,
      title: isMonthPeriod ? `Your ${escapeHtml(periodLabel.split(' ')[0])} in review` : 'Your inbox report',
      subtitle: isMonthPeriod
        ? `${scannedLine} in ${escapeHtml(periodLabel)}.`
        : `${escapeHtml(periodLabel)}. ${scannedLine}.`,
      cards: [
        (scanned > 0
          ? lead(`${safeRate}%`, 'of your mail was safe', rateColor,
            threats > 0 ? `${countOf(threats, 'message')} ${threats === 1 ? 'was' : 'were'} flagged.` : 'Nothing was flagged.')
          : lead('No messages', 'were scanned in this period', C.muted, '')) +
        verdictBar(verdictRows, scanned) +
        legend(verdictRows, aiNotes.join(' ')) +
        actions({ label: 'Open dashboard', href: `${APP_URL}/dashboard` }),
        ...(rules.length > 0 ? [
          sectionHeading('What triggered the most') +
          table(rules.map((item, i) => {
            const divider = i < rules.length - 1 ? `border-bottom:1px solid ${C.line};` : '';
            return `<tr>
              <td style="padding:9px 0;${divider}">${text(escapeHtml(getRuleDescription(item.rule)), `color:${C.muted};`)}</td>
              <td align="right" style="padding:9px 0 9px 12px;${divider}">${text(formatNumber(item.count), 'font-weight:600;')}</td>
            </tr>`;
          }).join('')),
        ] : []),
      ],
      footer: 'You asked Barb to send this report. You can send another from the dashboard.',
    }),
  };
};

export const dailyDigestTemplate = ({ summary, userName }) => {
  const counts = summary.counts;
  const riskyEmails = Array.isArray(summary.riskyEmails) ? summary.riskyEmails : [];
  const scanned = counts.scannedEmails || 0;
  const safe = counts.safe || 0;
  const suspicious = counts.suspicious || 0;
  const likelyPhishing = counts.likelyPhishing || 0;
  const needsReview = suspicious + likelyPhishing;
  const allClear = needsReview === 0;

  const headline = likelyPhishing > 0
    ? { count: likelyPhishing, phrase: likelyPhishing === 1 ? 'looks like phishing' : 'look like phishing', color: C.quarantine }
    : { count: suspicious, phrase: suspicious === 1 ? 'is worth a second look' : 'are worth a second look', color: C.review };
  const extra = likelyPhishing > 0 && suspicious > 0
    ? `${formatNumber(suspicious)} more ${suspicious === 1 ? 'is' : 'are'} worth a second look.`
    : '';

  const verdictLegend = legend([
    ['Safe', safe, C.safe],
    ['Suspicious', suspicious, C.review],
    ['Likely phishing', likelyPhishing, C.quarantine],
  ], `${countOf(scanned, 'message')} scanned`);

  const cards = allClear
    ? [
      lead('Nothing', 'needs your attention', C.safe, `All ${countOf(scanned, 'message')} look safe.`) +
      actions(null, { label: 'Open inbox', href: `${APP_URL}/inbox` }),
      verdictLegend,
    ]
    : [
      lead(countOf(headline.count, 'message'), headline.phrase, headline.color, extra) +
      actions(
        { label: 'Review them', href: `${APP_URL}/inbox?riskBucket=${likelyPhishing > 0 ? 'quarantine' : 'needs_review'}` },
        { label: 'Open inbox', href: `${APP_URL}/inbox` },
      ),
      ...(riskyEmails.length > 0 ? [
        sectionHeading('Needs your review', `<a href="${APP_URL}/inbox" target="_blank" style="font-family:${FONT};font-size:13px;font-weight:500;color:${C.primary};text-decoration:none;">All ${formatNumber(needsReview)}</a>`) +
        messageList(riskyEmails, 1),
      ] : []),
      verdictLegend,
    ];

  return {
    subject: allClear
      ? 'Nothing needs your attention today'
      : `${countOf(headline.count, 'message')} ${headline.phrase}`,
    html: shell({
      preheader: allClear
        ? `All ${countOf(scanned, 'message')} from the last 24 hours look safe.`
        : `${countOf(needsReview, 'message')} from the last 24 hours ${needsReview === 1 ? 'needs' : 'need'} your review.`,
      title: `Good morning, ${escapeHtml(userName || 'there')}`,
      subtitle: 'Your inbox over the last 24 hours.',
      cards,
      footer: 'You get this digest every morning. You can change the time or turn it off in Settings.',
    }),
  };
};

export const phishingAlertTemplate = ({ emails }) => {
  const count = emails.length;
  const one = count === 1;
  const highlight = countOf(count, 'message');
  const phrase = one ? 'looks like phishing' : 'look like phishing';

  return {
    subject: `${highlight} ${phrase}`,
    html: shell({
      preheader: one
        ? `${parseSender(emails[0].from).name}: ${emails[0].subject || '(no subject)'}`
        : `${highlight} in your latest sync ${phrase}.`,
      title: `<span style="color:${C.quarantine};">${highlight}</span> ${phrase}`,
      subtitle: `Found in your latest sync. Don't open ${one ? 'its' : 'their'} links or attachments until you've checked ${one ? 'it' : 'them'}.`,
      cards: [
        messageList(emails, one ? 3 : 1) +
        actions(
          one
            ? { label: 'Review it', href: messageHref(emails[0]) }
            : { label: 'Review them', href: `${APP_URL}/inbox?riskBucket=quarantine` },
          { label: 'Open inbox', href: `${APP_URL}/inbox` },
        ),
      ],
      footer: 'You get this email because phishing alerts are on. You can turn them off in Settings.',
    }),
  };
};

// The contact form message that goes to the support inbox.
export const contactMessageTemplate = ({ userName, userEmail, subject, message }) =>
  shell({
    preheader: String(message || '').slice(0, 90),
    title: escapeHtml(subject),
    subtitle: `${escapeHtml(userName)} · ${escapeHtml(userEmail)}`,
    cards: [text(escapeHtml(message).replaceAll('\n', '<br>'), 'font-size:15px;line-height:1.6;')],
    footer: 'Sent from the Barb contact form. Reply to this email to answer.',
  });

export default welcomeTemplate;
