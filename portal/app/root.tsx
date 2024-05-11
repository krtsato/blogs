import { ReactNode } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";
import "./root.css";
import { Nav } from "~/components/nav";
import { Footer } from "~/components/footer";


const Layout = (props: { children: ReactNode }) => (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto w-full max-w-7xl border-b border-gray-100 p-10">
      <Nav />
      </header>
      <main className="mx-auto flex w-full max-w-7xl flex-1">
        {props.children}
      </main>
      <Footer />
    </div>
  );

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <Layout>
          <Outlet />
        </Layout>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
