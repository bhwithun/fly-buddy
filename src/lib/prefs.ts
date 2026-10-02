export const FLIGHT_COOKIE = "fly-buddy-flight";
export const ADDRESS_COOKIE = "fly-buddy-address";
export const BUFFER_COOKIE = "fly-buddy-buffer";
export const EARLY_COOKIE = "fly-buddy-early";
export const MODE_COOKIE = "fly-buddy-mode";

const YEAR_SECONDS = 60 * 60 * 24 * 365;

export function cookiePair(name: string, value: string, secure: boolean) {
  const secureAttr = secure ? "; Secure" : "";
  if (!value) return `${name}=; Path=/; Max-Age=0; SameSite=Lax${secureAttr}`;
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${YEAR_SECONDS}; SameSite=Lax${secureAttr}`;
}

export function readCookieValue(jar: string, name: string) {
  const prefix = `${name}=`;
  for (const part of jar.split("; ")) {
    if (!part.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(part.slice(prefix.length));
    } catch {
      return null;
    }
  }
  return null;
}

export function readCookie(name: string) {
  return readCookieValue(document.cookie, name);
}

export function writeCookie(name: string, value: string) {
  const secure = window.location.protocol === "https:";
  document.cookie = cookiePair(name, value, secure);
}
