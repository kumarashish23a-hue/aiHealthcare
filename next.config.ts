import type {NextConfig} from 'next';

// Content-Security-Policy, kept permissive enough not to break Next.js:
// - 'unsafe-inline' for script/style: Next injects inline bootstrap scripts
//   and this app (Tailwind v4) relies on inline styles.
// - img-src https://picsum.photos matches the images.remotePatterns below.
// - connect-src https://*.supabase.co (+ wss:) covers Supabase Auth/REST/
//   realtime from the browser. Server-side Gemini calls are not subject
//   to CSP. (Firebase was removed in the production build — no Firebase
//   hosts are allowed any more.)
// Permissions-Policy disables camera/microphone/geolocation: a repo-wide
// grep found no getUserMedia / SpeechRecognition / MediaRecorder usage —
// the only speech API used is speechSynthesis (text-to-speech playback in
// HealthWorkerView / PatientScreeningModal), which needs no mic permission.
// If voice *input* is ever added, change microphone to microphone=(self).
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://picsum.photos",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  {key: 'X-Content-Type-Options', value: 'nosniff'},
  {key: 'X-Frame-Options', value: 'DENY'},
  {key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin'},
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  },
  {key: 'Content-Security-Policy', value: contentSecurityPolicy},
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Allow access to remote image placeholder.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**', // This allows any path under the hostname
      },
    ],
  },
  output: 'standalone',
  transpilePackages: ['motion'],
  experimental: {
    webpackMemoryOptimizations: true,
    cpus: 1,
    workerThreads: false,
    // Disable buggy Segment Explorer devtool (it triggers "React Client Manifest"
    // errors + error overlays in the browser on Next 15.5.28 dev servers).
    devtoolSegmentExplorer: false,
  },
  webpack: (config, {dev}) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify—file watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;
