/**
 * Display name, taglines, and descriptions. Swap these without renaming internals.
 */

export interface BrandingConfig {
  displayName: string;
  internalName: string;
  tagline: {
    en: string;
    pt: string;
  };
  shortDescription: {
    en: string;
    pt: string;
  };
  longDescription: {
    en: string;
    pt: string;
  };
  salesCopy: {
    en: {
      headline: string;
      subheadline: string;
      summary: string;
    };
    pt: {
      headline: string;
      subheadline: string;
      summary: string;
    };
  };
}

export const branding: BrandingConfig = {
  displayName: process.env.PRODUCT_DISPLAY_NAME || "Mailwarden",
  internalName: "mailwarden",
  tagline: {
    en: "Your email, managed through normal conversation.",
    pt: "Seus e-mails, gerenciados em conversa normal.",
  },
  shortDescription: {
    en: "Connect your email to your AI assistant. See what matters, who needs a reply, and respond without living in your inbox.",
    pt: "Conecte seus e-mails ao seu assistente. Veja o que importa, quem precisa de resposta e responda sem viver na caixa de entrada.",
  },
  longDescription: {
    en: "Mailwarden connects your email accounts to your conversational AI so you can ask what matters, see who needs a reply, check history with someone, and prepare responses without living in your inbox.",
    pt: "O Mailwarden conecta suas contas de e-mail ao seu assistente para você perguntar o que importa, ver quem espera resposta, checar o histórico com alguém e preparar respostas sem vasculhar e-mail por e-mail.",
  },
  salesCopy: {
    en: {
      headline: "Connect your email to your AI assistant.",
      subheadline: "All your email, handled in conversation.",
      summary: "See what matters, who needs a reply, and respond without living in your inbox.",
    },
    pt: {
      headline: "Seus e-mails no seu assistente.",
      subheadline: "E-mail gerenciado em conversa normal.",
      summary: "Conecte seus e-mails. Ele mostra o que importa, quem espera resposta e ajuda você a responder sem vasculhar e-mail por e-mail.",
    },
  },
};
