import { useEffect, useRef, useState } from 'react'

export default function useParallax() {
  const [parallax, setParallax] = useState({ x: 0, y: 0 })
  const targetRef = useRef({ x: 0, y: 0 })
  const lerpRef = useRef({ x: 0, y: 0 })
  const frameRef = useRef(null)

  useEffect(() => {
    const handleMouseMove = (event) => {
      const x = (event.clientX - window.innerWidth / 2) / (window.innerWidth / 2)
      const y = (event.clientY - window.innerHeight / 2) / (window.innerHeight / 2)

      targetRef.current.x = Math.max(-1, Math.min(1, x))
      targetRef.current.y = Math.max(-1, Math.min(1, y))
    }

    const tick = () => {
      lerpRef.current.x += (targetRef.current.x - lerpRef.current.x) * 0.07
      lerpRef.current.y += (targetRef.current.y - lerpRef.current.y) * 0.07

      setParallax({
        x: lerpRef.current.x,
        y: lerpRef.current.y,
      })

      frameRef.current = window.requestAnimationFrame(tick)
    }

    window.addEventListener('mousemove', handleMouseMove)
    frameRef.current = window.requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current)
      }
    }
  }, [])

  return parallax
}
