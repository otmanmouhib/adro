export const metadata = {
  title: "WiFi Setup · Adro Hub",
};

export default function WifiPage() {
  const raspApUrl = "http://adro.local:8080";

  return (
    <div className="max-w-2xl">
      <h1 className="mb-3 text-3xl font-semibold tracking-tight">
        WiFi Setup
      </h1>
      <p className="mb-6 leading-7 text-zinc-600 dark:text-zinc-400">
        WiFi configuration is handled by RaspAP on this hub. Open the link
        below to choose a network and enter your credentials. Once connected,
        come back here — the hub will pick up the new network automatically.
      </p>

      <a
        href={raspApUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        Open RaspAP at {raspApUrl}
        <span aria-hidden>↗</span>
      </a>

      <div className="mt-8 rounded-lg border border-zinc-200 p-5 text-sm text-zinc-500 dark:border-zinc-800">
        <strong className="font-medium text-zinc-700 dark:text-zinc-300">
          Note:
        </strong>{" "}
        If the link doesn&apos;t open, make sure you are on the same network as
        the hub, and that RaspAP is running on port 8080.
      </div>
    </div>
  );
}