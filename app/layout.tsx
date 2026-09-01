import type { Metadata, Viewport } from "next";
import RegisterSW from "./register-sw";
import "./globals.css";

export const metadata: Metadata = {
  title: "제우스 보스타임",
  description: "제우스: 오만의 신 보스 젠타임 관리 및 알림",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f1220",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <RegisterSW />
        {children}
      </body>
    </html>
  );
}
