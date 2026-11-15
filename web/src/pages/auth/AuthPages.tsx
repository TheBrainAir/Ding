import { lazy, Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { api } from '@/api/client'
import { keys } from '@/api/queries'
import type { ButtonState, MeResponse } from '@/api/types'
import { Wordmark } from '@/components/brand/BellMark'
import { VoiceOrb } from '@/components/orb/VoiceOrb'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import RotatingText from '@/components/reactbits/RotatingText'
import StarBorder from '@/components/reactbits/StarBorder'
import { PRODUCT_NAME } from '@/config'
import { useShadcnTheme } from '@/hooks/use-shadcn-theme'

const DEMO: { state: ButtonState; ms: number }[] = [
  { state: 'idle', ms: 2600 },
  { state: 'listening', ms: 2200 },
  { state: 'thinking', ms: 1400 },
  { state: 'speaking', ms: 3000 },
]

/** Languages the waiter answers in, for the rotating line. */
const LANGUAGES = ['Spanish', 'Armenian', 'Japanese', 'Arabic', 'Russian', 'Hindi', 'French', 'Korean', 'Portuguese']

const Threads = lazy(() => import('@/components/reactbits/Threads'))

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function DemoOrb() {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const id = setTimeout(() => setStep((s) => (s + 1) % DEMO.length), DEMO[step].ms)
    return () => clearTimeout(id)
  }, [step])
  return (
    <div className="pointer-events-none flex justify-center" aria-hidden>
      <VoiceOrb state={DEMO[step].state} onPressStart={() => {}} onPressEnd={() => {}} label="" disabled size="min(26vmin, 240px)" />
    </div>
  )
}

function SpeaksLine({ className }: { className?: string }) {
  return (
    <p className={className}>
      <span className="sr-only">{PRODUCT_NAME} speaks your guests’ languages, for example {LANGUAGES.slice(0, 4).join(', ')}.</span>
      <span aria-hidden className="inline-flex flex-wrap items-baseline gap-x-2">
        {PRODUCT_NAME} speaks
        <RotatingText
          texts={LANGUAGES}
          rotationInterval={2200}
          staggerDuration={0.02}
          mainClassName="inline-flex overflow-hidden rounded-md bg-white px-2 py-0.5 text-zinc-900"
          splitLevelClassName="overflow-hidden"
          transition={{ type: 'spring', damping: 30, stiffness: 400 }}
        />
      </span>
    </p>
  )
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  useShadcnTheme()
  const [still] = useState(prefersReducedMotion)
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <aside
        className="relative isolate hidden flex-col justify-between overflow-hidden bg-zinc-900 p-10 text-white lg:flex"
      >
        <div className="absolute inset-0 -z-10 opacity-60" aria-hidden>
          <Suspense fallback={null}>
            <Threads color="#a1a1aa" accentColor="#e4e4e7" amplitude={1.1} distance={0.3} lineCount={36} thickness={0.5} speed={0.25} opacity={0.55} paused={still} />
          </Suspense>
        </div>
        <Wordmark onDark />
        <DemoOrb />
        <div className="grid gap-4">
          <SpeaksLine className="text-2xl leading-snug font-semibold tracking-tight" />
          <p className="max-w-md text-lg text-zinc-300">
            A voice waiter for every table. Guests press a button and talk in their own language. It always asks about allergies.
          </p>
        </div>
      </aside>
      <main className="flex flex-col px-6 py-8 sm:px-12">
        <div className="lg:hidden">
          <Wordmark />
          <SpeaksLine className="mt-3 text-lg font-semibold tracking-tight" />
        </div>
        <div className="m-auto w-full max-w-sm py-10">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-ink-soft">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  )
}

/** The page's one primary action, with a slow saffron star running round its border. */
function PrimarySubmit({ pending, children }: { pending: boolean; children: ReactNode }) {
  return (
    <StarBorder
      as="button"
      type="submit"
      disabled={pending}
      className="mt-2 h-9 w-full py-0 text-sm font-medium"
      color="#a1a1aa"
      trailColor="#e4e4e7"
      backgroundColor="#171717"
      textColor="#fafafa"
      borderColor="rgba(0, 0, 0, 0.12)"
      radius={8}
      thickness={2}
      duration={5}
    >
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </StarBorder>
  )
}

function useAuthSuccess() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  return (res: MeResponse) => {
    qc.clear()
    qc.setQueryData(keys.me, res)
    const next = params.get('next')
    navigate(next && next.startsWith('/dashboard') ? next : '/dashboard', { replace: true })
  }
}

function FormError({ error }: { error: Error | null }) {
  if (!error) return null
  return (
    <p role="alert" className="rounded-xl border border-input bg-linen-deep px-3 py-2 text-sm text-ink">
      {error.message}
    </p>
  )
}

export function LoginPage() {
  const onSuccess = useAuthSuccess()
  const login = useMutation({ mutationFn: api.login, onSuccess })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    login.mutate({ email: email.trim(), password })
  }

  return (
    <AuthShell title="Log in" subtitle={`Manage your menu, tables and orders in ${PRODUCT_NAME}.`}>
      <form onSubmit={submit} className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <FormError error={login.error} />
        <PrimarySubmit pending={login.isPending}>Log in</PrimarySubmit>
        <p className="text-sm text-ink-soft">
          New here?{' '}
          <Link to="/signup" className="font-semibold text-ink underline underline-offset-4">
            Create an account
          </Link>
        </p>
      </form>
    </AuthShell>
  )
}

export function SignupPage() {
  const onSuccess = useAuthSuccess()
  const signup = useMutation({ mutationFn: api.signup, onSuccess })
  const [restaurant, setRestaurant] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    signup.mutate({ email: email.trim(), password, restaurant_name: restaurant.trim() })
  }

  return (
    <AuthShell title="Create your restaurant" subtitle="Add your menu next, then put a button on each table.">
      <form onSubmit={submit} className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="restaurant">Restaurant name</Label>
          <Input id="restaurant" required value={restaurant} onChange={(e) => setRestaurant(e.target.value)} placeholder="Bistro Lumière" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-xs text-ink-soft">At least 8 characters.</p>
        </div>
        <FormError error={signup.error} />
        <PrimarySubmit pending={signup.isPending}>Create account</PrimarySubmit>
        <p className="text-sm text-ink-soft">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-ink underline underline-offset-4">
            Log in
          </Link>
        </p>
      </form>
    </AuthShell>
  )
}
