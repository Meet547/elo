import { RankedEntry } from "@/components/views/Ranked";

export const metadata = { title: "Ranked matchmaking" };

export default async function RankedPage({ searchParams }: { searchParams: Promise<{ queue?: string }> }) {
  return <RankedEntry autoQueue={(await searchParams).queue === "1"} />;
}
