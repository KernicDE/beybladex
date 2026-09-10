// tests/unit/header.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Header } from '@/components/layout/Header'
import { ThemeProvider } from '@/components/theme/ThemeProvider'

describe('Header', () => {
  it('renders the brand name and a theme toggle', () => {
    render(
      <ThemeProvider>
        <Header session={null} avatarImageId={null} />
      </ThemeProvider>
    )
    expect(screen.getByText('BeybladeX.de')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /theme/i })).toBeInTheDocument()
  })
})
