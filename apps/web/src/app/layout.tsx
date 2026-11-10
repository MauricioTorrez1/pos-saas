import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Panel del negocio', template: '%s · Panel del negocio' },
  description: 'Administra el catálogo y tu tienda desde cualquier navegador.',
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
};

/** Root layout: sets the language and loads the design tokens. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-MX">
      <body>{children}</body>
    </html>
  );
}
