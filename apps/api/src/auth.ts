import type { Context, Next } from 'hono'

export async function requireToken(c: Context, next: Next) {
  const expected = process.env.APP_TOKEN
  if (!expected) {
    return c.json({ error: 'APP_TOKEN is not configured' }, 500)
  }

  const header = c.req.header('authorization')
  const queryToken = c.req.query('token')
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null
  const token = bearer || c.req.header('x-app-token') || queryToken

  if (token !== expected) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await next()
}
