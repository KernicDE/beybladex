import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { RegisterServiceWorker } from "@/components/pwa/RegisterServiceWorker";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { Header } from "@/components/layout/Header";
import { MobileNav } from "@/components/layout/MobileNav";
import { Footer } from "@/components/layout/Footer";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "BeybladeX.de",
    template: "%s · BeybladeX.de",
  },
  description: "Die DACH-Community für Beyblade X — Turniere, Regeln, Decks, Sammlung und Clubs.",
};

const THEME_INIT_SCRIPT = `
(function() {
  try {
    var stored = localStorage.getItem('beybladex-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = stored === 'dark' || (stored !== 'light' && prefersDark);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await auth();
  // Phase 21: the header menu shows the viewer's OWN avatar. The session JWT only carries
  // id/name (lib/auth.ts), so the avatar id is read here and passed down — always the
  // viewer's own row, no privacy gate needed, same as the username it renders next to.
  const avatarImageId = session?.user?.id
    ? (await prisma.user.findUnique({ where: { id: session.user.id }, select: { avatarImageId: true } }))
        ?.avatarImageId ?? null
    : null;
  // RC10 #26 — the header bell's unread badge. Same session-scoped server query as the
  // avatar above; one count query, never per-render client fetches in the chrome.
  const unreadNotifications = session?.user?.id
    ? await prisma.notification.count({ where: { userId: session.user.id, isRead: false } })
    : 0;
  return (
    <html
      lang="de"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <Header session={session} avatarImageId={avatarImageId} unreadNotifications={unreadNotifications} />
          <main className="flex-1 pb-12 md:pb-0">{children}</main>
        </ThemeProvider>
        <Footer />
        <MobileNav session={session} />
        <RegisterServiceWorker />
        <InstallPrompt />
      </body>
    </html>
  );
}
