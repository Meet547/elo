"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFelt } from "@/store/game";
import { primeAudio } from "@/lib/felt/sound";
import { TactileButton } from "@/components/felt/kit";
import { Shell } from "./Shell";
import { Lobby } from "./Lobby";
import { ProfileView } from "./Profile";
import { AccountAccess } from "./AccountAccess";
import { TableView } from "./TableView";
import { Settlement } from "./Settlement";
import { Onboard } from "./Onboard";
import { Reconnect } from "./Reconnect";

export function ProductEntry({ page }: { page: "lobby" | "profile" | "settings" | "leaderboard" | "table" | "login" }) {
  const { profile, boot, bootError, booting, fetchSessions, refreshLadder, ladder, game, view, seatTable } = useFelt();
  const router = useRouter();
  useEffect(() => { if (!profile) void boot(); }, [boot, profile?.id]);
  useEffect(() => {
    if (page === "profile" && profile) void fetchSessions().catch(() => {});
    if (page === "leaderboard") void refreshLadder();
    if (page === "login" && profile) router.replace("/");
  }, [page, profile?.id, router, fetchSessions, refreshLadder]);
  useEffect(() => {
    const wake = () => primeAudio();
    window.addEventListener("pointerdown", wake, { once: true });
    window.addEventListener("keydown", wake, { once: true });
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);
  if (page !== "leaderboard" && !profile && booting) return <main className="elo-page" role="status">Opening Elo…</main>;
  if (page !== "leaderboard" && !profile && bootError) return <Reconnect />;
  if (page !== "leaderboard" && !profile) return <Onboard />;
  if (page === "login") return <main className="elo-page" role="status">Opening the lobby…</main>;
  if (page === "table" && view === "settle") return <Settlement />;
  return <Shell>
    {page === "lobby" && <Lobby />}
    {page === "profile" && <ProfileView />}
    {page === "settings" && <div className="elo-page max-w-3xl"><h1 className="mb-5 text-3xl">Settings</h1><AccountAccess /></div>}
    {page === "table" && (game ? <TableView /> : <div className="elo-page max-w-3xl">
      <h1 className="text-3xl">Practice table</h1>
      <p className="my-4 text-sm text-ink-soft">Practice runs in this tab. Reloading clears the current game. Practice does not change ranked ratings.</p>
      <TactileButton onClick={seatTable}>Start practice</TactileButton>
      <Link className="elo-link ml-4" href="/">Lobby</Link>
    </div>)}
    {page === "leaderboard" && <div className="elo-page max-w-4xl">
      <h1 className="mb-4 text-3xl">Ranked leaderboard</h1>
      <p className="mb-3 text-sm text-ink-soft">Top 60 real players by rating.</p>
      {ladder.length === 0 && <p role="status" className="my-3 text-sm">No ladder records are available yet.</p>}
      <ol className="elo-panel divide-y divide-hairline px-5">
        {ladder.filter(player => !player.isSimulated).map(player => <li key={player.id} className="flex items-center gap-4 py-3">
          <span className="w-9 shrink-0">#{player.rank}</span><span className="min-w-0 flex-1 break-words">{player.name}</span>
          <span className="tnum">{player.rating.toLocaleString("en-US")}</span>
        </li>)}
      </ol>
    </div>}
  </Shell>;
}
