import settings from "../config/settings";

const tz = settings.timeZone || "America/Chicago";

export function fmtDate(d: string | number | Date) {
  return new Date(d).toLocaleDateString("en-US", { timeZone: tz });
}

export function fmtTime(d: string | number | Date) {
  return new Date(d).toLocaleTimeString("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDateTime(d: string | number | Date) {
  return new Date(d).toLocaleString("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
