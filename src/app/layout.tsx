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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className={`${outfit.className} min-h-full antialiased`}>{children}</body>
    </html>
  );
}
