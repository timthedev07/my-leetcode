import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { App } from './app/App'
import '../styles/index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false
    },
    mutations: {
      retry: false
    }
  }
})

const root = document.getElementById('root')
if (!root) throw new Error('Application root was not found.')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster position="bottom-right" theme="dark" />
    </QueryClientProvider>
  </StrictMode>
)

