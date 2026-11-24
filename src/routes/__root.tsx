/// <reference types="vite/client" />
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SessionContext } from "~/components/session";
import { getMe } from "~/server/api.functions";
import appCss from "~/styles/app.css?url";

export const Route = createRootRoute({
  // Who is signed in is loaded once per navigation and handed to every route below.
  beforeLoad: async () => ({ session: await getMe() }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#0A3D33" },
      { title: "PRMS · Patient Records Management System" },
      { name: "description", content: "A unified electronic health record in which the patient controls access." },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/icon-192.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
});

function RootComponent() {
  const { session } = Route.useRouteContext();
  return (
    <SessionContext.Provider value={session}>
      <Outlet />
    </SessionContext.Provider>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
        {/* The service worker makes the app installable and keeps the shell available offline. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if ("serviceWorker" in navigator && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") { window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js").catch(function () {}); }); }`,
          }}
        />
      </body>
    </html>
  );
}
