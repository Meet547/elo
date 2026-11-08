import { LiveEntry } from "@/components/views/LiveRoom";

export const metadata = { title: "Live table", robots: { index: false, follow: false } };

export default async function LiveRoomPage({ params }: { params: Promise<{ code: string }> }) {
  return <LiveEntry code={(await params).code.toUpperCase()} />;
}
