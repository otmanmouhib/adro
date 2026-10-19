"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Home" },
  { href: "/wifi", label: "WiFi Setup" },
  { href: "/devices", label: "Devices" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 border-r border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-8">
        <span className="text-lg font-semibold tracking-tight">
          {process.env.NEXT_PUBLIC_ADRO_TITLE || "Adro Hub"}
        </span>
      </div>
      <nav className="flex flex-col gap-1">
        {links.map(({ href, label }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}