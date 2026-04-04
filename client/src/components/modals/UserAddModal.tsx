import React, { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { getEntityColorStyles } from '@/utils/colorMapping'
import { ColorPicker } from '@/components/layout'
import { StremioOAuthCard } from '@/components/auth/StremioOAuthCard'
import { NuvioLoginCard } from '@/components/auth/NuvioLoginCard'
import { NuvioOAuthCard } from '@/components/auth/NuvioOAuthCard'
import { usersAPI } from '@/services/api'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'

interface UserAddModalProps {
  isOpen: boolean
  onClose: () => void
  onAddUser: (userData: Record<string, any>) => void
  isCreating: boolean
  groups?: any[]
  // For editing existing users
  editingUser?: {
    id: string
    username: string
    email: string
    groupId?: string
    colorIndex: number
    providerType?: string
  }
}

export default function UserAddModal({ 
  isOpen, 
  onClose, 
  onAddUser, 
  isCreating,
  groups = [],
  editingUser
}: UserAddModalProps) {
  const { theme } = useTheme()
  const logoRef = useRef<HTMLDivElement>(null)
  
  useBodyScrollLock(isOpen)
  
  // --- UI state ---
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [colorIndex, setColorIndex] = useState(0)

  // --- Provider & auth mode ---
  const [providerType, setProviderType] = useState<'stremio' | 'nuvio'>('stremio')
  const [authMode, setAuthMode] = useState<'oauth' | 'credentials'>('oauth')

  // --- Provider-agnostic identity ---
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [usernameManuallyEdited, setUsernameManuallyEdited] = useState(false)

  // --- Auth credentials (shared across providers) ---
  const [password, setPassword] = useState('')
  const [authToken, setAuthToken] = useState('')         // Stremio auth key (credentials mode)
  const [oauthToken, setOauthToken] = useState<string | null>(null) // OAuth-provided token
  const [isAuthVerified, setIsAuthVerified] = useState(false)
  const [isVerifyingAuth, setIsVerifyingAuth] = useState(false)
  const [providerUserId, setProviderUserId] = useState('')  // Nuvio user ID from OAuth
  const [refreshToken, setRefreshToken] = useState('')      // Nuvio refresh token from OAuth

  // --- Group & options ---
  const [selectedGroup, setSelectedGroup] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [isCreatingNewGroup, setIsCreatingNewGroup] = useState(false)
  const [registerNew, setRegisterNew] = useState(false)  // Stremio register toggle
  const colorStyles = useMemo(
    () => getEntityColorStyles(theme, colorIndex),
    [theme, colorIndex]
  )

  useEffect(() => {
    setMounted(true)
  }, [])

  // Populate form when editing a user
  useEffect(() => {
    if (editingUser) {
      setUsername(editingUser.username || '')
      setEmail(editingUser.email || '')
      setSelectedGroup(editingUser.groupId || '')
      setColorIndex(editingUser.colorIndex || 0)
      setProviderType((editingUser.providerType as 'stremio' | 'nuvio') || 'stremio')
      setAuthMode(editingUser.providerType === 'nuvio' ? 'oauth' : 'credentials')
      setRegisterNew(false)
      setIsCreatingNewGroup(false)
      setOauthToken(null)
      setIsAuthVerified(false)
      setUsernameManuallyEdited(false)
    } else {
      setEmail('')
      setPassword('')
      setAuthToken('')
      setUsername('')
      setAuthMode('oauth')
      setSelectedGroup('')
      setNewGroupName('')
      setRegisterNew(false)
      setProviderType('stremio')
      setProviderUserId('')
      setRefreshToken('')
      setColorIndex(0)
      setIsCreatingNewGroup(false)
      setOauthToken(null)
      setIsAuthVerified(false)
      setUsernameManuallyEdited(false)
    }
  }, [editingUser])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        handleClose()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true } as any)
  }, [isOpen])

  // Reset form fields whenever the modal is opened, to avoid stale values on reopen
  // But only if we're not editing a user (editingUser is null)
  useEffect(() => {
    if (isOpen && !editingUser) {
      setEmail('')
      setPassword('')
      setAuthToken('')
      setUsername('')
      setSelectedGroup('')
      setNewGroupName('')
      setRegisterNew(false)
      setAuthMode('oauth')
      setIsCreatingNewGroup(false)
      setOauthToken(null)
      setIsAuthVerified(false)
      setUsernameManuallyEdited(false)
      setProviderType('stremio')
      setProviderUserId('')
      setRefreshToken('')
    }
  }, [isOpen, editingUser])

  // Stremio OAuth callback — verify authKey and extract user info
  const handleStremioOAuth = async (authKey: string) => {
    try {
      setIsVerifyingAuth(true)
      setOauthToken(authKey)
      const verification = await usersAPI.verifyAuthKey({ authKey })
      if (verification?.user) {
        const verifiedEmail = verification.user.email || ''
        const verifiedName = verification.user.username || verifiedEmail.split('@')[0] || ''
        if (!usernameManuallyEdited) {
          setUsername(verifiedName.charAt(0).toUpperCase() + verifiedName.slice(1))
        }
        setEmail(verifiedEmail)
        setIsAuthVerified(true)
      }
    } catch (error: any) {
      console.error('OAuth verification error:', error)
      setOauthToken(null)
      setIsAuthVerified(false)
    } finally {
      setIsVerifyingAuth(false)
    }
  }

  // Nuvio OAuth/credentials callback — store auth data
  const handleNuvioAuth = (data: { email: string; providerUserId: string; password?: string; refreshToken?: string }) => {
    setEmail(data.email)
    setProviderUserId(data.providerUserId)
    if (data.password) setPassword(data.password)
    if (data.refreshToken) setRefreshToken(data.refreshToken)
    if (!usernameManuallyEdited) {
      const capitalized = data.email.split('@')[0].charAt(0).toUpperCase() + data.email.split('@')[0].slice(1)
      setUsername(capitalized)
    }
    setIsAuthVerified(true)
  }

  // Resolve group name from selection state
  const resolveGroupName = () => {
    const selectedGroupName = selectedGroup ? (groups.find((g: any) => g.id === selectedGroup)?.name || undefined) : undefined
    return (newGroupName.trim() || selectedGroupName) || undefined
  }

  // Compute disabled state for submit button
  const isSubmitDisabled = isCreating || isVerifyingAuth || !username.trim()
    || (providerType === 'stremio' && authMode === 'oauth' && (!oauthToken || !isAuthVerified))
    || (providerType === 'stremio' && authMode === 'credentials' && !authToken.trim() && (!email.trim() || !password.trim()))
    || (providerType === 'nuvio' && authMode === 'oauth' && !providerUserId)
    || (providerType === 'nuvio' && authMode === 'credentials' && !providerUserId)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!username.trim()) return

    // Shared base data
    const submitData: any = {
      username: username.trim(),
      email: email.trim(),
      groupName: resolveGroupName(),
      colorIndex,
      providerType,
    }

    // Provider-specific fields
    if (providerType === 'nuvio') {
      if (authMode === 'oauth' && !providerUserId) return
      if (authMode === 'credentials' && (!email.trim() || !password.trim())) return
      submitData.providerUserId = providerUserId || undefined
      submitData.email = email.trim()
      submitData.password = authMode === 'credentials' ? password.trim() : undefined
      submitData.refreshToken = authMode === 'oauth' ? refreshToken : undefined
    } else {
      // Stremio
      if (authMode === 'oauth') {
        if (!oauthToken) return
        submitData.authKey = oauthToken
      } else {
        // Credentials: auth key OR email+password
        const hasKey = authToken.trim().length > 0
        const hasCreds = email.trim().length > 0 && password.trim().length > 0
        if (!hasKey && !hasCreds) return
        if (hasKey) {
          submitData.authKey = authToken.trim()
          submitData.email = email.trim() || username.trim() + '@stremio.local'
        } else {
          submitData.password = password.trim()
        }
      }
    }

    if (registerNew && providerType === 'stremio') {
      submitData.registerIfMissing = true
    }

    try {
      ;(onAddUser as any)(submitData)
    } catch (error) {
      console.error('Error calling onAddUser:', error)
    }
  }

  const handleClose = () => {
    setEmail('')
    setPassword('')
    setAuthToken('')
    setUsername('')
    setSelectedGroup('')
    setNewGroupName('')
    setRegisterNew(false)
    setIsCreatingNewGroup(false)
    setOauthToken(null)
    setIsAuthVerified(false)
    setUsernameManuallyEdited(false)
    setProviderType('stremio')
    setProviderUserId('')
    setRefreshToken('')
    onClose()
  }

  if (!isOpen) return null

  if (!mounted || typeof window === 'undefined' || !document.body) {
    return null
  }

  return createPortal(
    <div 
      className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-[1000]"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose()
        }
      }}
    >
      <div 
        className={`w-full max-w-md rounded-lg shadow-lg card`}
        style={{ background: 'var(--color-background)' }}
      >
        <div className="flex items-center justify-between p-6 border-b color-border">
          <div className="flex items-center gap-4 relative">
            <div
              ref={logoRef}
              onClick={() => setShowColorPicker((prev) => !prev)}
              className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 cursor-pointer transition-all hover:scale-105"
              style={{
                background: colorStyles.background,
                color: colorStyles.textColor,
              }}
              title="Click to change color"
            >
              <span className="font-semibold text-lg" style={{ color: colorStyles.textColor }}>
                {(username || 'User').charAt(0).toUpperCase()}
              </span>
            </div>
            <ColorPicker
              currentColorIndex={colorIndex}
              onColorChange={(next) => {
                setColorIndex(next)
                setShowColorPicker(false)
              }}
              isOpen={showColorPicker}
              onClose={() => setShowColorPicker(false)}
              triggerRef={logoRef as React.RefObject<HTMLElement>}
            />
            <div className="flex flex-col">
              <label className="sr-only" htmlFor="username-input">
                Username
              </label>
              <input
                id="username-input"
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value)
                  setUsernameManuallyEdited(true)
                }}
                placeholder="Username *"
                required
                readOnly={!!editingUser}
                className={`text-lg font-semibold bg-transparent border-none focus:outline-none focus:ring-0 p-0 m-0 ${
                  editingUser ? 'cursor-not-allowed opacity-80 color-text-secondary' : 'color-text'
                }`}
              />
              <span className="text-sm color-text-secondary">
                {providerType === 'nuvio'
                  ? (email.trim() || (authMode === 'oauth' ? 'Authenticate with Nuvio OAuth' : 'Provide credentials below'))
                  : authMode === 'oauth'
                  ? (isAuthVerified ? (email.trim() || 'user') : (email.trim() || 'Authenticate with Stremio OAuth'))
                  : authMode === 'credentials'
                  ? (email.trim() || 'Provide credentials below')
                  : 'Authenticate with an Auth Key'}
              </span>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded transition-colors border-0 focus:outline-none ring-0 focus:ring-0 color-text-secondary color-hover"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Provider type toggle */}
          <div className="w-full">
            <div className="grid grid-cols-2 gap-2 w-full">
              <button
                type="button"
                onClick={() => setProviderType('stremio')}
                className={`w-full py-2 px-4 rounded-lg cursor-pointer card card-selectable color-hover hover:shadow-lg transition-all ${
                  providerType === 'stremio' ? 'card-selected' : ''
                }`}
              >
                <span className="text-sm font-medium">Stremio</span>
              </button>
              <button
                type="button"
                onClick={() => setProviderType('nuvio')}
                className={`w-full py-2 px-4 rounded-lg cursor-pointer card card-selectable color-hover hover:shadow-lg transition-all ${
                  providerType === 'nuvio' ? 'card-selected' : ''
                }`}
              >
                <span className="text-sm font-medium">Nuvio</span>
              </button>
            </div>
          </div>

          {providerType === 'nuvio' ? (
            <>
              {/* Nuvio Auth Mode Toggle */}
              <div className="grid grid-cols-2 gap-2 w-full">
                <button
                  type="button"
                  onClick={() => setAuthMode('oauth')}
                  className={`card card-selectable color-hover hover:shadow-lg transition-all py-2 text-center ${
                    authMode === 'oauth' ? 'card-selected' : ''
                  }`}
                >
                  <span className="text-sm font-medium">Nuvio OAuth</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('credentials')}
                  className={`card card-selectable color-hover hover:shadow-lg transition-all py-2 text-center ${
                    authMode === 'credentials' ? 'card-selected' : ''
                  }`}
                >
                  <span className="text-sm font-medium">Credentials</span>
                </button>
              </div>

              {authMode === 'oauth' ? (
                <NuvioOAuthCard
                  onAuth={handleNuvioAuth}
                  disabled={isCreating}
                  autoStart={true}
                  withContainer={false}
                />
              ) : (
                <NuvioLoginCard
                  onAuth={handleNuvioAuth}
                  disabled={isCreating}
                />
              )}
              {providerUserId && (
                <p className="text-sm text-green-600 dark:text-green-400">Nuvio account verified successfully.</p>
              )}
              {!editingUser && (
                <>
                  <div>
                    <select
                      value={isCreatingNewGroup ? '__create_new__' : selectedGroup}
                      onChange={(e) => {
                        if (e.target.value === '__create_new__') {
                          setIsCreatingNewGroup(true)
                          setSelectedGroup('')
                          setNewGroupName('')
                        } else {
                          setIsCreatingNewGroup(false)
                          setSelectedGroup(e.target.value)
                          setNewGroupName('')
                        }
                      }}
                      className={`w-full px-3 py-2 border rounded-lg focus:outline-none input`}
                    >
                      <option value="">Group (optional)</option>
                      {groups?.map((group: any) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                      <option value="__create_new__">+ Create new group...</option>
                    </select>
                    {isCreatingNewGroup && (
                      <input
                        type="text"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        placeholder="Enter new group name"
                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none input mt-2`}
                        autoFocus
                      />
                    )}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              {/* Auth method toggle */}
              <div className="w-full">
                <div className="grid grid-cols-2 gap-2 w-full">
                  <button
                    type="button"
                    onClick={() => setAuthMode('oauth')}
                    className={`w-full py-3 px-4 rounded-lg cursor-pointer card card-selectable color-hover hover:shadow-lg transition-all ${
                      authMode === 'oauth' ? 'card-selected' : ''
                    }`}
                  >
                    <span className="text-sm font-medium">Stremio OAuth</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthMode('credentials')}
                    className={`w-full py-3 px-4 rounded-lg cursor-pointer card card-selectable color-hover hover:shadow-lg transition-all ${
                      authMode === 'credentials' ? 'card-selected' : ''
                    }`}
                  >
                    <span className="text-sm font-medium">Credentials</span>
                  </button>
                </div>
              </div>
              {authMode === 'oauth' ? (
                <>
                  <div className={isAuthVerified ? 'hidden' : ''}>
                    <StremioOAuthCard
                      active={authMode === 'oauth' && !isAuthVerified}
                      autoStart={true}
                      onAuthKey={handleStremioOAuth}
                      disabled={isCreating || isVerifyingAuth}
                      showSubmitButton={false}
                    />
                  </div>
                  {!editingUser && (
                    <>
                      <div>
                        <select
                          value={isCreatingNewGroup ? '__create_new__' : selectedGroup}
                          onChange={(e) => {
                            if (e.target.value === '__create_new__') {
                              setIsCreatingNewGroup(true)
                              setSelectedGroup('')
                              setNewGroupName('')
                            } else {
                              setIsCreatingNewGroup(false)
                              setSelectedGroup(e.target.value)
                              setNewGroupName('')
                            }
                          }}
                          className={`w-full px-3 py-2 border rounded-lg focus:outline-none input`}
                        >
                          <option value="">Group (optional)</option>
                          {groups?.map((group: any) => (
                            <option key={group.id} value={group.id}>
                              {group.name}
                            </option>
                          ))}
                          <option value="__create_new__">+ Create new group...</option>
                        </select>
                        {isCreatingNewGroup && (
                          <input
                            type="text"
                            value={newGroupName}
                            onChange={(e) => setNewGroupName(e.target.value)}
                            placeholder="Enter new group name"
                            className={`w-full px-3 py-2 border rounded-lg focus:outline-none input mt-2`}
                            autoFocus
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          id="register-new-oauth"
                          type="checkbox"
                          checked={registerNew}
                          onChange={(e) => setRegisterNew(e.target.checked)}
                          className="control-radio"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <label htmlFor="register-new-oauth" className={`text-sm cursor-pointer`} onClick={() => setRegisterNew(!registerNew)}>
                          Register
                        </label>
                      </div>
                    </>
                  )}
                </>
              ) : authMode === 'credentials' ? (
            <>
          <div>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                const newEmail = e.target.value
                setEmail(newEmail)
                // Auto-fill username from email (part before @) if username hasn't been manually edited
                if (!editingUser && !usernameManuallyEdited && newEmail.includes('@')) {
                  const emailPrefix = newEmail.split('@')[0].trim()
                  if (emailPrefix) {
                    // Capitalize first letter like OAuth does
                    const capitalizedUsername = emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1)
                    setUsername(capitalizedUsername)
                  }
                }
              }}
              placeholder="Email"
              readOnly={!!editingUser}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none ${editingUser ? 'input cursor-not-allowed opacity-80' : 'input'}`}
            />
          </div>
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none input`}
            />
          </div>
          <div className="text-center text-sm color-text-secondary">or</div>
          <div>
            <input
              type="text"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              placeholder="Stremio Auth Key"
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none input`}
            />
          </div>
          {!editingUser && (
            <>
              <div>
                <select
                  value={isCreatingNewGroup ? '__create_new__' : selectedGroup}
                  onChange={(e) => {
                    if (e.target.value === '__create_new__') {
                      setIsCreatingNewGroup(true)
                      setSelectedGroup('')
                      setNewGroupName('')
                    } else {
                      setIsCreatingNewGroup(false)
                      setSelectedGroup(e.target.value)
                      setNewGroupName('')
                    }
                  }}
                  className={`w-full px-3 py-2 border rounded-lg focus:outline-none input`}
                >
                  <option value="">Group (optional)</option>
                  {groups?.map((group: any) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                  <option value="__create_new__">+ Create new group...</option>
                </select>
                {isCreatingNewGroup && (
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="Enter new group name"
                    className={`w-full px-3 py-2 border rounded-lg focus:outline-none input mt-2`}
                    autoFocus
                  />
                )}
              </div>
            <div className="flex items-center gap-2">
              <input
                id="register-new"
                type="checkbox"
                checked={registerNew}
                onChange={(e) => setRegisterNew(e.target.checked)}
                  className="control-radio"
                  onClick={(e) => e.stopPropagation()}
              />
                <label htmlFor="register-new" className={`text-sm cursor-pointer`} onClick={() => setRegisterNew(!registerNew)}>
                  Register
              </label>
            </div>
            </>
          )}
            </>
          ) : null}
            </>
          )}

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={handleClose}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors color-text-secondary color-hover`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitDisabled}
                onClick={() => {}}
                className="px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 color-surface hover:opacity-90"
              >
                {isCreating ? (registerNew ? 'Registering...' : (editingUser ? 'Reconnecting...' : 'Adding...')) : (registerNew ? 'Register & Connect' : (editingUser ? 'Reconnect User' : 'Add User'))}
              </button>
            </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
