import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Material Planner - AI Visual Designer",
  description: "Visualize interior materials in your space with AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="is" suppressHydrationWarning>
      <body className={`${dmSans.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
