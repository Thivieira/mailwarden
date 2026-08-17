import { branding } from "../config/branding";

/**
 * Localization Architecture
 *
 * Current Status:
 * English and Brazilian Portuguese implemented, with an extensible localization architecture.
 *
 * Design Invariants:
 * 1. Internal models, database enums, classifications, and actions are strictly language-neutral (e.g. "important", "archive", "client").
 * 2. Business logic is NEVER duplicated per locale.
 * 3. Adding a new locale only requires adding a translation dictionary and registering it via `registerLocale()`.
 * 4. Fallback is graceful and deterministic: unsupported locales fall back to English ("en").
 */

export type BuiltinLocale = "en" | "pt-BR";
export type SupportedLocale = BuiltinLocale | string;

export interface LocalizedContent {
  onboardingWelcome: string;
  onboardingChoices: {
    recommended: string;
    customize: string;
  };
  onboardingCompleted: {
    recommended: string;
    custom: string;
  };
  help: {
    tagline: string;
    summary: string;
    capabilities: string[];
    sampleQueries: {
      inboxOverview: string[];
      prioritization: string[];
      waitingState: string[];
      relationships: string[];
      threads: string[];
      drafting: string[];
      rules: string[];
    };
    safeDefaults: string[];
  };
  policyDescriptions: {
    safePreset: string;
    balancedPreset: string;
    inboxZeroPreset: string;
    customPreset: string;
    junkRule: string;
    routineRule: string;
    interestingRule: string;
    importantRule: string;
    criticalRule: string;
    uncertainRule: string;
  };
  actionDescriptions: {
    leave: string;
    archive: string;
    mark_read: string;
    keep_unread: string;
    label: (destination?: string) => string;
    move: (destination?: string) => string;
    delete: string;
    surface: string;
    prioritize: string;
  };
  simulatedActions: {
    wouldLeave: string;
    wouldArchive: string;
    wouldMarkRead: string;
    wouldKeepUnread: string;
    wouldLabel: (destination?: string) => string;
    wouldMove: (destination?: string) => string;
    wouldDelete: string;
    wouldSurface: string;
    wouldPrioritize: string;
  };
  providerStatus: {
    connected: string;
    offline: string;
    lastSeen: (device: string, timeAgo: string) => string;
    offlineWarning: (provider: string, device: string, timeAgo: string) => string;
  };
  humanConfirmation: {
    approvalRequired: string;
    idempotentNotice: string;
  };
}

const LOCALES: Record<string, LocalizedContent> = {
  en: {
    onboardingWelcome: `Welcome to ${branding.displayName}.

I can organize your email, show what matters, remember who people are, and prepare replies.

By default, ${branding.displayName} is conservative:

- important or uncertain emails stay visible
- obvious low-value mail may be archived
- nothing is permanently deleted automatically
- sending always requires your confirmation

Change these rules anytime by telling me things like:

"Archive newsletters automatically."
"Anything from this client is important."
"Never archive recruiter emails."
"Put receipts in Finance."

You can also ask:

"What needs my attention?"
"Who is waiting for me?"
"Summarize what happened with this client."
"Draft a reply."

Use recommended settings or customize?`,

    onboardingChoices: {
      recommended: "Use recommended defaults",
      customize: "Customize",
    },

    onboardingCompleted: {
      recommended: `Balanced is active:
- Obvious junk may be archived
- Routine, interesting, and important mail stay visible
- Nothing is permanently deleted
- Sending always needs your confirmation

Ask "What needs my attention?" or set a rule like "Archive newsletters automatically."`,
      custom: `Your custom email rules are saved. Change them anytime by talking to me.`,
    },

    help: {
      tagline: branding.tagline.en,
      summary: branding.shortDescription.en,
      capabilities: [
        "Organize and prioritize your inbox across connected accounts.",
        "Remember who people are to you (clients, coworkers, recruiters, vendors).",
        "Track open loops: who is waiting on you, and who you are waiting on.",
        "Prepare, revise, and sign draft replies in conversation.",
        "Set custom rules by talking, not by filling forms.",
      ],
      sampleQueries: {
        inboxOverview: ["What needs my attention?", "What's happening across all my email?"],
        prioritization: ["Which emails actually matter?", "Why is this email important?"],
        waitingState: ["Who is waiting for me?", "Who am I waiting for?"],
        relationships: ["Who is this person?", "This person is actually a client.", "What have we talked about before?"],
        threads: ["Summarize what happened with this client.", "Read the thread and reconsider."],
        drafting: ["Draft a reply.", "Make it less formal.", "Use my professional signature."],
        rules: [
          "Archive newsletters automatically.",
          "Never archive recruiter emails.",
          "Anything from this client is important.",
          "Put receipts in Finance.",
          "What are my current rules?",
        ],
      },
      safeDefaults: [
        "Important and uncertain emails stay visible.",
        "Obvious low-value mail may be archived.",
        "Nothing is permanently deleted automatically.",
        "Sending always needs your confirmation.",
      ],
    },

    policyDescriptions: {
      safePreset: "Safe: organizes and ranks email with almost no automatic movement.",
      balancedPreset: "Balanced (recommended): archives obvious junk; keeps routine, interesting, and important mail visible; leaves uncertain mail alone.",
      inboxZeroPreset: "Inbox Zero: archives more routine and low-value mail, keeping important and reply-needed mail in the inbox.",
      customPreset: "Custom: your own rules and overrides.",
      junkRule: "Junk: archive automatically (never permanently deleted).",
      routineRule: "Routine: keep in inbox with normal attention.",
      interestingRule: "Interesting: keep available, not urgent.",
      importantRule: "Important: keep visible and unread, high in the attention list.",
      criticalRule: "Critical: show immediately, never archive.",
      uncertainRule: "Uncertain: leave untouched in inbox.",
    },

    actionDescriptions: {
      leave: "Leave in inbox",
      archive: "Archive",
      mark_read: "Mark as read",
      keep_unread: "Keep unread",
      label: (dest?: string) => `Apply label${dest ? ` '${dest}'` : ""}`,
      move: (dest?: string) => `Move to folder${dest ? ` '${dest}'` : ""}`,
      delete: "Delete (off by default)",
      surface: "Show immediately",
      prioritize: "Raise in the attention list",
    },

    simulatedActions: {
      wouldLeave: "Would leave untouched in inbox",
      wouldArchive: "Would archive message",
      wouldMarkRead: "Would mark message as read",
      wouldKeepUnread: "Would keep message marked as unread",
      wouldLabel: (dest?: string) => `Would apply label${dest ? ` '${dest}'` : ""}`,
      wouldMove: (dest?: string) => `Would move to folder${dest ? ` '${dest}'` : ""}`,
      wouldDelete: "Would delete message (permanent deletion is restricted)",
      wouldSurface: "Would show this message as high priority",
      wouldPrioritize: "Would raise this sender and message in the attention list",
    },

    providerStatus: {
      connected: "Connected",
      offline: "Offline",
      lastSeen: (device: string, timeAgo: string) => `Connected through ${device} (last seen ${timeAgo})`,
      offlineWarning: (provider: string, device: string, timeAgo: string) =>
        `Your ${provider} connector is offline (last seen ${timeAgo} on ${device}), so ${provider} results may be incomplete.`,
    },

    humanConfirmation: {
      approvalRequired: "Sending always needs you to review and confirm the email.",
      idempotentNotice: "Identical send attempts are ignored so the same message does not go out twice.",
    },
  },

  "pt-BR": {
    onboardingWelcome: `Bem-vindo ao ${branding.displayName}.

Posso organizar seus e-mails, mostrar o que importa, lembrar quem são seus contatos e preparar respostas.

Por padrão, o ${branding.displayName} é conservador:

- e-mails importantes ou duvidosos continuam visíveis
- mensagens claramente pouco relevantes podem ser arquivadas
- nada é apagado permanentemente de forma automática
- o envio sempre exige sua confirmação

Mude essas regras quando quiser falando comigo:

"Arquive newsletters automaticamente."
"Tudo que vier desse cliente é importante."
"Nunca arquive e-mails de recrutadores."
"Coloque recibos em Financeiro."

Você também pode perguntar:

"O que precisa da minha atenção?"
"Quem está esperando uma resposta minha?"
"Resume o que aconteceu com esse cliente."
"Prepare uma resposta."

Usar as configurações recomendadas ou personalizar?`,

    onboardingChoices: {
      recommended: "Usar as configurações recomendadas",
      customize: "Personalizar",
    },

    onboardingCompleted: {
      recommended: `O modo Balanceado está ativo:
- Lixo óbvio pode ser arquivado
- E-mails rotineiros, interessantes e importantes continuam visíveis
- Nada é apagado permanentemente
- O envio sempre exige sua confirmação

Pergunte "O que precisa da minha atenção?" ou defina uma regra como "Arquive newsletters automaticamente."`,
      custom: `Suas regras personalizadas foram salvas. Altere-as a qualquer momento conversando comigo.`,
    },

    help: {
      tagline: branding.tagline.pt,
      summary: branding.shortDescription.pt,
      capabilities: [
        "Organizar e priorizar seus e-mails em todas as contas conectadas.",
        "Lembrar quem são seus contatos (clientes, colegas, recrutadores, fornecedores).",
        "Acompanhar pendências: quem espera sua resposta e quem você está aguardando.",
        "Preparar, revisar e assinar rascunhos por conversa.",
        "Definir regras conversando, sem formulários.",
      ],
      sampleQueries: {
        inboxOverview: ["O que precisa da minha atenção?", "O que está acontecendo em todos os meus e-mails?"],
        prioritization: ["Quais e-mails realmente importam?", "Por que este e-mail é importante?"],
        waitingState: ["Quem está esperando uma resposta minha?", "Quem eu estou esperando?"],
        relationships: ["Quem é essa pessoa?", "Essa pessoa é meu cliente.", "Sobre o que conversamos antes?"],
        threads: ["Resume o que aconteceu com esse cliente.", "Releia o histórico e reavalie."],
        drafting: ["Prepare uma resposta.", "Deixe mais informal.", "Use minha assinatura profissional."],
        rules: [
          "Arquive newsletters automaticamente.",
          "Nunca arquive e-mails de recrutadores.",
          "Tudo que vier desse cliente é importante.",
          "Coloque recibos em Financeiro.",
          "Quais são minhas regras atuais?",
        ],
      },
      safeDefaults: [
        "E-mails importantes e duvidosos continuam visíveis.",
        "Mensagens claramente pouco relevantes podem ser arquivadas.",
        "Nada é apagado permanentemente de forma automática.",
        "O envio sempre exige sua confirmação.",
      ],
    },

    policyDescriptions: {
      safePreset: "Seguro: organiza e ordena e-mails quase sem movimentação automática.",
      balancedPreset: "Balanceado (recomendado): arquiva lixo óbvio; mantém rotineiros, interessantes e importantes visíveis; não toca nos duvidosos.",
      inboxZeroPreset: "Inbox Zero: arquiva mais rotina e pouco valor, mantendo importantes e o que precisa de resposta na caixa de entrada.",
      customPreset: "Personalizado: suas próprias regras e exceções.",
      junkRule: "Lixo: arquivar automaticamente (nunca apagar permanentemente).",
      routineRule: "Rotineiro: manter na caixa de entrada normalmente.",
      interestingRule: "Interessante: manter disponível, sem urgência.",
      importantRule: "Importante: manter visível e não lido, no topo da lista de atenção.",
      criticalRule: "Crítico: mostrar imediatamente, nunca arquivar.",
      uncertainRule: "Duvidoso: deixar intacto na caixa de entrada.",
    },

    actionDescriptions: {
      leave: "Manter na caixa de entrada",
      archive: "Arquivar",
      mark_read: "Marcar como lido",
      keep_unread: "Manter como não lido",
      label: (dest?: string) => `Aplicar marcador${dest ? ` '${dest}'` : ""}`,
      move: (dest?: string) => `Mover para pasta${dest ? ` '${dest}'` : ""}`,
      delete: "Apagar (desligado por padrão)",
      surface: "Mostrar imediatamente",
      prioritize: "Subir na lista de atenção",
    },

    simulatedActions: {
      wouldLeave: "Deixaria intacto na caixa de entrada",
      wouldArchive: "Arquivaria a mensagem",
      wouldMarkRead: "Marcaria a mensagem como lida",
      wouldKeepUnread: "Manteria a mensagem como não lida",
      wouldLabel: (dest?: string) => `Aplicaria marcador${dest ? ` '${dest}'` : ""}`,
      wouldMove: (dest?: string) => `Moveria para pasta${dest ? ` '${dest}'` : ""}`,
      wouldDelete: "Apagaria a mensagem (exclusão permanente é restrita)",
      wouldSurface: "Mostraria esta mensagem como alta prioridade",
      wouldPrioritize: "Subiria este remetente e mensagem na lista de atenção",
    },

    providerStatus: {
      connected: "Conectado",
      offline: "Offline",
      lastSeen: (device: string, timeAgo: string) => `Conectado por ${device} (visto por último há ${timeAgo})`,
      offlineWarning: (provider: string, device: string, timeAgo: string) =>
        `Seu conector do ${provider} está offline (visto por último há ${timeAgo} em ${device}), então os resultados do ${provider} podem estar incompletos.`,
    },

    humanConfirmation: {
      approvalRequired: "O envio sempre exige que você revise e confirme o e-mail.",
      idempotentNotice: "Tentativas idênticas de envio são ignoradas para o mesmo e-mail não sair duas vezes.",
    },
  },
};

export class LocalizationService {
  /**
   * Registers a new locale dictionary or overrides an existing one.
   */
  registerLocale(locale: string, content: LocalizedContent): void {
    LOCALES[locale] = content;
  }

  /**
   * Returns list of currently registered locale codes.
   */
  getSupportedLocales(): string[] {
    return Object.keys(LOCALES);
  }

  /**
   * Checks if a locale is registered.
   */
  isSupportedLocale(locale?: string | null): boolean {
    if (!locale) return false;
    return Boolean(LOCALES[locale]);
  }

  /**
   * Resolves the best-matching supported locale according to priority:
   * 1. Explicit user saved language preference (`savedPreference`)
   * 2. Current conversation request language (`requestLanguage`)
   * 3. Request / session locale (`sessionLocale`)
   * 4. User / browser locale (`userLocale`)
   * 5. English fallback ("en")
   */
  resolveLocale(input?: {
    savedPreference?: string | null;
    requestLanguage?: string | null;
    sessionLocale?: string | null;
    userLocale?: string | null;
  }): SupportedLocale {
    const candidates = [
      input?.savedPreference,
      input?.requestLanguage,
      input?.sessionLocale,
      input?.userLocale,
    ].filter(Boolean) as string[];

    for (const cand of candidates) {
      const normalized = cand.toLowerCase().trim();

      // Check direct match
      if (LOCALES[cand]) return cand;
      if (LOCALES[normalized]) return normalized;

      // Portuguese variants
      if (
        normalized.startsWith("pt") ||
        normalized === "portuguese" ||
        normalized === "português" ||
        normalized === "br"
      ) {
        return "pt-BR";
      }

      // English variants
      if (
        normalized.startsWith("en") ||
        normalized === "english" ||
        normalized === "us" ||
        normalized === "uk"
      ) {
        return "en";
      }
    }

    // Default fallback
    return "en";
  }

  /**
   * Retrieves localized content for a given locale, falling back to English if missing.
   */
  getContent(locale?: SupportedLocale | null): LocalizedContent {
    if (!locale) return LOCALES.en!;
    return LOCALES[locale] || LOCALES.en!;
  }

  /**
   * Formats relative time elapsed in a human-friendly localized manner.
   */
  formatTimeAgo(date: Date, locale?: SupportedLocale): string {
    const activeLocale = this.resolveLocale({ requestLanguage: locale });
    const now = Date.now();
    const diffMs = Math.max(0, now - date.getTime());
    const minutes = Math.floor(diffMs / (60 * 1000));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (activeLocale === "pt-BR") {
      if (minutes < 1) return "poucos segundos atrás";
      if (minutes === 1) return "1 minuto atrás";
      if (minutes < 60) return `${minutes} minutos atrás`;
      if (hours === 1) return "1 hora atrás";
      if (hours < 24) return `${hours} horas atrás`;
      if (days === 1) return "1 dia atrás";
      return `${days} dias atrás`;
    }

    if (minutes < 1) return "a few seconds ago";
    if (minutes === 1) return "1 minute ago";
    if (minutes < 60) return `${minutes} minutes ago`;
    if (hours === 1) return "1 hour ago";
    if (hours < 24) return `${hours} hours ago`;
    if (days === 1) return "1 day ago";
    return `${days} days ago`;
  }
}

export const localizationService = new LocalizationService();
