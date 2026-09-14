import { Link } from 'react-router-dom'

// Shown inside the dashboard for an address that matches no section.
export default function NotFound() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">The address may be mistyped, or the page may have moved.</p>
      <Link to="/" className="mt-6 inline-block text-sm font-semibold text-accent-text hover:underline">
        Go to the overview
      </Link>
    </div>
  )
}
