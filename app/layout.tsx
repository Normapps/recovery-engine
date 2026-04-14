import type { Metadata } from "next";
import "./globals.css";
import NavBar from "@/components/ui/NavBar";

export const metadata: Metadata = {
  title: "Recovery Engine",
  description: "Daily recovery scoring and coaching for performance athletes",
};

export const viewport = {
  themeColor: "#0B0F14",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-bg-primary text-text-primary">
        <main className="max-w-lg mx-auto px-4 pt-8 pb-24 min-h-dvh">
          {children}
        </main>
        <NavBar />
      </body>
    </html>
  );
}
