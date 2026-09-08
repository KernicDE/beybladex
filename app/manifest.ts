import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BeybladeX.de',
    short_name: 'BeybladeX',
    description: 'Community-, Sammlungs-, Social- und Turnier-Plattform für Beyblade X in der DACH-Region',
    start_url: '/',
    display: 'standalone',
    background_color: '#090D16',
    theme_color: '#00F0FF',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
