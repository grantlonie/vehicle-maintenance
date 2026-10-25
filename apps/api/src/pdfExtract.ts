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
  const [page] = await rasterizePdfPages(bytes, 1)
  return page!
}

/** Rasterize up to `maxPages` pages (in order) for vision fallback on scanned PDFs. */
export async function rasterizePdfPages(
  bytes: Uint8Array,
  maxPages: number,
  scale = 2
): Promise<Array<{ base64: string; mediaType: string }>> {
  try {
    const pdf = await getDocumentProxy(bytes)
    const count = Math.min(pdf.numPages, maxPages)
    const pages = []
    for (let pageNumber = 1; pageNumber <= count; pageNumber++) {
      const image = await renderPageAsImage(pdf, pageNumber, {
        canvasImport: () => import('@napi-rs/canvas'),
        scale,
      })
      pages.push({ base64: Buffer.from(image).toString('base64'), mediaType: 'image/png' })
    }
    return pages
  } catch (err) {
    throw new PdfExtractError(
      `Could not render PDF page for OCR: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
