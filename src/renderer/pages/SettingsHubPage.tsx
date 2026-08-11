import {
  Bot,
  ChevronRight,
  Archive,
  Globe,
  MessageCircle,
  Terminal,
  User,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export type SettingsPageId = 'ai-connection' | 'user' | 'tools' | 'whatsapp' | 'webhook' | 'logs' | 'archive';

interface SettingsCard {
  id: SettingsPageId;
  title: string;
  description: string;
  icon: LucideIcon;
}

const settingsCards: SettingsCard[] = [
  {
    id: 'ai-connection',
    title: 'Conexiune AI',
    description: 'Provider, model, chei API si modul proxy.',
    icon: Bot,
  },
  {
    id: 'user',
    title: 'Utilizator',
    description: 'Identitate locala si preferinte personale.',
    icon: User,
  },
  {
    id: 'tools',
    title: 'Unelte',
    description: 'Controleaza ce pot folosi agentii.',
    icon: Wrench,
  },
  {
    id: 'whatsapp',
    title: 'WhatsApp',
    description: 'Chat la distanta, numere autorizate si rutare.',
    icon: MessageCircle,
  },
  {
    id: 'webhook',
    title: 'Webhook',
    description: 'Tunel public, URL webhook si endpoint local.',
    icon: Globe,
  },
  {
    id: 'logs',
    title: 'Loguri',
    description: 'Consola, diagnosticare si date pentru depanare.',
    icon: Terminal,
  },
  {
    id: 'archive',
    title: 'Arhiva',
    description: 'Conversatii pastrate, ascunse din istoricul principal.',
    icon: Archive,
  },
];

function SettingsHubPage({
  onOpenPage,
}: {
  onOpenPage: (page: SettingsPageId, title: string) => void;
}) {
  return (
    <section className="app-settings-page" aria-label="Setari">
      <div className="app-settings-heading">
        <h2>Setari</h2>
        <p>Configureaza Sidera, canalele conectate, uneltele si diagnosticarea.</p>
      </div>

      <div className="app-settings-list">
        {settingsCards.map((card) => {
          const Icon = card.icon;

          return (
            <button
              className="app-settings-row"
              key={card.id}
              onClick={() => onOpenPage(card.id, card.title)}
              type="button"
            >
              <div className="app-settings-row-icon">
                <Icon size={18} strokeWidth={1.8} />
              </div>
              <div className="app-settings-row-copy">
                <span>{card.title}</span>
                <p>{card.description}</p>
              </div>
              <ChevronRight className="app-settings-row-arrow" size={16} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default SettingsHubPage;
