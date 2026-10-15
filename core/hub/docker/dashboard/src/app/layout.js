import "./globals.css";
import Sidebar from "@/components/Sidebar";

export const metadata = {
  title: "Adro Hub",
  description: "Local hub control panel",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 font-sans antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 p-8 lg:p-12">{children}</main>
        </div>
      </body>
    </html>
  );
}