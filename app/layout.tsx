import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hangout",
  description: "Find a few good ways to spend time together nearby.",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
