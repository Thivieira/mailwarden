import { describe, it, expect } from "bun:test";
import {
  ProviderDiscoveryService,
  parseAutoconfigXml,
} from "../src/services/provider-discovery";

describe("Provider Discovery Service", () => {
  it("resolves known major providers immediately with high confidence", async () => {
    const service = new ProviderDiscoveryService({
      dohFetcher: async () => [],
      ispdbFetcher: async () => null,
    });

    const gmail = await service.discoverForEmail("user@gmail.com");
    expect(gmail.providerType).toBe("google");
    expect(gmail.nativeOAuthSupported).toBe(true);
    expect(gmail.confidence).toBe("high");

    const outlook = await service.discoverForEmail("user@outlook.com");
    expect(outlook.providerType).toBe("microsoft");
    expect(outlook.nativeOAuthSupported).toBe(true);
    expect(outlook.confidence).toBe("high");

    const proton = await service.discoverForEmail("alice@proton.me");
    expect(proton.providerType).toBe("proton");
    expect(proton.nativeOAuthSupported).toBe(false);

    const icloud = await service.discoverForEmail("bob@icloud.com");
    expect(icloud.providerType).toBe("imap_smtp");
    expect(icloud.incoming?.host).toBe("imap.mail.me.com");
    expect(icloud.incoming?.port).toBe(993);
    expect(icloud.outgoing?.host).toBe("smtp.mail.me.com");

    const fastmail = await service.discoverForEmail("carol@fastmail.com");
    expect(fastmail.providerType).toBe("imap_smtp");
    expect(fastmail.incoming?.host).toBe("imap.fastmail.com");
  });

  it("detects Google Workspace on custom domains via MX records", async () => {
    const service = new ProviderDiscoveryService({
      dohFetcher: async (domain) => {
        if (domain === "acmecorp.com") {
          return ["10 aspmx.l.google.com.", "20 alt1.aspmx.l.google.com."];
        }
        return [];
      },
      ispdbFetcher: async () => null,
    });

    const result = await service.discoverForEmail("ceo@acmecorp.com");
    expect(result.providerType).toBe("google");
    expect(result.nativeOAuthSupported).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.notes).toContain("Google Workspace");
  });

  it("detects Microsoft 365 on custom domains via MX records", async () => {
    const service = new ProviderDiscoveryService({
      dohFetcher: async (domain) => {
        if (domain === "enterprise.org") {
          return ["0 enterprise-org.mail.protection.outlook.com."];
        }
        return [];
      },
      ispdbFetcher: async () => null,
    });

    const result = await service.discoverForEmail("admin@enterprise.org");
    expect(result.providerType).toBe("microsoft");
    expect(result.nativeOAuthSupported).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.notes).toContain("Microsoft 365");
  });

  it("detects Proton Mail on custom domains via MX records", async () => {
    const service = new ProviderDiscoveryService({
      dohFetcher: async (domain) => {
        if (domain === "secure-startup.io") {
          return ["10 mail.protonmail.ch.", "20 mailsec.protonmail.ch."];
        }
        return [];
      },
      ispdbFetcher: async () => null,
    });

    const result = await service.discoverForEmail("founder@secure-startup.io");
    expect(result.providerType).toBe("proton");
    expect(result.confidence).toBe("high");
    expect(result.notes).toContain("Bridge");
  });

  it("parses Mozilla ISPDB autoconfig XML correctly", () => {
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<clientConfig version="1.1">
  <emailProvider id="example.com">
    <domain>example.com</domain>
    <displayName>Example Mail</displayName>
    <displayShortName>Example</displayShortName>
    <incomingServer type="imap">
      <hostname>mail.example.com</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
      <username>%EMAILADDRESS%</username>
      <authentication>password-cleartext</authentication>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>smtp.example.com</hostname>
      <port>587</port>
      <socketType>STARTTLS</socketType>
      <username>%EMAILADDRESS%</username>
      <authentication>password-cleartext</authentication>
    </outgoingServer>
  </emailProvider>
</clientConfig>`;

    const parsed = parseAutoconfigXml(sampleXml, "example.com");
    expect(parsed).not.toBeNull();
    expect(parsed?.confidence).toBe("high");
    expect(parsed?.displayName).toBe("Example Mail");
    expect(parsed?.incoming?.host).toBe("mail.example.com");
    expect(parsed?.incoming?.port).toBe(993);
    expect(parsed?.incoming?.socketType).toBe("SSL");
    expect(parsed?.outgoing?.host).toBe("smtp.example.com");
    expect(parsed?.outgoing?.port).toBe(587);
    expect(parsed?.outgoing?.socketType).toBe("STARTTLS");
  });

  it("falls back to standard IMAP/SMTP convention heuristics when no autoconfig exists", async () => {
    const service = new ProviderDiscoveryService({
      dohFetcher: async () => ["10 mx.customserver.net"],
      ispdbFetcher: async () => null,
    });

    const result = await service.discoverForEmail("user@customserver.net");
    expect(result.providerType).toBe("imap_smtp");
    expect(result.confidence).toBe("candidate");
    expect(result.incoming?.host).toBe("imap.customserver.net");
    expect(result.incoming?.port).toBe(993);
    expect(result.incoming?.socketType).toBe("SSL");
    expect(result.outgoing?.host).toBe("smtp.customserver.net");
    expect(result.outgoing?.port).toBe(465);
  });
});
