import Link from "next/link";
export const metadata = { title: "Terms", robots: { index: false, follow: false } };

export default function Page() {
  return <main className="elo-page max-w-3xl">
    <h1 className="mb-4 text-3xl">Terms</h1>
    <p className="mb-4">The owner’s terms notice is pending approval for the prototype.</p>
    <Link className="elo-link" href="/settings">Account settings and data controls</Link>
  </main>;
}
