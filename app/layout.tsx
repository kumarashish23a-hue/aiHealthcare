import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-mono',
});

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
  width: 'device-width',
  initialScale: 1,
};

const themeInitScript = `(function(){try{var s=localStorage.getItem('swasthya-theme');var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`

export const metadata: Metadata = {
  title: 'SwasthyaSetu AI',
  description:
    'AI-assisted rural healthcare screening, referral, and follow-up platform for ASHA frontline workers and Primary Healthcare Centres.',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'SwasthyaSetu',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'SwasthyaSetu AI',
    description:
      'AI-assisted rural healthcare screening, referral, and follow-up platform for ASHA frontline workers and Primary Healthcare Centres.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SwasthyaSetu AI',
    description:
      'AI-assisted rural healthcare screening, referral, and follow-up platform for ASHA frontline workers and Primary Healthcare Centres.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plusJakarta.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body suppressHydrationWarning className="font-sans antialiased bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}
