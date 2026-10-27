// Reddit Pixel: loaded only when NEXT_PUBLIC_REDDIT_PIXEL_ID is set (see docs/analytics.md).
export function redditPixelSnippet(id) {
  return `!function(w,d){if(!w.rdt){var p=w.rdt=function(){p.sendEvent?p.sendEvent.apply(p,arguments):p.callQueue.push(arguments)};p.callQueue=[];var t=d.createElement("script");t.src="https://www.redditstatic.com/ads/pixel.js",t.async=!0;var s=d.getElementsByTagName("script")[0];s.parentNode.insertBefore(t,s)}}(window,document);rdt('init',${JSON.stringify(id)});rdt('track','PageVisit');`
}

// No-op when the pixel is not loaded.
export function trackRedditEvent(name) {
  if (typeof window !== 'undefined' && typeof window.rdt === 'function') window.rdt('track', name)
}
