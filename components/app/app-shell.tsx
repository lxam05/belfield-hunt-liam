"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { History, Map, KanbanSquare, Star, Settings, RefreshCw, Moon, Sun, WifiOff, LogOut } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { loadAll, useStore } from "@/lib/store/store";
import { scrapeNow, signOut } from "@/lib/store/actions";
import { MemberDot } from "./bits";

const NAV = [
  { href: "/map", label: "Map", icon: Map },
  { href: "/searches", label: "Searches", icon: History },
  { href: "/shortlist", label: "Shortlist", icon: Star },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path.startsWith(href);
}

/** Nav links highlight the active route; usePathname must stream inside <Suspense>. */
function NavLinks({ variant }: { variant: "top" | "bottom" }) {
  const path = usePathname();
  return <NavLinksStatic variant={variant} path={path} />;
}

function NavLinksStatic({ variant, path }: { variant: "top" | "bottom"; path: string | null }) {
  if (variant === "top") {
    return (
      <>
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-sm",
              path && isActive(path, n.href) ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {n.label}
          </Link>
        ))}
      </>
    );
  }
  return (
    <>
      {NAV.map((n) => {
        const Icon = n.icon;
        const active = path != null && isActive(path, n.href);
        return (
          <Link key={n.href} href={n.href} className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", active ? "text-primary font-medium" : "text-muted-foreground")}>
            <Icon className="size-5" />
            {n.label}
          </Link>
        );
      })}
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const ready = useStore((s) => s.ready);
  const error = useStore((s) => s.error);
  const offline = useStore((s) => s.offline);
  const me = useStore((s) => s.me);
  const { resolvedTheme, setTheme } = useTheme();
  const [scraping, setScraping] = useState(false);

  useEffect(() => {
    void loadAll();
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-background/85 sticky top-0 z-40 border-b pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-2 px-3">
          <Link href="/" className="font-semibold tracking-tight">
            🏠 Belfield Hunt
          </Link>
          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
            <Suspense fallback={<NavLinksStatic variant="top" path={null} />}>
              <NavLinks variant="top" />
            </Suspense>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={scraping || offline}
              onClick={async () => {
                setScraping(true);
                await scrapeNow();
                setScraping(false);
              }}
              title="Search all of Daft now (full sweep, about $0.25)"
            >
              <RefreshCw className={cn(scraping && "animate-spin")} /> <span className="hidden sm:inline">Find rentals</span>
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Toggle dark mode" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
              <Sun className="hidden dark:block" />
              <Moon className="dark:hidden" />
            </Button>
            {me && <MemberDot member={me} size={26} />}
            <Button size="icon-sm" variant="ghost" aria-label="Sign out" onClick={signOut} className="hidden md:inline-flex">
              <LogOut />
            </Button>
          </div>
        </div>
        {offline && (
          <div className="flex items-center justify-center gap-2 bg-amber-500/15 py-1 text-xs text-amber-800 dark:text-amber-200">
            <WifiOff className="size-3.5" /> Offline: showing the last loaded listings
          </div>
        )}
      </header>

      <main className="flex-1">
        {!ready && !error && <LoadingSkeleton />}
        {!ready && error && (
          <div className="mx-auto max-w-md p-6 text-center">
            <p className="text-destructive font-medium">Couldn&apos;t load data</p>
            <p className="text-muted-foreground mt-1 text-sm">{error}</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button onClick={() => void loadAll(true)}>Retry</Button>
              <Button variant="outline" onClick={signOut}>
                Sign out
              </Button>
            </div>
          </div>
        )}
        {ready && <Suspense fallback={<LoadingSkeleton />}>{children}</Suspense>}
      </main>

      <nav
        aria-label="Main"
        className="bg-background/95 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <div className="grid grid-cols-5">
          <Suspense fallback={<NavLinksStatic variant="bottom" path={null} />}>
            <NavLinks variant="bottom" />
          </Suspense>
        </div>
      </nav>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-36 w-full rounded-xl" />
      ))}
    </div>
  );
}
