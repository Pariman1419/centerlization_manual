import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { containsThai, UserText } from '../components/UserText'

describe('Typography and UserText', () => {
  it('detects Thai characters accurately', () => {
    expect(containsThai('คู่มือการใช้งานเครื่องจักร')).toBe(true)
    expect(containsThai('Machine Manual 01')).toBe(false)
    expect(containsThai('PRJ-01: ระบบชุบเคลือบ')).toBe(true)
  })

  it('renders English text without lang attribute', () => {
    render(<UserText text="Standard Operating Procedure" />)
    const el = screen.getByText('Standard Operating Procedure')
    expect(el).not.toHaveAttribute('lang')
  })

  it('renders Thai text with lang="th" and Thai phrase formatting class', () => {
    render(<UserText text="คู่มือการใช้งานเครื่องจักร" />)
    const el = screen.getByText('คู่มือการใช้งานเครื่องจักร')
    expect(el).toHaveAttribute('lang', 'th')
    expect(el).toHaveClass('[word-break:auto-phrase]')
  })

  it('renders as different HTML tags correctly', () => {
    render(<UserText as="h2" text="หัวข้อภาษาไทย" />)
    const heading = screen.getByRole('heading', { level: 2, name: 'หัวข้อภาษาไทย' })
    expect(heading).toBeInTheDocument()
    expect(heading).toHaveAttribute('lang', 'th')
  })
})
