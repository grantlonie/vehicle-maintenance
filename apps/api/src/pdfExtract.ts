import { extractText, getDocumentProxy, renderPageAsImage } from 'unpdf'

const MIN_TEXT_CHARS = 40

export class PdfExtractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfExtractError'
  }
}

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes)
  const result = await extractText(pdf, { mergePages: true })
  return (result.text ?? '').replace(/\s+/g, ' ').trim()
}

export function hasUsablePdfText(text: string): boolean {
  return text.length >= MIN_TEXT_CHARS
}

/** Rasterize the first page as a JPEG for vision fallback on scanned PDFs. */
export async function rasterizePdfFirstPage(bytes: Uint8Array): Promise<{
  base64: string
  mediaType: string
}> {
  try {
    const pdf = await getDocumentProxy(bytes)
    const image = await renderPageAsImage(pdf, 1, {
      canvasImport: () => import('@napi-rs/canvas'),
      scale: 2,
    })
    const buffer = Buffer.from(image)
    return {
      base64: buffer.toString('base64'),
      mediaType: 'image/png',
    }
  } catch (err) {
    throw new PdfExtractError(
      `Could not render PDF page for OCR: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
