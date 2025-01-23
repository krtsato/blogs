import { NavLink } from "@remix-run/react"
import { navLinkClass } from "~/containers/nav"

export const Nav = () => (
  <nav>
    <ul className="flex gap-16 text-lg font-semibold">
      <li>
        <NavLink to="/" className={navLinkClass}>
          Home
        </NavLink>
      </li>
      <li>
        <NavLink to="/tech" className={navLinkClass}>
          Tech
        </NavLink>
      </li>
      <li>
        <NavLink to="/music" className={navLinkClass}>
          Music
        </NavLink>
      </li>
      <li>
        <NavLink to="/about" className={navLinkClass}>
          About
        </NavLink>
      </li>
    </ul>
  </nav>
)