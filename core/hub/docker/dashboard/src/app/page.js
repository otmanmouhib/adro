import Link from "next/link";

export default function HomePage() {
  return (
    <div className="max-w-2xl">
      <h1 className="mb-3 text-3xl font-semibold tracking-tight">
        Welcome to Adro Hub
      </h1>
      <p className="mb-8 leading-7 text-zinc-600 dark:text-zinc-400">
        This is the local control panel for your Adro hub. From here you can
        connect the hub to a wireless network and discover nearby Adro
        devices.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/wifi"
          className="rounded-lg border border-zinc-200 p-5 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
        >
          <h2 className="mb-1 font-medium">WiFi Setup</h2>
          <p className="text-sm text-zinc-500">
            Connect this hub to a wireless network.
          </p>
        </Link>

        <Link
          href="/devices"
          className="rounded-lg border border-zinc-200 p-5 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
        >
          <h2 className="mb-1 font-medium">Devices</h2>
          <p className="text-sm text-zinc-500">
            Discover and claim nearby Adro devices.
          </p>
        </Link>
      </div>
    </div>
  );
}