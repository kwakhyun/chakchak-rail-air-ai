import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "착착 CHAK² — 항공부터 철도까지 이어주는 여행 도우미",
  description: "항공 도착, 입국장, 날씨와 철도 데이터를 연결해 실제로 탈 수 있는 열차와 이어지는 지역 여행을 안내합니다."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
