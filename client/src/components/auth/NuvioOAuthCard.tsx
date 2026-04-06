'use client'

import React, { useCallback, useEffect, useState, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { nuvioAPI } from '@/services/api'

interface NuvioOAuthCardProps {
  active?: boolean
  autoStart?: boolean
  onAuth: (data: { email: string; providerUserId: string; refreshToken: string }) => Promise<void> | void
  disabled?: boolean
  className?: string
  withContainer?: boolean
  startButtonLabel?: string
  authorizeLabel?: string
  buttonClassName?: string
  buttonStyle?: React.CSSProperties
}

export function NuvioOAuthCard({
  active = true,
  autoStart = true,
  onAuth,
  disabled = false,
  className = '',
  withContainer = true,
  startButtonLabel = 'Sign in with Nuvio',
  authorizeLabel = 'Authorize Syncio',
  buttonClassName,
  buttonStyle,
}: NuvioOAuthCardProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [isPolling, setIsPolling] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)
  const [webUrl, setWebUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [error, setError] = useState('')

  // Session data needed for polling/exchange
  const sessionRef = useRef<{ code: string; deviceNonce: string; anonToken: string } | null>(null)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const hasCompletedRef = useRef(false)
  const isMountedRef = useRef(true)
  const onAuthRef = useRef(onAuth)
  const retryCountRef = useRef(0)
  const MAX_RETRIES = 3

  useEffect(() => { onAuthRef.current = onAuth }, [onAuth])

  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  const resetFlow = useCallback(() => {
    setIsCreating(false)
    setIsPolling(false)
    setIsCompleting(false)
    setWebUrl(null)
    setExpiresAt(null)
    setError('')
    sessionRef.current = null
    hasCompletedRef.current = false
    retryCountRef.current = 0
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }, [])

  const startFlow = useCallback(async () => {
    if (disabled || isCreating) return
    resetFlow()
    setIsCreating(true)
    setError('')

    try {
      const result = await nuvioAPI.startOAuth()
      setWebUrl(result.webUrl)
      setExpiresAt(new Date(result.expiresAt).getTime())
      sessionRef.current = {
        code: result.code,
        deviceNonce: result.deviceNonce,
        anonToken: result.anonToken,
      }
      setIsCreating(false)
      setIsPolling(true)
    } catch (err: any) {
      if (err?.response?.status === 429) {
        setError('Too many requests. Please wait a moment and try again.')
      } else {
        setError(err?.response?.data?.error || err?.message || 'Failed to start Nuvio login')
      }
      setIsCreating(false)
    }
  }, [disabled, isCreating, resetFlow])

  // Auto-start on mount (intentionally runs once when active+autoStart)
  const hasAutoStarted = useRef(false)
  useEffect(() => {
    if (active && autoStart && !hasAutoStarted.current) {
      hasAutoStarted.current = true
      startFlow()
    }
  }, [active, autoStart, startFlow])

  // Polling effect
  useEffect(() => {
    if (!isPolling || !sessionRef.current || hasCompletedRef.current) return

    const poll = async () => {
      if (!sessionRef.current || hasCompletedRef.current) return
      try {
        const result = await nuvioAPI.pollOAuth(sessionRef.current)
        if (result.status === 'approved' && !hasCompletedRef.current) {
          hasCompletedRef.current = true
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current)
            pollIntervalRef.current = null
          }
          setIsPolling(false)
          setIsCompleting(true)

          try {
            // Exchange for tokens
            const session = sessionRef.current
            if (!session) return
            const exchange = await nuvioAPI.exchangeOAuth(session)
            if (!isMountedRef.current) return
            if (exchange.success && exchange.user) {
              await onAuthRef.current({
                email: exchange.user.email,
                providerUserId: exchange.user.id,
                refreshToken: exchange.refreshToken,
              })
            } else {
              setError('Failed to complete Nuvio authentication')
            }
          } catch (err: any) {
            if (isMountedRef.current) {
              setError(err?.message || 'Failed to complete Nuvio authentication')
            }
          } finally {
            if (isMountedRef.current) {
              setIsCompleting(false)
            }
          }
        }
      } catch (err: any) {
        // Polling errors are usually transient, don't stop
      }
    }

    pollIntervalRef.current = setInterval(poll, 3000)
    poll() // immediate first poll

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [isPolling])

  // Check expiry and silently restart
  useEffect(() => {
    if (!expiresAt || !isPolling) return
    const check = setInterval(() => {
      if (Date.now() > expiresAt) {
        if (retryCountRef.current < MAX_RETRIES) {
          retryCountRef.current += 1
          resetFlow()
          startFlow()
        } else {
          resetFlow()
          setError('Session expired. Please try again.')
        }
      }
    }, 3000)
    return () => clearInterval(check)
  }, [expiresAt, isPolling, resetFlow, startFlow])

  const content = (
    <div className={`space-y-4 ${className}`}>
      {error && (
        <p className="text-sm text-red-500 text-center">{error}</p>
      )}

      {/* Start button */}
      {!webUrl && !isCreating && !isPolling && (
        <button
          type="button"
          onClick={startFlow}
          disabled={disabled}
          className={buttonClassName || "w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"}
          style={buttonStyle}
        >
          {startButtonLabel}
        </button>
      )}

      {/* Loading state */}
      {isCreating && (
        <button
          type="button"
          disabled
          className="w-full py-2 px-4 bg-blue-600 text-white rounded-md font-medium opacity-50 cursor-not-allowed flex items-center justify-center gap-2"
        >
          <Loader2 className="w-4 h-4 animate-spin" />
          Generating link...
        </button>
      )}

      {/* OAuth active — show link */}
      {webUrl && (
        <>
          {isCompleting ? (
            <button
              type="button"
              disabled
              className="w-full py-2 px-4 bg-blue-600 text-white rounded-md font-medium opacity-50 cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              Completing...
            </button>
          ) : (
            <a
              href={webUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium transition-colors flex items-center justify-center gap-2 no-underline"
            >
              {authorizeLabel}
            </a>
          )}

        </>
      )}

    </div>
  )

  if (!withContainer) return content

  return (
    <div className="p-4 border rounded-lg color-surface" style={{ borderColor: 'var(--color-border)' }}>
      {content}
    </div>
  )
}
