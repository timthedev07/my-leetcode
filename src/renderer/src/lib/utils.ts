import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatAcceptanceRate(value: number | null): string | null {
  return value === null ? null : `${value.toFixed(1)}%`
}

