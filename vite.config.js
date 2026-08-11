import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('firebase')) return 'firebase'
          if (id.includes('react-router') || id.includes('/react/') || id.includes('react-dom')) return 'react-core'
          if (id.includes('framer-motion')) return 'motion'
          if (id.includes('katex')) return 'math'
          if (id.includes('sweetalert2')) return 'alerts'
          if (id.includes('jszip')) return 'zip-tools'
          if (id.includes('xlsx')) return 'spreadsheet-tools'
        },
      },
    },
  },
})
