import { execSync } from "node:child_process";
import type { Metadata, Viewport } from "next";
import { outfit } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "fly-buddy",
  description: "Track a flight's arrival and see when to leave for the airport.",
  applicationName: "fly-buddy",
  appleWebApp: {
    capable: true,
    title: "fly-buddy",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#090d16",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

function commitStamp() {
  const full = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (full) return { short: full.slice(0, 7), full };
  try {
    const short = execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return short ? { short, full: short } : null;
  } catch {
    return null;
  }
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  const commit = commitStamp();
  return (
    <html lang="en" className="h-full">
      <body className={`${outfit.className} min-h-full antialiased`}>
        {commit ? (
          <p
            title={commit.full}
            className="pointer-events-none fixed top-[max(0.4rem,env(safe-area-inset-top))] right-[max(0.7rem,env(safe-area-inset-right))] z-20 font-mono text-[10px] tracking-wide text-muted/55 select-none"
          >
            {commit.short}
          </p>
        ) : null}
        {children}
      </body>
    </html>
  );
}
