const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1'
const DEFAULT_MODEL = 'accounts/fireworks/models/qwen3p7-plus'

export class LlmError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmError'
  }
}

export function fireworksApiKey(): string {
  return process.env.FIREWORKS_API_KEY?.trim() ?? ''
}

export function receiptOcrModel(): string {
  return process.env.RECEIPT_OCR_MODEL?.trim() || DEFAULT_MODEL
}

export async function completeJson(options: {
  image?: { base64: string; mediaType: string }
  maxTokens?: number
  systemPrompt: string
  userMessage: string
}): Promise<string> {
  const apiKey = fireworksApiKey()
  if (!apiKey) {
    throw new LlmError('FIREWORKS_API_KEY is not configured')
  }

  const model = receiptOcrModel()
  const userContent: string | Array<Record<string, unknown>> = options.image
    ? [
        { text: options.userMessage, type: 'text' },
        {
          image_url: {
            url: `data:${options.image.mediaType};base64,${options.image.base64}`,
          },
          type: 'image_url',
        },
      ]
    : options.userMessage

  const body: Record<string, unknown> = {
    max_tokens: options.maxTokens ?? 1024,
    messages: [
      { content: options.systemPrompt, role: 'system' },
      { content: userContent, role: 'user' },
    ],
    model,
    temperature: 0.1,
    user: `vehicles-receipt-ocr-${crypto.randomUUID()}`,
  }

  const extraBody = reasoningExtraBody(model)
  if (extraBody) Object.assign(body, extraBody)

  const response = await fetch(`${FIREWORKS_BASE_URL}/chat/completions`, {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText)
    if (response.status === 404) {
      throw new LlmError(
        `Fireworks model not found: ${model}. Check RECEIPT_OCR_MODEL in your environment.`
      )
    }
    throw new LlmError(`Fireworks request failed (${response.status}): ${detail}`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string | null; reasoning_content?: string | null }
    }>
  }
  const message = payload.choices?.[0]?.message
  let content = (message?.content ?? '').trim()
  if (!content) {
    content = stripThinkBlocks(message?.reasoning_content ?? '').trim()
  }
  if (!content) {
    throw new LlmError('Model returned empty content')
  }
  return content
}

function reasoningExtraBody(model: string): Record<string, unknown> | null {
  const modelId = model.toLowerCase()
  if (modelId.includes('deepseek') || modelId.includes('qwen3')) {
    return { thinking: { type: 'disabled' } }
  }
  return null
}

export function stripThinkBlocks(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}

export function extractJsonObject(content: string): string {
  let cleaned = stripThinkBlocks(content)
  cleaned = cleaned.replace(/<\/?result>/gi, '').trim()
  const fenced = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/i)
  if (fenced?.[1]) cleaned = fenced[1].trim()
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) {
    throw new LlmError('Model response did not contain JSON')
  }
  return match[0]
}
