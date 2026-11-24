import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: false,
    scrollRestoration: true,
    defaultErrorComponent: ({ error }) => (
      <div className="vp" style={{ minHeight: "100vh", padding: 32 }}>
        <div className="banner banner-danger" role="alert">
          <div>
            <b>Something went wrong.</b> {error instanceof Error ? error.message : String(error)}
          </div>
        </div>
      </div>
    ),
    defaultNotFoundComponent: () => (
      <div className="vp" style={{ minHeight: "100vh", padding: 32 }}>
        <h1 className="h1">Page not found</h1>
        <p className="lede">
          <a className="link" href="/">
            Back to sign in
          </a>
        </p>
      </div>
    ),
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
