import { Outlet } from "@remix-run/react"

const Component = () => (
  <div className="prose p-10">
    <Outlet />
  </div>
)

export default Component
