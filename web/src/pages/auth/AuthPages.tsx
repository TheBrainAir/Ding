import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { api } from '@/api/client'
import { keys } from '@/api/queries'
import type { ButtonState, MeResponse } from '@/api/types'
import { Wordmark } from '@/components/brand/BellMark'
import { VoiceOrb } from '@/components/orb/VoiceOrb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PRODUCT_NAME } from '@/config'

const DEMO: { state: ButtonState; text: string; lang: string; ms: number }[] = [
  { state: 'idle', text: 'Press the button and speak in your language', lang: 'en', ms: 2600 },
  { state: 'listening', text: '“¿Tenéis algo sin gluten?”', lang: 'es', ms: 2400 },
  { state: 'thinking', text: 'Checking the menu…', lang: 'en', ms: 1500 },
  { state: 'speaking', text: '“Sí: el risotto y la ensalada de burrata no llevan gluten.”', lang: 'es', ms: 3400 },
  { state: 'listening', text: '“Ի՞նչ աղանդեր ունեք։”', lang: 'hy', ms: 2400 },
  { state: 'thinking', text: 'Checking the menu…', lang: 'en', ms: 1500 },
  { state: 'speaking', text: '“Ունենք տիրամիսու և պիստակով պաղպաղակ։”', lang: 'hy', ms: 3400 },
]

function DemoOrb() {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const id = setTimeout(() => setStep((s) => (s + 1) % DEMO.length), DEMO[step].ms)
    return () => clearTimeout(id)
  }, [step])
  const current = DEMO[step]
  return (
    <div className="flex flex-col items-center" aria-hidden>
      <div className="pointer-events-none">
        <VoiceOrb state={current.state} onPressStart={() => {}} onPressEnd={() => {}} label="" disabled size="min(28vmin, 260px)" />
      </div>
      <p key={step} lang={current.lang} className="-mt-2 min-h-[3.5em] max-w-sm text-center text-lg text-linen/85 animate-in fade-in-0 duration-500">
        {current.text}
      </p>
    </div>
  )
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <aside
        className="relative hidden flex-col justify-between overflow-hidden p-10 text-linen lg:flex"
        style={{ background: 'radial-gradient(900px 700px at 50% 45%, #1f4a39 0%, var(--bistro-deep) 50%, var(--bistro-night) 100%)' }}
      >
        <Wordmark onDark />
        <DemoOrb />
        <p className="max-w-md font-display text-xl leading-snug font-medium">
          A voice waiter for every table. Guests press a button and talk in their own language. It always asks about allergies.
        </p>
      </aside>
      <main className="flex flex-col px-6 py-8 sm:px-12">
        <Wordmark className="lg:hidden" />
        <div className="m-auto w-full max-w-sm py-10">
          <h1 className="text-[1.75rem] font-semibold">{title}</h1>
          <p className="mt-1.5 text-ink-soft">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
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
    <p role="alert" className="rounded-xl bg-paprika-soft px-3 py-2 text-sm text-paprika-deep">
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
        <Button type="submit" size="lg" disabled={login.isPending} className="mt-2">
          {login.isPending && <Loader2 className="animate-spin" aria-hidden />}
          Log in
        </Button>
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
        <Button type="submit" size="lg" disabled={signup.isPending} className="mt-2">
          {signup.isPending && <Loader2 className="animate-spin" aria-hidden />}
          Create account
        </Button>
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
