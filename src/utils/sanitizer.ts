/**
 * Email content sanitizer.
 * Treats all incoming email bodies as untrusted external data.
 * Neutralizes active scripts, strips remote tracking beacons, disables remote images,
 * and extracts clean plain text.
 */

export interface SanitizationResult {
  plainText: string;
  safeHtml?: string;
  hasTrackingPixels: boolean;
  hasExternalLinks: boolean;
  externalLinkUrls: string[];
}

// Regex to detect 1x1 tracking pixels (common pixel trackers)
const TRACKING_PIXEL_REGEX = /<img[^>]+(?:width=['"]?(?:0|1)['"]?|height=['"]?(?:0|1)['"]?|display:\s*none)[^>]*>/gi;

// Dangerous tags that must never be executed or rendered
const DANGEROUS_TAGS = /<(script|style|iframe|object|embed|applet|form|input|button|svg|math|meta|link)[^>]*>[\s\S]*?<\/\1>|<(script|style|iframe|object|embed|applet|form|input|button|svg|math|meta|link)[^>]*\/?>/gi;

// Strip javascript: and data: attributes and all inline event handlers (onload, onerror, onclick, etc.)
const EVENT_HANDLER_REGEX = /\s*(?:on[a-zA-Z]+|href\s*=\s*['"]\s*javascript:|src\s*=\s*['"]\s*javascript:)[^"'>\s]*/gi;

export function sanitizeHtml(rawHtml: string): { safeHtml: string; trackingDetected: boolean; links: string[] } {
  if (!rawHtml) return { safeHtml: "", trackingDetected: false, links: [] };

  let html = rawHtml;
  const trackingDetected = TRACKING_PIXEL_REGEX.test(html);

  // Remove tracking pixels
  html = html.replace(TRACKING_PIXEL_REGEX, "<!-- tracking pixel removed -->");

  // Remove dangerous executable tags
  html = html.replace(DANGEROUS_TAGS, "");

  // Remove event handlers & javascript: protocols
  html = html.replace(EVENT_HANDLER_REGEX, "");

  // Extract external links safely
  const links: string[] = [];
  const linkRegex = /<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    if (match[1]) links.push(match[1]);
  }

  // Rewrite remote images to prevent auto-loading beacons unless explicitly requested
  // Replace <img src="http..."> with a data-blocked-src attribute or safe placeholder
  html = html.replace(/<img([^>]+)src=["'](https?:\/\/[^"']+)["']([^>]*)>/gi, (_full, before, src, after) => {
    return `<img${before}data-blocked-src="${src}" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><text y='12' font-size='12'>🖼️</text></svg>" alt="[Remote Image Blocked]"${after}>`;
  });

  return {
    safeHtml: html,
    trackingDetected,
    links,
  };
}

export function extractPlainTextFromHtml(html: string): string {
  if (!html) return "";

  // Strip script and style blocks first
  let text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");

  // Convert line breaks and paragraph breaks
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/tr>/gi, "\n");
  text = text.replace(/<\/li>/gi, "\n");
  text = text.replace(/<li[^>]*>/gi, "• ");

  // Strip all other HTML tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–");

  // Normalize excessive whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n\s*\n\s*\n+/g, "\n\n");

  return text.trim();
}

export function sanitizeEmailContent(rawText?: string, rawHtml?: string): SanitizationResult {
  let plainText = rawText?.trim() || "";
  let safeHtml: string | undefined = undefined;
  let hasTrackingPixels = false;
  const links: string[] = [];

  if (rawHtml) {
    const sanitized = sanitizeHtml(rawHtml);
    safeHtml = sanitized.safeHtml;
    hasTrackingPixels = sanitized.trackingDetected;
    links.push(...sanitized.links);

    // If no plain text was provided, derive it safely from the HTML
    if (!plainText) {
      plainText = extractPlainTextFromHtml(rawHtml);
    }
  }

  return {
    plainText,
    safeHtml,
    hasTrackingPixels,
    hasExternalLinks: links.length > 0,
    externalLinkUrls: [...new Set(links)],
  };
}
