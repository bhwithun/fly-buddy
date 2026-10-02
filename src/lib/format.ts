export function formatClock(unix: number, timeZone?: string | null) {
  const date = new Date(unix * 1000);
  const options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  try {
    return new Intl.DateTimeFormat("en-US", {
      ...options,
      timeZone: timeZone || undefined,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", options).format(date);
  }
}

export function formatDay(unix: number, timeZone?: string | null) {
  const date = new Date(unix * 1000);
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
  };
  try {
    return new Intl.DateTimeFormat("en-US", {
      ...options,
      timeZone: timeZone || undefined,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", options).format(date);
  }
}

export function timeZoneName(unix: number, timeZone?: string | null) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || undefined,
      timeZoneName: "short",
      hour: "numeric",
    }).formatToParts(new Date(unix * 1000));
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

export function formatAgo(fromMs: number, nowMs: number) {
  const seconds = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (seconds < 20) return "just now";
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr ago`;
}

export function formatSpan(totalSeconds: number) {
  const minutes = Math.max(0, Math.round(totalSeconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) return hours === 1 ? "1 hr" : `${hours} hr`;
  return `${hours} hr ${remainder} min`;
}

export function formatMiles(meters: number) {
  const miles = meters / 1609.344;
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

export function formatFeet(feet: number) {
  return `${Math.round(feet).toLocaleString("en-US")} ft`;
}

export function formatUntil(unix: number, nowMs: number) {
  const diffMs = unix * 1000 - nowMs;
  if (Math.abs(diffMs) < 30_000) return "now";
  const label = formatSpan(Math.abs(diffMs) / 1000);
  return diffMs > 0 ? `in ${label}` : `${label} ago`;
}
