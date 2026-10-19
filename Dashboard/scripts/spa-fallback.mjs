// GitHub Pages has no server-side rewrites. Serving index.html as 404.html lets
// deep links and refreshes (e.g. /AdaptiveDesk/security) load the SPA, which then routes client-side.
import { copyFileSync } from 'node:fs'
copyFileSync('dist/index.html', 'dist/404.html')
console.log('Created dist/404.html (SPA fallback)')
