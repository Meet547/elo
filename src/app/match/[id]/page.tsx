import { MatchRecord } from "@/components/views/MatchRecord";
export const metadata = { title: "Match record", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <MatchRecord id={(await params).id} />;
}
