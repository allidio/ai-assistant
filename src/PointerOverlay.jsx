import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'

const POINTER_EVENT = 'ai-assistant:point'
const DISMISS_EVENT = 'ai-assistant:dismiss-pointer'
const AUTO_DISMISS_MS = 6000
const POLL_INTERVAL_MS = 100

/**
 * Dispatch a pointer event (called from the tool).
 * Fully decoupled — no React context or props needed.
 */
export function dispatchPointer(element, label) {
  window.dispatchEvent(
    new CustomEvent(POINTER_EVENT, { detail: { element, label } })
  )
}

export function dismissPointer() {
  window.dispatchEvent(new CustomEvent(DISMISS_EVENT))
}

function getVisibility(el) {
  const rect = el.getBoundingClientRect()
  const vh = window.innerHeight
  const vw = window.innerWidth

  const verticallyVisible = rect.bottom > 0 && rect.top < vh
  const horizontallyVisible = rect.right > 0 && rect.left < vw

  if (verticallyVisible && horizontallyVisible) {
    return { visible: true, rect }
  }

  let direction = null
  if (rect.bottom <= 0) direction = 'up'
  else if (rect.top >= vh) direction = 'down'
  else if (rect.right <= 0) direction = 'left'
  else if (rect.left >= vw) direction = 'right'

  return { visible: false, direction, rect }
}

export default function PointerOverlay() {
  const [target, setTarget] = useState(null) // { element, label }
  const [pos, setPos] = useState(null) // { visible, rect, direction }
  const [fading, setFading] = useState(false)
  const timerRef = useRef(null)
  const pollRef = useRef(null)

  const dismiss = useCallback(() => {
    setFading(true)
    setTimeout(() => {
      setTarget(null)
      setPos(null)
      setFading(false)
    }, 300)
    clearTimeout(timerRef.current)
    clearInterval(pollRef.current)
  }, [])

  const updatePos = useCallback((el) => {
    if (!el || !document.body.contains(el)) return
    setPos(getVisibility(el))
  }, [])

  useEffect(() => {
    function onPoint(e) {
      const { element, label } = e.detail
      if (!element) return
      // Reset
      setFading(false)
      clearTimeout(timerRef.current)
      clearInterval(pollRef.current)

      setTarget({ element, label })
      updatePos(element)

      // Poll position (handles scroll, resize, layout shifts)
      pollRef.current = setInterval(() => updatePos(element), POLL_INTERVAL_MS)

      // Auto-dismiss
      timerRef.current = setTimeout(dismiss, AUTO_DISMISS_MS)
    }

    function onDismiss() {
      dismiss()
    }

    window.addEventListener(POINTER_EVENT, onPoint)
    window.addEventListener(DISMISS_EVENT, onDismiss)
    return () => {
      window.removeEventListener(POINTER_EVENT, onPoint)
      window.removeEventListener(DISMISS_EVENT, onDismiss)
      clearTimeout(timerRef.current)
      clearInterval(pollRef.current)
    }
  }, [dismiss, updatePos])

  if (!target || !pos) return null

  return createPortal(
    <>
      <style>{POINTER_STYLES}</style>
      {pos.visible ? (
        <OnScreenPointer rect={pos.rect} label={target.label} fading={fading} onDismiss={dismiss} />
      ) : (
        <OffScreenArrow direction={pos.direction} label={target.label} fading={fading} onDismiss={dismiss} />
      )}
    </>,
    document.body
  )
}

function OnScreenPointer({ rect, label, fading, onDismiss }) {
  const top = rect.top - 8
  const left = rect.left - 8
  const width = rect.width + 16
  const height = rect.height + 16

  return (
    <div className={`aip-overlay ${fading ? 'aip-fade-out' : 'aip-fade-in'}`} onClick={onDismiss}>
      {/* Highlight box */}
      <div
        className="aip-highlight"
        style={{ top, left, width, height }}
      />
      {/* Pulse ring */}
      <div
        className="aip-pulse"
        style={{
          top: rect.top + rect.height / 2,
          left: rect.left + rect.width / 2,
        }}
      />
      {/* Label */}
      {label && (
        <div
          className="aip-label"
          style={{
            top: top - 32,
            left: left + width / 2,
          }}
        >
          {label}
        </div>
      )}
    </div>
  )
}

function OffScreenArrow({ direction, label, fading, onDismiss }) {
  const posStyle = {}
  let arrow = ''

  switch (direction) {
    case 'up':
      posStyle.top = '16px'
      posStyle.left = '50%'
      posStyle.transform = 'translateX(-50%)'
      arrow = '\u2191'
      break
    case 'down':
      posStyle.bottom = '16px'
      posStyle.left = '50%'
      posStyle.transform = 'translateX(-50%)'
      arrow = '\u2193'
      break
    case 'left':
      posStyle.left = '16px'
      posStyle.top = '50%'
      posStyle.transform = 'translateY(-50%)'
      arrow = '\u2190'
      break
    case 'right':
      posStyle.right = '16px'
      posStyle.top = '50%'
      posStyle.transform = 'translateY(-50%)'
      arrow = '\u2192'
      break
    default:
      posStyle.top = '16px'
      posStyle.left = '50%'
      posStyle.transform = 'translateX(-50%)'
      arrow = '\u2191'
  }

  return (
    <div className={`aip-offscreen ${fading ? 'aip-fade-out' : 'aip-fade-in'}`} onClick={onDismiss}>
      <div className="aip-arrow-badge" style={posStyle}>
        <span className="aip-arrow-icon">{arrow}</span>
        {label && <span className="aip-arrow-label">{label}</span>}
        <span className="aip-arrow-hint">Scroll {direction} to see element</span>
      </div>
    </div>
  )
}

const POINTER_STYLES = `
  .aip-overlay {
    position: fixed;
    inset: 0;
    z-index: 99997;
    pointer-events: auto;
    cursor: pointer;
  }

  .aip-fade-in {
    animation: aip-in 0.3s ease forwards;
  }
  .aip-fade-out {
    animation: aip-out 0.3s ease forwards;
  }

  @keyframes aip-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes aip-out {
    from { opacity: 1; }
    to { opacity: 0; }
  }

  .aip-highlight {
    position: fixed;
    border: 2px solid #6366f1;
    border-radius: 8px;
    box-shadow: 0 0 0 4000px rgba(0, 0, 0, 0.45), 0 0 20px 4px rgba(99, 102, 241, 0.4);
    pointer-events: none;
    transition: all 0.15s ease;
  }

  .aip-pulse {
    position: fixed;
    width: 20px;
    height: 20px;
    margin-left: -10px;
    margin-top: -10px;
    border-radius: 50%;
    border: 2px solid #6366f1;
    pointer-events: none;
    animation: aip-pulse-ring 1.5s ease-out infinite;
  }

  @keyframes aip-pulse-ring {
    0% { transform: scale(1); opacity: 1; }
    100% { transform: scale(3.5); opacity: 0; }
  }

  .aip-label {
    position: fixed;
    transform: translateX(-50%);
    background: #6366f1;
    color: #fff;
    font-size: 0.78rem;
    font-weight: 600;
    font-family: 'Inter', system-ui, sans-serif;
    padding: 4px 12px;
    border-radius: 6px;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  /* Off-screen arrow */
  .aip-offscreen {
    position: fixed;
    inset: 0;
    z-index: 99997;
    pointer-events: auto;
    cursor: pointer;
  }

  .aip-arrow-badge {
    position: fixed;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    background: #1a1a2e;
    border: 2px solid #6366f1;
    border-radius: 12px;
    padding: 12px 20px;
    box-shadow: 0 4px 24px rgba(99, 102, 241, 0.35);
    pointer-events: none;
    font-family: 'Inter', system-ui, sans-serif;
  }

  .aip-arrow-icon {
    font-size: 1.5rem;
    color: #818cf8;
    animation: aip-bounce-arrow 1s ease-in-out infinite;
  }

  .aip-arrow-label {
    color: #e4e4e7;
    font-size: 0.82rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .aip-arrow-hint {
    color: #71717a;
    font-size: 0.7rem;
    white-space: nowrap;
  }

  @keyframes aip-bounce-arrow {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-6px); }
  }
`
