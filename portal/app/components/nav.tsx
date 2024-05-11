import { NavLink } from "@remix-run/react";
import { navLinkClass } from "~/containers/nav";

export const Nav = () => (
  <nav>
    <ul className="flex gap-16 text-lg font-semibold">
      <li>
        <NavLink to="/" className={navLinkClass}>
          home
        </NavLink>
      </li>
      <li>
        <NavLink to="/blog" className={navLinkClass}>
          blog
        </NavLink>
      </li>
      <li>
        <NavLink to="/about" className={navLinkClass}>
          about
        </NavLink>
      </li>
    </ul>
  </nav>
)