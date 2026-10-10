'use client'

import { useT } from '@/components/LocaleProvider'
import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const t = useT()
  const [visible, setVisible] = useState(false)
  return (
    <span className="password-field">
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className={`w-full ${props.className || ''}`}
      />
      <button
        type="button"
        disabled={props.disabled}
        onClick={() => setVisible(!visible)}
        aria-label={t(visible ? 'Скрыть пароль' : 'Показать пароль')}
        aria-pressed={visible}
      >
        {visible ? <EyeOff size={20} /> : <Eye size={20} />}
      </button>
    </span>
  )
}
