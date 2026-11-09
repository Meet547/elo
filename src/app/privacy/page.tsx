import Link from "next/link";
export const metadata = { title: "Privacy", robots: { index: false, follow: false } };

export default function Page() {
  return <main className="elo-page max-w-3xl">
    <h1 className="mb-4 text-3xl">Privacy</h1>
    <p className="mb-4">The owner’s privacy notice is pending approval for the prototype.</p>
    <Link className="elo-link" href="/settings">Account settings and data controls</Link>
  </main>;
}
