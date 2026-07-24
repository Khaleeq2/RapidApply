import type { Metadata } from "next";
import "../styles/index.css";

export const metadata: Metadata = {
  title: "RapidApply - Job Application Automation Dashboard",
  description:
    "Effortlessly apply to multiple job boards with a single click, streamlining your job search process and maximizing opportunities with minimal effort.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">
        {children}
      </body>
    </html>
  );
}
