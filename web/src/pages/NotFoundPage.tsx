import { Link } from 'react-router'
import { BellMark } from '@/components/brand/BellMark'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <div className="grid min-h-dvh place-content-center gap-4 px-6 text-center">
      <BellMark className="mx-auto size-12" />
      <h1 className="text-2xl">Nothing on this page</h1>
      <p className="text-ink-soft">The link may be old. Head back to the dashboard.</p>
      <Button asChild className="mx-auto">
        <Link to="/dashboard">Go to the dashboard</Link>
      </Button>
    </div>
  )
}
