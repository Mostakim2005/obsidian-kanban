import l10n from '../components/Editor/flatpickr/l10n';
import { CustomLocale } from '../components/Editor/flatpickr/types/locale';
import { Lang } from '../lang/locale/en';
import ar from '../lang/locale/ar';
import cz from '../lang/locale/cz';
import da from '../lang/locale/da';
import de from '../lang/locale/de';
import es from '../lang/locale/es';
import fr from '../lang/locale/fr';
import hi from '../lang/locale/hi';
import id from '../lang/locale/id';
import it from '../lang/locale/it';
import ja from '../lang/locale/ja';
import ko from '../lang/locale/ko';
import nl from '../lang/locale/nl';
import no from '../lang/locale/no';
import pl from '../lang/locale/pl';
import pt from '../lang/locale/pt';
import ptBR from '../lang/locale/pt-br';
import ro from '../lang/locale/ro';
import ru from '../lang/locale/ru';
import sq from '../lang/locale/sq';
import tr from '../lang/locale/tr';
import uk from '../lang/locale/uk';
import zhCN from '../lang/locale/zh-cn';
import zhTW from '../lang/locale/zh-tw';

const localeMap: { [k: string]: Partial<Lang> } = {
  ar,
  cz,
  da,
  de,
  es,
  fr,
  hi,
  id,
  it,
  ja,
  ko,
  nl,
  no,
  pl,
  'pt-BR': ptBR,
  pt,
  ro,
  ru,
  sq,
  tr,
  uk,
  'zh-TW': zhTW,
  zh: zhCN,
};

const flatpickrLocaleMap: { [k: string]: CustomLocale } = {
  ar: l10n.ar,
  cs: l10n.cs,
  da: l10n.da,
  de: l10n.de,
  es: l10n.es,
  fr: l10n.fr,
  hi: l10n.hi,
  id: l10n.id,
  it: l10n.it,
  ja: l10n.ja,
  ko: l10n.ko,
  nl: l10n.nl,
  nn: l10n.no,
  pl: l10n.pl,
  pt: l10n.pt,
  'pt-br': l10n.pt,
  ro: l10n.ro,
  ru: l10n.ru,
  tr: l10n.tr,
  'zh-cn': l10n.zh,
  'zh-tw': l10n.zh_tw,
};

export function resolvePluginLocale(lang: string): Partial<Lang> | null {
  return localeMap[lang] || null;
}

export function resolveFlatpickrLocale(momentLocale: string): CustomLocale | null {
  return flatpickrLocaleMap[momentLocale] || null;
}

export type KanbanLocalesChunk = {
  resolvePluginLocale: typeof resolvePluginLocale;
  resolveFlatpickrLocale: typeof resolveFlatpickrLocale;
};
