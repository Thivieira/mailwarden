import type {
  DiscoveredProviderConfig,
  DiscoveredProviderType,
  ProviderDiscoveryConfidence,
  ServerEndpointConfig,
  ConnectionTestResult,
} from "@mailwarden/contracts";
import { ImapProvider, type ImapCredentials } from "../providers/imap";
import { SmtpProvider } from "../providers/smtp";
import { logger } from "../utils/logger";

export interface ProviderDiscoveryOptions {
  dohFetcher?: (domain: string) => Promise<string[]>;
  ispdbFetcher?: (domain: string) => Promise<string | null>;
}

const KNOWN_EMAIL_DOMAINS: Record<string, DiscoveredProviderConfig> = {
  "gmail.com": {
    confidence: "high",
    providerType: "google",
    displayName: "Google Workspace / Gmail",
    domain: "gmail.com",
    nativeOAuthSupported: true,
    notes: "Connect directly with Google OAuth for full mailbox intelligence.",
  },
  "googlemail.com": {
    confidence: "high",
    providerType: "google",
    displayName: "Google Workspace / Gmail",
    domain: "googlemail.com",
    nativeOAuthSupported: true,
    notes: "Connect directly with Google OAuth for full mailbox intelligence.",
  },
  "outlook.com": {
    confidence: "high",
    providerType: "microsoft",
    displayName: "Microsoft 365 / Outlook",
    domain: "outlook.com",
    nativeOAuthSupported: true,
    notes: "Connect directly with Microsoft OAuth for full mailbox intelligence.",
  },
  "hotmail.com": {
    confidence: "high",
    providerType: "microsoft",
    displayName: "Microsoft 365 / Outlook",
    domain: "hotmail.com",
    nativeOAuthSupported: true,
    notes: "Connect directly with Microsoft OAuth for full mailbox intelligence.",
  },
  "live.com": {
    confidence: "high",
    providerType: "microsoft",
    displayName: "Microsoft 365 / Outlook",
    domain: "live.com",
    nativeOAuthSupported: true,
    notes: "Connect directly with Microsoft OAuth for full mailbox intelligence.",
  },
  "office365.com": {
    confidence: "high",
    providerType: "microsoft",
    displayName: "Microsoft 365 / Outlook",
    domain: "office365.com",
    nativeOAuthSupported: true,
    notes: "Connect directly with Microsoft OAuth for full mailbox intelligence.",
  },
  "proton.me": {
    confidence: "high",
    providerType: "proton",
    displayName: "Proton Mail",
    domain: "proton.me",
    nativeOAuthSupported: false,
    notes: "Requires Mailwarden Bridge and Proton Mail Bridge.",
  },
  "protonmail.com": {
    confidence: "high",
    providerType: "proton",
    displayName: "Proton Mail",
    domain: "protonmail.com",
    nativeOAuthSupported: false,
    notes: "Requires Mailwarden Bridge and Proton Mail Bridge.",
  },
  "pm.me": {
    confidence: "high",
    providerType: "proton",
    displayName: "Proton Mail",
    domain: "pm.me",
    nativeOAuthSupported: false,
    notes: "Requires Mailwarden Bridge and Proton Mail Bridge.",
  },
  "icloud.com": {
    confidence: "high",
    providerType: "imap_smtp",
    displayName: "Apple iCloud Mail",
    domain: "icloud.com",
    nativeOAuthSupported: false,
    incoming: { host: "imap.mail.me.com", port: 993, socketType: "SSL" },
    outgoing: { host: "smtp.mail.me.com", port: 587, socketType: "STARTTLS" },
    notes: "Apple requires an App-Specific Password from appleid.apple.com.",
  },
  "me.com": {
    confidence: "high",
    providerType: "imap_smtp",
    displayName: "Apple iCloud Mail",
    domain: "me.com",
    nativeOAuthSupported: false,
    incoming: { host: "imap.mail.me.com", port: 993, socketType: "SSL" },
    outgoing: { host: "smtp.mail.me.com", port: 587, socketType: "STARTTLS" },
    notes: "Apple requires an App-Specific Password from appleid.apple.com.",
  },
  "fastmail.com": {
    confidence: "high",
    providerType: "imap_smtp",
    displayName: "Fastmail",
    domain: "fastmail.com",
    nativeOAuthSupported: false,
    incoming: { host: "imap.fastmail.com", port: 993, socketType: "SSL" },
    outgoing: { host: "smtp.fastmail.com", port: 465, socketType: "SSL" },
    notes: "Use an App Password generated in your Fastmail settings.",
  },
  "yahoo.com": {
    confidence: "high",
    providerType: "imap_smtp",
    displayName: "Yahoo Mail",
    domain: "yahoo.com",
    nativeOAuthSupported: false,
    incoming: { host: "imap.mail.yahoo.com", port: 993, socketType: "SSL" },
    outgoing: { host: "smtp.mail.yahoo.com", port: 465, socketType: "SSL" },
    notes: "Use an App Password generated in your Yahoo Security settings.",
  },
  "zoho.com": {
    confidence: "high",
    providerType: "imap_smtp",
    displayName: "Zoho Mail",
    domain: "zoho.com",
    nativeOAuthSupported: false,
    incoming: { host: "imappro.zoho.com", port: 993, socketType: "SSL" },
    outgoing: { host: "smtppro.zoho.com", port: 465, socketType: "SSL" },
    notes: "Use an App Password if Two-Factor Authentication is enabled.",
  },
};

/** Default DNS-over-HTTPS resolver querying Cloudflare 1.1.1.1 JSON API. */
async function defaultDohMxFetcher(domain: string): Promise<string[]> {
  try {
    const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`;
    const res = await fetch(url, {
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    if (!data.Answer || !Array.isArray(data.Answer)) return [];
    return data.Answer.map((ans: any) => String(ans.data || "").toLowerCase());
  } catch (err: any) {
    logger.debug("DoH MX query failed", { domain, error: err.message });
    return [];
  }
}

/** Default Mozilla ISPDB autoconfiguration fetcher. */
async function defaultIspdbFetcher(domain: string): Promise<string | null> {
  try {
    const url = `https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Parses XML from Mozilla ISPDB / Autoconfig format. */
export function parseAutoconfigXml(xml: string, domain: string): Partial<DiscoveredProviderConfig> | null {
  try {
    let incoming: ServerEndpointConfig | undefined;
    let outgoing: ServerEndpointConfig | undefined;
    let displayName = domain;

    const displayMatch = xml.match(/<displayName>(.*?)<\/displayName>/i);
    if (displayMatch) displayName = displayMatch[1]!;

    // Find incoming IMAP server block
    const imapMatch = xml.match(/<incomingServer\s+type="imap"[^>]*>([\s\S]*?)<\/incomingServer>/i);
    if (imapMatch) {
      const block = imapMatch[1]!;
      const hostMatch = block.match(/<hostname>(.*?)<\/hostname>/i);
      const portMatch = block.match(/<port>(.*?)<\/port>/i);
      const socketMatch = block.match(/<socketType>(.*?)<\/socketType>/i);

      if (hostMatch && hostMatch[1]) {
        const socketRaw = (socketMatch && socketMatch[1] ? socketMatch[1] : "SSL").toUpperCase();
        const socketType: ServerEndpointConfig["socketType"] =
          socketRaw === "STARTTLS" ? "STARTTLS" : socketRaw === "PLAIN" ? "PLAIN" : "SSL";
        incoming = {
          host: hostMatch[1].trim(),
          port: portMatch && portMatch[1] ? Number(portMatch[1]) : 993,
          socketType,
        };
      }
    }

    // Find outgoing SMTP server block
    const smtpMatch = xml.match(/<outgoingServer\s+type="smtp"[^>]*>([\s\S]*?)<\/outgoingServer>/i);
    if (smtpMatch && smtpMatch[1]) {
      const block = smtpMatch[1];
      const hostMatch = block.match(/<hostname>(.*?)<\/hostname>/i);
      const portMatch = block.match(/<port>(.*?)<\/port>/i);
      const socketMatch = block.match(/<socketType>(.*?)<\/socketType>/i);

      if (hostMatch && hostMatch[1]) {
        const socketRaw = (socketMatch && socketMatch[1] ? socketMatch[1] : "STARTTLS").toUpperCase();
        const socketType: ServerEndpointConfig["socketType"] =
          socketRaw === "SSL" ? "SSL" : socketRaw === "PLAIN" ? "PLAIN" : "STARTTLS";
        outgoing = {
          host: hostMatch[1].trim(),
          port: portMatch && portMatch[1] ? Number(portMatch[1]) : 587,
          socketType,
        };
      }
    }

    if (incoming) {
      return {
        confidence: "high",
        providerType: "imap_smtp",
        displayName,
        domain,
        nativeOAuthSupported: false,
        incoming,
        outgoing,
      };
    }

    return null;
  } catch {
    return null;
  }
}

export class ProviderDiscoveryService {
  private dohFetcher: (domain: string) => Promise<string[]>;
  private ispdbFetcher: (domain: string) => Promise<string | null>;

  constructor(options: ProviderDiscoveryOptions = {}) {
    this.dohFetcher = options.dohFetcher || defaultDohMxFetcher;
    this.ispdbFetcher = options.ispdbFetcher || defaultIspdbFetcher;
  }

  /**
   * Identifies the mail system for an email address and suggests the optimal connectivity mode.
   */
  async discoverForEmail(emailAddress: string): Promise<DiscoveredProviderConfig> {
    const cleanEmail = emailAddress.trim().toLowerCase();
    const domain = cleanEmail.includes("@") ? cleanEmail.split("@")[1]! : cleanEmail;
    return this.discoverForDomain(domain);
  }

  /**
   * Discovers email settings and recommended provider path for a domain.
   */
  async discoverForDomain(domain: string): Promise<DiscoveredProviderConfig> {
    const cleanDomain = domain.toLowerCase().trim();

    // 1. Check known domain dictionary
    if (KNOWN_EMAIL_DOMAINS[cleanDomain]) {
      return { ...KNOWN_EMAIL_DOMAINS[cleanDomain] };
    }

    // 2. Query MX records
    const mxRecords = await this.dohFetcher(cleanDomain);
    const mxJoined = mxRecords.join(" ");

    // 2a. Detect Google Workspace
    if (
      mxJoined.includes("google.com") ||
      mxJoined.includes("googlemail.com") ||
      mxJoined.includes("aspmx.l.google.com")
    ) {
      return {
        confidence: "high",
        providerType: "google",
        displayName: `${cleanDomain} (Google Workspace)`,
        domain: cleanDomain,
        nativeOAuthSupported: true,
        notes: "This domain uses Google Workspace. Connect with native Google OAuth for seamless synchronization.",
      };
    }

    // 2b. Detect Microsoft 365 / Exchange Online
    if (
      mxJoined.includes("outlook.com") ||
      mxJoined.includes("protection.outlook.com") ||
      mxJoined.includes("office365.com")
    ) {
      return {
        confidence: "high",
        providerType: "microsoft",
        displayName: `${cleanDomain} (Microsoft 365)`,
        domain: cleanDomain,
        nativeOAuthSupported: true,
        notes: "This domain uses Microsoft 365. Connect with native Microsoft OAuth for seamless synchronization.",
      };
    }

    // 2c. Detect Proton Mail
    if (
      mxJoined.includes("protonmail.ch") ||
      mxJoined.includes("mailsec.protonmail.ch") ||
      mxJoined.includes("proton.me")
    ) {
      return {
        confidence: "high",
        providerType: "proton",
        displayName: `${cleanDomain} (Proton Mail)`,
        domain: cleanDomain,
        nativeOAuthSupported: false,
        notes: "This domain uses Proton Mail. Connect through Mailwarden Bridge.",
      };
    }

    // 3. Try Mozilla ISPDB / Autoconfig
    const xml = await this.ispdbFetcher(cleanDomain);
    if (xml) {
      const parsed = parseAutoconfigXml(xml, cleanDomain);
      if (parsed && parsed.incoming) {
        return {
          confidence: "high",
          providerType: "imap_smtp",
          displayName: parsed.displayName || `${cleanDomain} Mail`,
          domain: cleanDomain,
          nativeOAuthSupported: false,
          incoming: parsed.incoming,
          outgoing: parsed.outgoing,
          notes: "Discovered standard IMAP/SMTP server configuration.",
        };
      }
    }

    // 4. Default candidate heuristic suggestions (convention-based, not positively verified)
    return {
      confidence: "candidate",
      providerType: "imap_smtp",
      displayName: `${cleanDomain} Mail`,
      domain: cleanDomain,
      nativeOAuthSupported: false,
      incoming: {
        host: `imap.${cleanDomain}`,
        port: 993,
        socketType: "SSL",
        usernameFormat: "full_email",
      },
      outgoing: {
        host: `smtp.${cleanDomain}`,
        port: 465,
        socketType: "SSL",
        usernameFormat: "full_email",
      },
      notes: "We found likely mail settings for this domain. Test connection to verify before saving.",
    };
  }

  /**
   * Tests connection with supplied credentials before persisting.
   */
  async testConnection(credentials: ImapCredentials): Promise<ConnectionTestResult> {
    const imapProvider = new ImapProvider(credentials);
    const imapResult = await imapProvider.testConnection();

    if (!imapResult.ok) {
      return imapResult;
    }

    // If SMTP is provided, test SMTP as well
    if (credentials.smtp) {
      const smtpProvider = new SmtpProvider({
        host: credentials.smtp.host,
        port: credentials.smtp.port,
        secure: credentials.smtp.secure,
        username: credentials.smtp.username,
        password: credentials.smtp.password,
        rejectUnauthorized: credentials.smtp.rejectUnauthorized,
      });
      const smtpResult = await smtpProvider.testConnection();
      if (!smtpResult.ok) {
        return {
          ok: false,
          code: smtpResult.code,
          humanMessage: `Incoming IMAP connected, but outgoing SMTP failed: ${smtpResult.humanMessage}`,
          technicalDetail: smtpResult.technicalDetail,
          latencyMs: (imapResult.latencyMs || 0) + (smtpResult.latencyMs || 0),
          foldersFound: imapResult.foldersFound,
        };
      }
    }

    return imapResult;
  }
}

export const providerDiscoveryService = new ProviderDiscoveryService();
