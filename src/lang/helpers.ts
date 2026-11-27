import en, { Lang } from './locale/en';

interface KanbanLocaleGlobals {
  __kanbanActiveLocale?: Partial<Lang> | null;
}

export function getRequestedLocaleCode(): string {
  return window.localStorage.getItem('language') || 'en';
}

export function setActiveLocale(locale: Partial<Lang> | null): void {
  (window as unknown as KanbanLocaleGlobals).__kanbanActiveLocale = locale;
}

export function t(str: keyof typeof en): string {
  const activeLocale = (window as unknown as KanbanLocaleGlobals).__kanbanActiveLocale;
  return (activeLocale && activeLocale[str]) || en[str];
}
