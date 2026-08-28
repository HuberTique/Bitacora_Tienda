import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  weight: ["500", "600", "700"],
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Bitácora Digital",
  description: "Gestión de tienda — bitácora, feedbacks, horarios, presupuestos",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${plexSans.variable} ${plexMono.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
