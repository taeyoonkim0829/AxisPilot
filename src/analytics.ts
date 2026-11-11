/**
 * Google Analytics 4: page view and a few usage events. Off in the dev server and while no measurement ID is set.
 * Only event names and the screen go out, never the inputs or selections (customers' project data); the page
 * location is sent without the query, which may still hold a shared calculation (`?r=`).
 */
const GA_ID = '' // the GA4 web stream's measurement ID, G-XXXXXXXXXX

type Gtag = (...args: unknown[]) => void
declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: Gtag
  }
}

export function initAnalytics() {
  if (!GA_ID || !import.meta.env.PROD) return
  window.dataLayer = window.dataLayer ?? []
  // gtag.js reads the arguments objects themselves from dataLayer
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments)
  }
  window.gtag('js', new Date())
  window.gtag('config', GA_ID, { page_location: location.origin + location.pathname + location.hash })
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`
  document.head.append(script)
}

/** A usage event (screen switch, exports, shared link opened); a no-op while analytics is off */
export function track(event: string, params?: Record<string, string>) {
  window.gtag?.('event', event, params)
}
