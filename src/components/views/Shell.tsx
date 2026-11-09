"use client";

// ---------------------------------------------------------------------------
// Shell — the app around the game. A quiet sidebar on desktop: where you are,
// what you've done this season, how far to the next tier, who you are. On
// phones it folds into a slim strip (and steps aside entirely during a hand).
// ---------------------------------------------------------------------------

import { useFelt } from "@/store/game";
import { Wordmark } from "@/components/felt/brand";
import { RoomFooter } from "@/components/felt/room-footer";
import { Plate, ScrambleText } from "@/components/felt/kit";
import { nextTierOf, ordinal, tierOf } from "@/lib/rating";
import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

function NavItem({
  idx,
  label,
  active,
  onClick,
}: {
  idx: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
        active ? "bg-canvas text-ink" : "text-ink-soft hover:bg-canvas/60 hover:text-ink",
      )}
    >
      <span className={cn("font-mono text-[9px]", active ? "text-carmine" : "text-ink-faint")}>{idx}</span>
      <span className="text-[13px] font-medium leading-none">{label}</span>
      <span className={cn("ml-auto h-1.5 w-1.5 rounded-full", active ? "bg-carmine" : "bg-transparent")} />
    </button>
  );
}

function SeasonRow({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "money" | "carmine" }) {
  return (
    <div className="flex items-baseline justify-between py-[3px]">
      <span className="font-mono text-[10px] uppercase text-ink-faint">{k}</span>
      <span
        className={cn(
          "tnum font-mono text-[11px] font-semibold",
          tone === "money" && "text-money",
          tone === "carmine" && "text-carmine",
        )}
      >
        {v}
      </span>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { view, profile, ladder, muted, toggleMute, backToLobby, openProfile } = useFelt();
  const meRank = profile?.rank ?? ladder.find((p) => p.isMe)?.rank;
  const pathname = usePathname();
  const router = useRouter();
  const ranked = pathname === "/ranked";
  const live = pathname === "/live";
  const home = pathname === "/";
  const isTable = pathname === "/table" && view === "table";
  const profilePage = pathname === "/profile";

  const rating = profile?.rating ?? 0;
  const tier = tierOf(rating);
  const next = nextTierOf(rating);
  const pct = next ? Math.max(0.04, Math.min(1, (rating - tier.min) / (next.at - tier.min))) : 1;

  const nav = (target: "lobby" | "profile") => () => {
    (target === "profile" ? openProfile : backToLobby)();
    router.push(target === "profile" ? "/profile" : "/");
  };
  const streakLabel =
    !profile || profile.streak === 0 ? "—" : profile.streak > 0 ? `W${profile.streak}` : `L${-profile.streak}`;

  return (
    <div className="flex min-h-dvh w-full">
      {/* ------------------------------------------------------ sidebar */}
      <aside className={cn("sticky top-0 hidden h-dvh w-[13rem] shrink-0 flex-col border-r border-hairline bg-paper px-4 pb-5 pt-6 xl:w-[14rem]", !isTable && "lg:flex")}>
        <div>
          <Wordmark className="text-3xl" />
          <div className="mt-1.5 pl-[1px] font-mono text-[9px] uppercase text-ink-faint">
            rated poker · play money
          </div>
        </div>

        <nav className="mt-8 space-y-0.5">
          <NavItem idx="01" label="Lobby" active={home} onClick={nav("lobby")} />
          <NavItem idx="02" label="Profile" active={profilePage} onClick={nav("profile")} />
          <Link href="/ranked" aria-current={ranked ? "page" : undefined} className={cn("flex min-h-9 items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] transition-colors", ranked ? "bg-canvas text-ink" : "text-ink-soft hover:bg-canvas")}>
            <span className={cn("font-mono text-[9px]", ranked ? "text-carmine" : "text-ink-faint")}>03</span> Ranked
            <span className={cn("ml-auto h-1.5 w-1.5 rounded-full", ranked ? "bg-carmine" : "bg-transparent")} />
          </Link>
          <Link href="/live" aria-current={live ? "page" : undefined} className={cn("flex min-h-9 items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] transition-colors", live ? "bg-canvas text-ink" : "text-ink-soft hover:bg-canvas")}>
            <span className={cn("font-mono text-[9px]", live ? "text-carmine" : "text-ink-faint")}>04</span> Live rooms
            <span className={cn("ml-auto h-1.5 w-1.5 rounded-full", live ? "bg-carmine" : "bg-transparent")} />
          </Link>
          <Link href="/leaderboard" aria-current={pathname === "/leaderboard" ? "page" : undefined} className="flex min-h-9 items-center rounded-lg px-2.5 text-[13px] text-ink-soft hover:bg-canvas">Leaderboard</Link>
          <Link href="/settings" aria-current={pathname === "/settings" ? "page" : undefined} className="flex min-h-9 items-center rounded-lg px-2.5 text-[13px] text-ink-soft hover:bg-canvas">Settings</Link>
        </nav>

        {profile ? (
          <>
            <div className="mt-8">
              <div className="mb-1.5 label">lifetime</div>
              <SeasonRow k="hands" v={profile.hands.toLocaleString("en-US")} />
              <SeasonRow k="firsts" v={profile.cashes.toLocaleString("en-US")} tone={profile.cashes > 0 ? "money" : undefined} />
              <SeasonRow
                k="streak"
                v={streakLabel}
                tone={profile.streak > 0 ? "money" : profile.streak < 0 ? "carmine" : undefined}
              />
              <SeasonRow k="peak" v={profile.peak.toLocaleString("en-US")} />
            </div>

            <div className="mt-7">
              <div className="mb-1.5 label">tier</div>
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-medium leading-none">{tier.label}</span>
                <span className="font-mono text-[9px] uppercase text-ink-faint">
                  {next ? `${next.label} · ${next.at}` : "the ceiling"}
                </span>
              </div>
              {/* scaleX rather than width: a progress bar must never cost a layout pass */}
              <div className="mt-2.5 h-[5px] overflow-hidden rounded-full bg-canvas">
                <div
                  className={cn(
                    "h-full w-full origin-left rounded-full transition-transform duration-700 [transition-timing-function:var(--ease-travel)]",
                    next ? "bg-ink" : "bg-carmine",
                  )}
                  style={{ transform: `scaleX(${Math.max(0, Math.min(1, pct))})` }}
                />
              </div>
              {next ? (
                <div className="tnum mt-1.5 font-mono text-[9px] text-ink-faint">
                  {Math.max(0, next.at - rating)} to {next.label}
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        <div className="mt-auto space-y-3">
          {profile ? (
            <button onClick={nav("profile")} className="w-full text-left">
              <Plate
                className="w-full"
                name={profile.name}
                sub={meRank ? `${ordinal(meRank)} on the ladder` : "unranked"}
                active={profilePage}
                right={
                  <div className="text-right">
                    <ScrambleText
                      value={rating}
                      format={(v) => v.toLocaleString("en-US")}
                      className="font-mono text-[13px] font-semibold"
                    />
                    <div className="font-mono text-[8px] uppercase text-ink-faint">{tier.label}</div>
                  </div>
                }
              />
            </button>
          ) : null}
          <button
            onClick={toggleMute}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-ink-faint transition-colors hover:bg-canvas/60 hover:text-ink"
          >
            <span className="font-mono text-[10px] uppercase ">sound</span>
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </aside>

      {/* --------------------------------------------------------- main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!isTable ? (
          <header className="flex items-center justify-between gap-2 border-b border-hairline bg-paper px-3 py-1.5 lg:hidden">
            <Wordmark className="text-2xl" />
            <nav aria-label="Main navigation" className="flex items-center gap-0.5">
              <button
                onClick={nav("lobby")}
                className={cn(
                  "min-h-11 rounded-lg px-1.5 font-mono text-[10px] uppercase transition-colors",
                  home ? "bg-ink text-paper" : "text-ink-soft",
                )}
              >
                lobby
              </button>
              <button
                onClick={nav("profile")}
                className={cn(
                  "min-h-11 rounded-lg px-1.5 font-mono text-[10px] uppercase transition-colors",
                  profilePage ? "bg-ink text-paper" : "text-ink-soft",
                )}
              >
                profile
              </button>
              <Link href="/ranked" aria-current={ranked ? "page" : undefined} className={cn("inline-flex min-h-11 items-center rounded-lg px-1.5 font-mono text-[10px] uppercase transition-colors", ranked ? "bg-ink text-paper" : "text-ink-soft")}>Ranked</Link>
              <Link href="/live" aria-current={live ? "page" : undefined} className={cn("inline-flex min-h-11 items-center rounded-lg px-1.5 font-mono text-[10px] uppercase transition-colors", live ? "bg-ink text-paper" : "text-ink-soft")}>Live</Link>
              <button onClick={toggleMute} className="grid size-11 shrink-0 place-items-center text-ink-faint" aria-label={muted ? "Unmute" : "Mute"}>
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
            </nav>
          </header>
        ) : null}
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
        {!isTable && <nav aria-label="Account and leaderboard" className="flex flex-wrap justify-center gap-4 px-3 text-xs lg:hidden">
          <Link href="/leaderboard" className="elo-link inline-flex min-h-11 items-center">Leaderboard</Link>
          <Link href="/settings" className="elo-link inline-flex min-h-11 items-center">Settings</Link>
        </nav>}
        {!isTable && <RoomFooter atLiveLobby={live} />}
      </div>
    </div>
  );
}
