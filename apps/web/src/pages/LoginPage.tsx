import { useState } from 'react'
import { Button } from '../components/Button'
import { setToken } from '../lib/api'

export function LoginPage() {
  const [token, setLocalToken] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setToken(token.trim())
    try {
      const response = await fetch('/api/settings', {
        headers: { Authorization: `Bearer ${token.trim()}` },
      })
      if (!response.ok) throw new Error('Invalid token')
      window.location.href = '/'
    } catch {
      setToken('')
      setError('Could not authenticate. Check APP_TOKEN.')
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <h1 className="text-3xl font-semibold tracking-tight">Vehicles</h1>
      <p className="mt-2 text-ink-muted">Enter your app token to continue.</p>
      <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
        <label className="block text-sm font-medium">
          App token
          <input
            autoComplete="off"
            className="mt-1 w-full rounded-md border border-line bg-panel px-3 py-2"
            onChange={e => setLocalToken(e.target.value)}
            type="password"
            value={token}
          />
        </label>
        {error ? <p className="text-sm text-overdue">{error}</p> : null}
        <Button type="submit">Unlock</Button>
      </form>
    </div>
  )
}
