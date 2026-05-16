import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Qestra – Run AI agents on your own keys",
  description:
    "Self-hostable agent runner. Bring your own key from OpenAI, Groq, Claude, or Ollama. Approval gates for sensitive actions. Full audit trail. No token markup.",
  openGraph: {
    title: "Qestra – Run AI agents on your own keys",
    description:
      "Self-hostable agent runner. BYOK. Approval gates. Full audit trail. No token markup.",
    type: "website"
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
