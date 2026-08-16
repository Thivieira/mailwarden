/**
 * Centralized Branding and Product Positioning Configuration
 * 
 * Allows display name, taglines, and descriptions to be customized
 * without requiring codebase-wide identifier refactoring.
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
    pt: "Todos os seus e-mails dentro do ChatGPT.",
  },
  shortDescription: {
    en: "Connect your email to ChatGPT. See what matters, who needs a reply, and respond without living in your inbox.",
    pt: "Conecte seus e-mails ao ChatGPT. Veja o que importa, quem precisa de resposta e responda sem viver dentro da caixa de entrada.",
  },
  longDescription: {
    en: "Mailwarden connects your email accounts to ChatGPT so you can ask what matters, see who needs a reply, understand conversation history, and prepare responses without living inside your inbox.",
    pt: "O Mailwarden conecta suas contas de e-mail ao ChatGPT para você perguntar o que importa, ver quem está esperando uma resposta, entender o histórico de conversas e preparar respostas sem precisar procurar e-mail por e-mail.",
  },
  salesCopy: {
    en: {
      headline: "Connect your email to ChatGPT.",
      subheadline: "All your email, managed through conversation.",
      summary: "See what matters, who needs a reply, and respond without living in your inbox.",
    },
    pt: {
      headline: "Todos os seus e-mails dentro do ChatGPT.",
      subheadline: "Seu e-mail gerenciado através de conversas normais.",
      summary: "Conecte seus e-mails ao ChatGPT. Ele mostra o que realmente importa, quem está esperando uma resposta e ajuda você a responder sem precisar procurar e-mail por e-mail.",
    },
  },
};
