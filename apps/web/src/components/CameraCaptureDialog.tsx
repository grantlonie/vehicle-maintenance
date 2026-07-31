import { useEffect, useRef, useState } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'

/** Preview frame aspect; capture crops to match `object-cover` in this box. */
const PREVIEW_ASPECT = 4 / 3

interface CameraCaptureDialogProps {
  onCapture: (file: File) => void
  onClose: () => void
  open: boolean
  title?: string
}

export function isCameraCaptureSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
}

export function CameraCaptureDialog({
  onCapture,
  onClose,
  open,
  title = 'Take photo',
}: CameraCaptureDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!open) {
      stopStream()
      setError(null)
      setReady(false)
      return
    }

    let cancelled = false

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera is not supported in this browser.')
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            height: { ideal: 1440 },
            width: { ideal: 1920 },
          },
        })
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop())
          return
        }

        streamRef.current = stream
        const video = videoRef.current
        if (!video) return

        video.srcObject = stream
        await video.play()
        setReady(true)
        setError(null)
      } catch {
        if (!cancelled) {
          setError('Could not access the camera. Check permissions or choose a file instead.')
        }
      }
    }

    void startCamera()

    return () => {
      cancelled = true
      stopStream()
    }
  }, [open])

  function stopStream() {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }

  function handleClose() {
    stopStream()
    onClose()
  }

  function handleCapture() {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return

    const { height: sh, width: sw, x: sx, y: sy } = coverCropRect(
      video.videoWidth,
      video.videoHeight,
      PREVIEW_ASPECT
    )
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(sw)
    canvas.height = Math.round(sh)
    const context = canvas.getContext('2d')
    if (!context) return

    context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      blob => {
        if (!blob) {
          setError('Could not capture photo.')
          return
        }
        const file = new File([blob], `receipt-${Date.now()}.jpg`, { type: 'image/jpeg' })
        stopStream()
        onCapture(file)
      },
      'image/jpeg',
      0.92
    )
  }

  return (
    <Dialog
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={handleClose} variant="text">
            Cancel
          </Button>
          <Button disabled={!ready || Boolean(error)} onClick={handleCapture}>
            Capture photo
          </Button>
        </div>
      }
      onClose={handleClose}
      open={open}
      size="sm"
      title={title}
    >
      <p className="text-sm text-ink-muted">
        Position the receipt in view, then capture the photo.
      </p>

      <div className="mt-4 overflow-hidden rounded-lg bg-ink">
        {error ? (
          <div className="flex aspect-[4/3] items-center justify-center px-6 text-center text-sm text-white/80">
            {error}
          </div>
        ) : (
          <video
            autoPlay
            className="aspect-[4/3] w-full object-cover"
            muted
            playsInline
            ref={videoRef}
          />
        )}
      </div>
    </Dialog>
  )
}

/** Source rect for CSS `object-cover` into a box with the given aspect ratio. */
function coverCropRect(
  sourceWidth: number,
  sourceHeight: number,
  targetAspect: number
): { height: number; width: number; x: number; y: number } {
  const sourceAspect = sourceWidth / sourceHeight
  if (sourceAspect > targetAspect) {
    const width = sourceHeight * targetAspect
    return {
      height: sourceHeight,
      width,
      x: (sourceWidth - width) / 2,
      y: 0,
    }
  }
  const height = sourceWidth / targetAspect
  return {
    height,
    width: sourceWidth,
    x: 0,
    y: (sourceHeight - height) / 2,
  }
}
