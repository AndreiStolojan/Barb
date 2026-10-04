// ─────────────────────────────────────────────────────────────────────────────
// formatDate.js — funcții ajutătoare pentru afișarea datelor în UI.
//
// Ce face, pe scurt: primește un timestamp (string ISO sau obiect Date) și îl
// transformă într-un text prietenos pentru utilizator: "12 Mar, 14:30",
// "Yesterday", "Mon", etc. Folosit în lista de emailuri, pagina de detaliu și
// pe dashboard, oriunde trebuie arătată o dată/oră.
// ─────────────────────────────────────────────────────────────────────────────

// Formatează data + ora completă (ex: "12 Mar, 14:30"). Folosit pentru afișări
// detaliate, unde userul are nevoie de data exactă.
export const formatDateTime = (value) => {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  // Dacă valoarea nu poate fi transformată într-o dată validă, afișăm un mesaj generic.
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

// Formatează data unui email în stilul "gen Gmail": ora dacă e azi, "Yesterday"
// dacă a fost ieri, ziua săptămânii dacă e în săptămâna asta, altfel data
// completă (cu anul, dacă nu e anul curent). Folosit în lista de emailuri.
export const formatEmailDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  // "Începutul zilei de azi" — folosit ca reper pentru comparații (oră 00:00).
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfToday.getDate() - 1);
  // Calculăm începutul săptămânii curente (luni). getDay() == 0 înseamnă duminică,
  // deci pentru duminică ne dăm înapoi 6 zile, altfel (ziua - 1) zile.
  const dayOfWeek = startOfToday.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const startOfWeek = new Date(startOfToday); startOfWeek.setDate(startOfToday.getDate() - daysToMonday);

  if (date >= startOfToday) {
    // E din ziua de azi -> arătăm doar ora (ex: "14:30").
    return new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(date);
  }
  if (date >= startOfYesterday) {
    return 'Yesterday';
  }
  if (date >= startOfWeek) {
    // E în săptămâna curentă -> arătăm ziua săptămânii (ex: "Mon").
    return new Intl.DateTimeFormat('en', { weekday: 'short' }).format(date);
  }
  if (date.getFullYear() === now.getFullYear()) {
    // E în anul curent, dar mai vechi de o săptămână -> "12 Mar" (fără an).
    return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date);
  }
  // E dintr-un an diferit -> includem și anul (ex: "12 Mar 2025").
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};

// Mică funcție ajutătoare: "rotunjește" o dată la începutul zilei (00:00:00),
// ignorând ora exactă. Folosită pentru a compara doar ziua, nu și ora.
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// Returnează eticheta grupului de dată pentru un email: "Today", "Yesterday",
// "This week" sau "Older". Folosit pentru a grupa vizual emailurile în listă
// (ex: secțiuni separate "Azi" / "Ieri" / "Săptămâna asta" / "Mai vechi").
export const getDateGroupLabel = (value) => {
  if (!value) return 'Older';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Older';

  const now = new Date();
  const today = startOfDay(now);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

  // La fel ca mai sus: calculăm începutul săptămânii curente (luni).
  const dayOfWeek = today.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - daysToMonday);

  const d = startOfDay(date);
  if (d >= today) return 'Today';
  if (d >= yesterday) return 'Yesterday';
  if (d >= weekStart) return 'This week';
  return 'Older';
};

/*
  The time shown on a list row. Rows are grouped under Today / Yesterday /
  This week / Older headers, so the row itself never repeats the group word:
  today and yesterday show the clock time, this week the weekday, older the date.
*/
export const formatRowTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfToday.getDate() - 1);
  if (date >= startOfYesterday) {
    return new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }
  return formatEmailDate(value);
};
